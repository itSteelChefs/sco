CREATE OR REPLACE FUNCTION public.internal_supplier_po_scoped_get(p_actor uuid,p_po uuid)
RETURNS TABLE(po_id uuid,po_status "SupplierPurchaseOrderStatus",purchase_source_id uuid,supplier_company_id uuid,currency_code text,line_id uuid,product_identity_id uuid,ordered_quantity numeric,actual_unit_purchase_cost numeric,line_origin "SupplierPODemandOrigin",lead_procurement_engineer_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT p.id,p.status,p.purchase_source_id,p.supplier_company_id,p.currency_code,l.id,l.product_identity_id,l.ordered_quantity,l.actual_unit_purchase_cost,l.demand_origin,p.lead_procurement_engineer_id
  FROM supplier_purchase_orders p
  JOIN supplier_purchase_order_lines l ON l.supplier_purchase_order_id=p.id
  JOIN product_identities pi ON pi.id=l.product_identity_id
  WHERE p.id=p_po
    AND (public.internal_has_capability(p_actor,'supplier_po.read_all') OR
      (public.internal_has_capability(p_actor,'supplier_po.read_assigned') AND
       (EXISTS (SELECT 1 FROM procurement_engineer_scope_assignments s WHERE s.actor_user_id=p_actor AND s.purchase_source_id=p.purchase_source_id AND s.product_category_id=pi.category_id AND s.status='ACTIVE')
        OR EXISTS (SELECT 1 FROM supplier_po_line_responsibilities r WHERE r.supplier_purchase_order_line_id=l.id AND r.actor_user_id=p_actor))))
  ORDER BY l.id
$$;

CREATE OR REPLACE FUNCTION public.internal_supplier_po_scoped_list(p_actor uuid,p_limit int,p_offset int)
RETURNS TABLE(po_id uuid,po_status "SupplierPurchaseOrderStatus",purchase_source_id uuid,supplier_company_id uuid,currency_code text,line_id uuid,product_identity_id uuid,ordered_quantity numeric,actual_unit_purchase_cost numeric,line_origin "SupplierPODemandOrigin",lead_procurement_engineer_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT p.id,p.status,p.purchase_source_id,p.supplier_company_id,p.currency_code,l.id,l.product_identity_id,l.ordered_quantity,l.actual_unit_purchase_cost,l.demand_origin,p.lead_procurement_engineer_id
  FROM supplier_purchase_orders p JOIN supplier_purchase_order_lines l ON l.supplier_purchase_order_id=p.id JOIN product_identities pi ON pi.id=l.product_identity_id
  WHERE public.internal_has_capability(p_actor,'supplier_po.read_all') OR
    (public.internal_has_capability(p_actor,'supplier_po.read_assigned') AND
      (EXISTS (SELECT 1 FROM procurement_engineer_scope_assignments s WHERE s.actor_user_id=p_actor AND s.purchase_source_id=p.purchase_source_id AND s.product_category_id=pi.category_id AND s.status='ACTIVE')
       OR EXISTS (SELECT 1 FROM supplier_po_line_responsibilities r WHERE r.supplier_purchase_order_line_id=l.id AND r.actor_user_id=p_actor)))
  ORDER BY p.id,l.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit,50),1),100) OFFSET GREATEST(COALESCE(p_offset,0),0)
$$;

CREATE OR REPLACE FUNCTION public.internal_supplier_po_line_responsibility_set(p_actor uuid,p_line uuid,p_engineer uuid,p_correlation text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_po record; v_category uuid;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'supplier_po.lead.manage') THEN RAISE EXCEPTION 'SUPPLIER_PO_RESPONSIBILITY_FORBIDDEN'; END IF;
  SELECT p.id,p.purchase_source_id,pi.category_id INTO v_po FROM supplier_purchase_order_lines l JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id JOIN product_identities pi ON pi.id=l.product_identity_id WHERE l.id=p_line;
  IF v_po.id IS NULL OR NOT EXISTS(SELECT 1 FROM "User" WHERE id=p_engineer AND status='ACTIVE') THEN RAISE EXCEPTION 'SUPPLIER_PO_RESPONSIBILITY_INVALID'; END IF;
  IF NOT EXISTS(SELECT 1 FROM procurement_engineer_scope_assignments s WHERE s.actor_user_id=p_engineer AND s.purchase_source_id=v_po.purchase_source_id AND s.product_category_id=v_po.category_id AND s.status='ACTIVE') THEN RAISE EXCEPTION 'SUPPLIER_PO_SCOPE_REQUIRED'; END IF;
  PERFORM set_config('app.supplier_po_gateway','true',true);
  INSERT INTO supplier_po_line_responsibilities(supplier_purchase_order_line_id,actor_user_id,assigned_by,assigned_at) VALUES(p_line,p_engineer,p_actor,now())
  ON CONFLICT(supplier_purchase_order_line_id,actor_user_id) DO UPDATE SET assigned_by=EXCLUDED.assigned_by,assigned_at=now();
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.line_responsibility_set','SupplierPurchaseOrderLine',p_line,jsonb_build_object('engineerId',p_engineer),NULLIF(p_correlation,'')::uuid);
END $$;

CREATE OR REPLACE FUNCTION public.internal_supplier_po_lead_set(p_actor uuid,p_po uuid,p_engineer uuid,p_correlation text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_source uuid; v_valid boolean;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'supplier_po.lead.manage') THEN RAISE EXCEPTION 'SUPPLIER_PO_LEAD_FORBIDDEN'; END IF;
  SELECT purchase_source_id INTO v_source FROM supplier_purchase_orders WHERE id=p_po FOR UPDATE;
  IF v_source IS NULL OR NOT EXISTS(SELECT 1 FROM "User" WHERE id=p_engineer AND status='ACTIVE') THEN RAISE EXCEPTION 'SUPPLIER_PO_LEAD_INVALID'; END IF;
  SELECT EXISTS(SELECT 1 FROM supplier_purchase_order_lines l JOIN product_identities pi ON pi.id=l.product_identity_id JOIN procurement_engineer_scope_assignments s ON s.purchase_source_id=v_source AND s.product_category_id=pi.category_id AND s.actor_user_id=p_engineer AND s.status='ACTIVE' WHERE l.supplier_purchase_order_id=p_po) INTO v_valid;
  IF NOT v_valid THEN RAISE EXCEPTION 'SUPPLIER_PO_LEAD_SCOPE_REQUIRED'; END IF;
  PERFORM set_config('app.supplier_po_gateway','true',true);
  UPDATE supplier_purchase_orders SET lead_procurement_engineer_id=p_engineer WHERE id=p_po;
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.lead_set','SupplierPurchaseOrder',p_po,jsonb_build_object('engineerId',p_engineer),NULLIF(p_correlation,'')::uuid);
END $$;

REVOKE ALL ON FUNCTION public.internal_supplier_po_scoped_get(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_supplier_po_scoped_list(uuid,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_supplier_po_line_responsibility_set(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_supplier_po_lead_set(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_po_scoped_get(uuid,uuid),public.internal_supplier_po_scoped_list(uuid,int,int),public.internal_supplier_po_line_responsibility_set(uuid,uuid,uuid,text),public.internal_supplier_po_lead_set(uuid,uuid,uuid,text) TO sco_internal_executor;
