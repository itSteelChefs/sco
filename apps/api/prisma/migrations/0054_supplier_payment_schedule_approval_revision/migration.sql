CREATE UNIQUE INDEX supplier_payment_schedule_one_approved_per_po ON supplier_payment_schedule_revisions(supplier_purchase_order_id) WHERE status='APPROVED';

CREATE OR REPLACE FUNCTION public.prevent_supplier_payment_schedule_approved_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status IN ('APPROVED','SUPERSEDED') THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER supplier_payment_schedule_revision_immutable BEFORE UPDATE OR DELETE ON supplier_payment_schedule_revisions FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_payment_schedule_approved_mutation();
CREATE OR REPLACE FUNCTION public.prevent_supplier_payment_schedule_item_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM supplier_payment_schedule_revisions r WHERE r.id=OLD.schedule_revision_id AND r.status IN ('APPROVED','SUPERSEDED')) THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_IMMUTABLE'; END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER supplier_payment_schedule_item_immutable BEFORE INSERT OR UPDATE OR DELETE ON supplier_payment_schedule_items FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_payment_schedule_item_mutation();

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
 UPDATE supplier_payment_schedule_revisions SET status='APPROVED',approved_by=p_actor,approved_at=now() WHERE id=p_revision;
 UPDATE supplier_payment_schedule_revisions SET status='SUPERSEDED' WHERE supplier_purchase_order_id=v.supplier_purchase_order_id AND status='APPROVED' AND id<>p_revision;
 INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.payment_schedule.approved','SupplierPaymentScheduleRevision',p_revision,jsonb_build_object('purchaseOrderId',v.supplier_purchase_order_id,'basis',v.payable_basis_amount,'total',v_total,'reason',p_reason),NULLIF(p_correlation,'')::uuid);
END $$;

CREATE OR REPLACE FUNCTION public.internal_supplier_payment_schedule_revision_create(p_actor uuid,p_revision uuid,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_old record; v_id uuid:=gen_random_uuid(); v_next integer; v_item record;
BEGIN
 IF NOT public.internal_has_capability(p_actor,'supplier_po.payment_schedule.revise') THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_REVISE_FORBIDDEN'; END IF;
 SELECT * INTO v_old FROM supplier_payment_schedule_revisions WHERE id=p_revision AND status='APPROVED' FOR UPDATE;
 IF v_old.id IS NULL THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_REVISION_SOURCE_INVALID'; END IF;
 PERFORM 1 FROM supplier_purchase_orders WHERE id=v_old.supplier_purchase_order_id FOR UPDATE;
 SELECT COALESCE(max(revision_number),0)+1 INTO v_next FROM supplier_payment_schedule_revisions WHERE supplier_purchase_order_id=v_old.supplier_purchase_order_id;
 PERFORM set_config('app.supplier_payment_schedule_gateway','true',true);
 INSERT INTO supplier_payment_schedule_revisions(id,supplier_purchase_order_id,revision_number,status,currency_code,payable_basis_amount,basis_type,payment_terms_snapshot,original_supplier_terms_text,created_by,supersedes_revision_id,correlation_id) VALUES(v_id,v_old.supplier_purchase_order_id,v_next,'DRAFT',v_old.currency_code,v_old.payable_basis_amount,v_old.basis_type,v_old.payment_terms_snapshot,v_old.original_supplier_terms_text,p_actor,v_old.id,NULLIF(p_correlation,'')::uuid);
 FOR v_item IN SELECT * FROM supplier_payment_schedule_items WHERE schedule_revision_id=v_old.id LOOP INSERT INTO supplier_payment_schedule_items(schedule_revision_id,line_number,trigger_type,amount,percentage,fixed_date,milestone_description,trigger_reference_metadata,created_by) VALUES(v_id,v_item.line_number,v_item.trigger_type,v_item.amount,v_item.percentage,v_item.fixed_date,v_item.milestone_description,v_item.trigger_reference_metadata,p_actor); END LOOP;
 INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.payment_schedule.revision_created','SupplierPaymentScheduleRevision',v_id,jsonb_build_object('purchaseOrderId',v_old.supplier_purchase_order_id,'previousRevisionId',v_old.id,'revisionNumber',v_next),NULLIF(p_correlation,'')::uuid);
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.internal_supplier_payment_schedule_approve(uuid,uuid,text,text),public.internal_supplier_payment_schedule_revision_create(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_payment_schedule_approve(uuid,uuid,text,text),public.internal_supplier_payment_schedule_revision_create(uuid,uuid,text) TO sco_internal_executor;
