CREATE OR REPLACE FUNCTION public.internal_supplier_payment_schedule_draft_create(p_actor uuid,p_po uuid,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid:=gen_random_uuid(); v_po record; v_next integer;
BEGIN
 IF NOT public.internal_has_capability(p_actor,'supplier_po.payment_schedule.draft.manage') THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_DRAFT_FORBIDDEN'; END IF;
 SELECT * INTO v_po FROM supplier_purchase_orders WHERE id=p_po AND status='ISSUED';
 IF v_po.id IS NULL OR v_po.total_actual_purchase_cost IS NULL THEN RAISE EXCEPTION 'SUPPLIER_PO_PAYMENT_BASIS_REQUIRED'; END IF;
 SELECT COALESCE(max(revision_number),0)+1 INTO v_next FROM supplier_payment_schedule_revisions WHERE supplier_purchase_order_id=p_po;
 PERFORM set_config('app.supplier_payment_schedule_gateway','true',true);
 INSERT INTO supplier_payment_schedule_revisions(id,supplier_purchase_order_id,revision_number,status,currency_code,payable_basis_amount,basis_type,payment_terms_snapshot,original_supplier_terms_text,created_by,correlation_id) VALUES(v_id,p_po,v_next,'DRAFT',v_po.currency_code,v_po.total_actual_purchase_cost,'ISSUED_PO_ACTUAL_COST',v_po.payment_terms_snapshot,v_po.original_supplier_terms_text,p_actor,NULLIF(p_correlation,'')::uuid);
 INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.payment_schedule.draft_created','SupplierPaymentScheduleRevision',v_id,jsonb_build_object('purchaseOrderId',p_po,'revisionNumber',v_next),NULLIF(p_correlation,'')::uuid);
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.internal_supplier_payment_schedule_draft_create(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_payment_schedule_draft_create(uuid,uuid,text) TO sco_internal_executor;
