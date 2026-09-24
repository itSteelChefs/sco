CREATE OR REPLACE FUNCTION public.internal_supplier_po_confirmation_line_get(p_actor uuid,p_line uuid)
RETURNS TABLE(confirmed_quantity numeric,remaining_quantity numeric,status text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT COALESCE(sum(e.confirmed_quantity_delta),0), l.ordered_quantity-COALESCE(sum(e.confirmed_quantity_delta),0), CASE WHEN COALESCE(sum(e.confirmed_quantity_delta),0)=0 THEN 'NOT_CONFIRMED' WHEN COALESCE(sum(e.confirmed_quantity_delta),0)<l.ordered_quantity THEN 'PARTIALLY_CONFIRMED' ELSE 'CONFIRMED' END
  FROM supplier_purchase_order_lines l
  JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id
  JOIN product_identities pi ON pi.id=l.product_identity_id
  LEFT JOIN supplier_po_line_confirmation_events e ON e.supplier_purchase_order_line_id=l.id
  WHERE l.id=p_line
    AND public.internal_has_capability(p_actor,'supplier_po.confirm.read')
    AND (EXISTS(SELECT 1 FROM procurement_engineer_scope_assignments s WHERE s.actor_user_id=p_actor AND s.purchase_source_id=p.purchase_source_id AND s.product_category_id=pi.category_id AND s.status='ACTIVE')
         OR EXISTS(SELECT 1 FROM supplier_po_line_responsibilities r WHERE r.supplier_purchase_order_line_id=l.id AND r.actor_user_id=p_actor))
  GROUP BY l.ordered_quantity
$$;

REVOKE ALL ON FUNCTION public.internal_supplier_po_confirmation_line_get(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_po_confirmation_line_get(uuid,uuid) TO sco_internal_executor;
