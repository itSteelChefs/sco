CREATE OR REPLACE FUNCTION public.prevent_supplier_payment_schedule_approved_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_IMMUTABLE'; END IF;
 IF OLD.status IN ('APPROVED','SUPERSEDED') AND NOT (OLD.status='APPROVED' AND NEW.status='SUPERSEDED') THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.internal_supplier_payment_schedule_approve(p_actor uuid,p_revision uuid,p_reason text,p_correlation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v record; v_total numeric; v_count integer; v_invalid integer;
BEGIN
 IF NOT public.internal_has_capability(p_actor,'supplier_po.payment_schedule.approve') THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_APPROVE_FORBIDDEN'; END IF;
 SELECT r.*,p.status AS po_status,p.total_actual_purchase_cost AS po_basis,p.currency_code AS po_currency INTO v FROM supplier_payment_schedule_revisions r JOIN supplier_purchase_orders p ON p.id=r.supplier_purchase_order_id WHERE r.id=p_revision FOR UPDATE;
 IF v.id IS NULL OR v.status<>'DRAFT' OR v.po_status<>'ISSUED' THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_NOT_APPROVABLE'; END IF;
 PERFORM 1 FROM supplier_purchase_orders WHERE id=v.supplier_purchase_order_id FOR UPDATE;
 IF v.payable_basis_amount<>v.po_basis OR v.currency_code<>v.po_currency OR v.basis_type<>'ISSUED_PO_ACTUAL_COST' THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_BASIS_MISMATCH'; END IF;
 SELECT COALESCE(sum(amount),0),count(*),count(*) FILTER (WHERE amount<0 OR percentage IS NOT NULL AND (percentage<0 OR percentage>100) OR trigger_type='FIXED_DATE' AND fixed_date IS NULL OR trigger_type='CONTRACTUAL_MILESTONE' AND btrim(COALESCE(milestone_description,''))='') INTO v_total,v_count,v_invalid FROM supplier_payment_schedule_items WHERE schedule_revision_id=p_revision;
 IF v_invalid>0 OR v_count=0 OR v_total<>v.payable_basis_amount THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_COVERAGE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM supplier_payment_schedule_items WHERE schedule_revision_id=p_revision AND percentage IS NOT NULL AND round((amount*100/v.payable_basis_amount)::numeric,6)<>percentage) THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_PERCENTAGE_INVALID'; END IF;
 PERFORM set_config('app.supplier_payment_schedule_gateway','true',true);
 UPDATE supplier_payment_schedule_revisions SET status='SUPERSEDED' WHERE supplier_purchase_order_id=v.supplier_purchase_order_id AND status='APPROVED';
 UPDATE supplier_payment_schedule_revisions SET status='APPROVED',approved_by=p_actor,approved_at=now() WHERE id=p_revision;
 INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.payment_schedule.approved','SupplierPaymentScheduleRevision',p_revision,jsonb_build_object('purchaseOrderId',v.supplier_purchase_order_id,'basis',v.payable_basis_amount,'total',v_total,'reason',p_reason),NULLIF(p_correlation,'')::uuid);
END $$;
REVOKE ALL ON FUNCTION public.internal_supplier_payment_schedule_approve(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_payment_schedule_approve(uuid,uuid,text,text) TO sco_internal_executor;
