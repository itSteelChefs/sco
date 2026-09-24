INSERT INTO "Permission"(id,code,description)
SELECT gen_random_uuid(),'supplier_po.confirm.read_all','Read all SCO supplier confirmations'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code='supplier_po.confirm.read_all');

CREATE OR REPLACE FUNCTION public.internal_supplier_po_confirmation_po_get(p_actor uuid,p_po uuid)
RETURNS TABLE(line_id uuid,ordered_quantity numeric,confirmed_quantity numeric,remaining_quantity numeric,status text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT l.id,l.ordered_quantity,COALESCE(sum(e.confirmed_quantity_delta),0),l.ordered_quantity-COALESCE(sum(e.confirmed_quantity_delta),0),CASE WHEN COALESCE(sum(e.confirmed_quantity_delta),0)=0 THEN 'NOT_CONFIRMED' WHEN COALESCE(sum(e.confirmed_quantity_delta),0)<l.ordered_quantity THEN 'PARTIALLY_CONFIRMED' ELSE 'CONFIRMED' END
  FROM supplier_purchase_order_lines l LEFT JOIN supplier_po_line_confirmation_events e ON e.supplier_purchase_order_line_id=l.id
  WHERE l.supplier_purchase_order_id=p_po AND (public.internal_has_capability(p_actor,'supplier_po.confirm.read_all') OR public.internal_has_capability(p_actor,'supplier_po.confirm.read'))
  GROUP BY l.id,l.ordered_quantity ORDER BY l.id
$$;

REVOKE ALL ON FUNCTION public.internal_supplier_po_confirmation_po_get(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_po_confirmation_po_get(uuid,uuid) TO sco_internal_executor;

CREATE OR REPLACE FUNCTION public.internal_supplier_po_confirmation_date_change(p_actor uuid,p_line uuid,p_previous date,p_new date,p_reason text,p_correlation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_source uuid; v_category uuid;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'supplier_po.confirm.date_change') THEN RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_DATE_FORBIDDEN'; END IF;
  SELECT p.purchase_source_id,pi.category_id INTO v_source,v_category FROM supplier_purchase_order_lines l JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id JOIN product_identities pi ON pi.id=l.product_identity_id WHERE l.id=p_line;
  IF v_source IS NULL OR NOT (public.internal_has_capability(p_actor,'supplier_po.confirm.read_all') OR EXISTS(SELECT 1 FROM procurement_engineer_scope_assignments s WHERE s.actor_user_id=p_actor AND s.purchase_source_id=v_source AND s.product_category_id=v_category AND s.status='ACTIVE') OR EXISTS(SELECT 1 FROM supplier_po_line_responsibilities r WHERE r.supplier_purchase_order_line_id=p_line AND r.actor_user_id=p_actor)) THEN RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_SCOPE_REQUIRED'; END IF;
  PERFORM set_config('app.supplier_po_confirmation_gateway','true',true);
  INSERT INTO supplier_po_delivery_date_change_events(supplier_purchase_order_line_id,previous_date,new_date,reason,actor_user_id,correlation_id) VALUES(p_line,p_previous,p_new,btrim(p_reason),p_actor,NULLIF(p_correlation,'')::uuid);
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.confirmation.date_changed','SupplierPurchaseOrderLine',p_line,jsonb_build_object('previousDate',p_previous,'newDate',p_new,'reason',p_reason),NULLIF(p_correlation,'')::uuid);
END $$;

CREATE OR REPLACE FUNCTION public.internal_supplier_po_confirmation_reference_correct(p_actor uuid,p_line uuid,p_previous text,p_corrected text,p_reason text,p_correlation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_source uuid; v_category uuid;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'supplier_po.confirm.reference_correct') THEN RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_REFERENCE_FORBIDDEN'; END IF;
  SELECT p.purchase_source_id,pi.category_id INTO v_source,v_category FROM supplier_purchase_order_lines l JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id JOIN product_identities pi ON pi.id=l.product_identity_id WHERE l.id=p_line;
  IF v_source IS NULL OR NOT (public.internal_has_capability(p_actor,'supplier_po.confirm.read_all') OR EXISTS(SELECT 1 FROM procurement_engineer_scope_assignments s WHERE s.actor_user_id=p_actor AND s.purchase_source_id=v_source AND s.product_category_id=v_category AND s.status='ACTIVE') OR EXISTS(SELECT 1 FROM supplier_po_line_responsibilities r WHERE r.supplier_purchase_order_line_id=p_line AND r.actor_user_id=p_actor)) THEN RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_SCOPE_REQUIRED'; END IF;
  PERFORM set_config('app.supplier_po_confirmation_gateway','true',true);
  INSERT INTO supplier_po_reference_correction_events(supplier_purchase_order_line_id,previous_reference,corrected_reference,reason,actor_user_id,correlation_id) VALUES(p_line,btrim(p_previous),btrim(p_corrected),btrim(p_reason),p_actor,NULLIF(p_correlation,'')::uuid);
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.confirmation.reference_corrected','SupplierPurchaseOrderLine',p_line,jsonb_build_object('previousReference',p_previous,'correctedReference',p_corrected,'reason',p_reason),NULLIF(p_correlation,'')::uuid);
END $$;

REVOKE ALL ON FUNCTION public.internal_supplier_po_confirmation_po_get(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_po_confirmation_po_get(uuid,uuid) TO sco_internal_executor;
