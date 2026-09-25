CREATE OR REPLACE FUNCTION public.internal_supplier_payment_schedule_draft_create(p_actor uuid,p_po uuid,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid:=gen_random_uuid(); v_po record; v_next integer;
BEGIN
 IF NOT public.internal_has_capability(p_actor,'supplier_po.payment_schedule.draft.manage') THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_DRAFT_FORBIDDEN'; END IF;
 SELECT * INTO v_po FROM supplier_purchase_orders WHERE id=p_po AND status='ISSUED';
 IF v_po.id IS NULL THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_PO_NOT_ISSUED'; END IF;
 SELECT COALESCE(max(revision_number),0)+1 INTO v_next FROM supplier_payment_schedule_revisions WHERE supplier_purchase_order_id=p_po;
 PERFORM set_config('app.supplier_payment_schedule_gateway','true',true);
 INSERT INTO supplier_payment_schedule_revisions(id,supplier_purchase_order_id,revision_number,currency_code,payable_basis_amount,payment_terms_snapshot,original_supplier_terms_text,created_by,correlation_id) VALUES(v_id,p_po,v_next,v_po.currency_code,v_po.total_actual_purchase_cost,v_po.payment_terms_snapshot,v_po.original_supplier_terms_text,p_actor,NULLIF(p_correlation,'')::uuid);
 INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.payment_schedule.draft_created','SupplierPaymentScheduleRevision',v_id,jsonb_build_object('purchaseOrderId',p_po,'revisionNumber',v_next),NULLIF(p_correlation,'')::uuid);
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_supplier_payment_schedule_item_add(p_actor uuid,p_revision uuid,p_line integer,p_trigger text,p_amount numeric,p_percentage numeric,p_fixed date,p_milestone text,p_metadata jsonb,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid:=gen_random_uuid();
BEGIN
 IF NOT public.internal_has_capability(p_actor,'supplier_po.payment_schedule.draft.manage') THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_DRAFT_FORBIDDEN'; END IF;
 IF NOT EXISTS(SELECT 1 FROM supplier_payment_schedule_revisions WHERE id=p_revision AND status='DRAFT') THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_DRAFT_NOT_EDITABLE'; END IF;
 PERFORM set_config('app.supplier_payment_schedule_gateway','true',true);
 INSERT INTO supplier_payment_schedule_items(id,schedule_revision_id,line_number,trigger_type,amount,percentage,fixed_date,milestone_description,trigger_reference_metadata,created_by) VALUES(v_id,p_revision,p_line,p_trigger,p_amount,p_percentage,p_fixed,p_milestone,COALESCE(p_metadata,'{}'::jsonb),p_actor);
 INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.payment_schedule.draft_updated','SupplierPaymentScheduleItem',v_id,jsonb_build_object('revisionId',p_revision,'action','ADD'),NULLIF(p_correlation,'')::uuid);
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_supplier_payment_schedule_item_update(p_actor uuid,p_item uuid,p_trigger text,p_amount numeric,p_percentage numeric,p_fixed date,p_milestone text,p_metadata jsonb,p_correlation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_revision uuid;
BEGIN
 IF NOT public.internal_has_capability(p_actor,'supplier_po.payment_schedule.draft.manage') THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_DRAFT_FORBIDDEN'; END IF;
 SELECT schedule_revision_id INTO v_revision FROM supplier_payment_schedule_items WHERE id=p_item;
 IF NOT EXISTS(SELECT 1 FROM supplier_payment_schedule_revisions WHERE id=v_revision AND status='DRAFT') THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_DRAFT_NOT_EDITABLE'; END IF;
 PERFORM set_config('app.supplier_payment_schedule_gateway','true',true);
 UPDATE supplier_payment_schedule_items SET trigger_type=p_trigger,amount=p_amount,percentage=p_percentage,fixed_date=p_fixed,milestone_description=p_milestone,trigger_reference_metadata=COALESCE(p_metadata,'{}'::jsonb) WHERE id=p_item;
 INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.payment_schedule.draft_updated','SupplierPaymentScheduleItem',p_item,jsonb_build_object('revisionId',v_revision,'action','UPDATE'),NULLIF(p_correlation,'')::uuid);
END $$;

CREATE OR REPLACE FUNCTION public.internal_supplier_payment_schedule_item_remove(p_actor uuid,p_item uuid,p_correlation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_revision uuid;
BEGIN
 IF NOT public.internal_has_capability(p_actor,'supplier_po.payment_schedule.draft.manage') THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_DRAFT_FORBIDDEN'; END IF;
 SELECT schedule_revision_id INTO v_revision FROM supplier_payment_schedule_items WHERE id=p_item;
 IF NOT EXISTS(SELECT 1 FROM supplier_payment_schedule_revisions WHERE id=v_revision AND status='DRAFT') THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_DRAFT_NOT_EDITABLE'; END IF;
 PERFORM set_config('app.supplier_payment_schedule_gateway','true',true);
 DELETE FROM supplier_payment_schedule_items WHERE id=p_item;
 INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.payment_schedule.draft_updated','SupplierPaymentScheduleItem',p_item,jsonb_build_object('revisionId',v_revision,'action','REMOVE'),NULLIF(p_correlation,'')::uuid);
END $$;

CREATE OR REPLACE FUNCTION public.internal_supplier_payment_schedule_get(p_actor uuid,p_revision uuid) RETURNS SETOF supplier_payment_schedule_revisions LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT r FROM supplier_payment_schedule_revisions r WHERE r.id=p_revision AND (public.internal_has_capability(p_actor,'supplier_po.payment_schedule.read_all') OR public.internal_has_capability(p_actor,'supplier_po.payment_schedule.draft.manage')) $$;
REVOKE ALL ON FUNCTION public.internal_supplier_payment_schedule_draft_create(uuid,uuid,text),public.internal_supplier_payment_schedule_item_add(uuid,uuid,integer,text,numeric,numeric,date,text,jsonb,text),public.internal_supplier_payment_schedule_item_update(uuid,uuid,text,numeric,numeric,date,text,jsonb,text),public.internal_supplier_payment_schedule_item_remove(uuid,uuid,text),public.internal_supplier_payment_schedule_get(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_payment_schedule_draft_create(uuid,uuid,text),public.internal_supplier_payment_schedule_item_add(uuid,uuid,integer,text,numeric,numeric,date,text,jsonb,text),public.internal_supplier_payment_schedule_item_update(uuid,uuid,text,numeric,numeric,date,text,jsonb,text),public.internal_supplier_payment_schedule_item_remove(uuid,uuid,text),public.internal_supplier_payment_schedule_get(uuid,uuid) TO sco_internal_executor;
