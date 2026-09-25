CREATE OR REPLACE FUNCTION public.internal_supplier_po_delivery_schedule_list(
  p_actor uuid,
  p_purchase_order uuid DEFAULT NULL
) RETURNS TABLE(
  tranche_id uuid,
  supplier_purchase_order_line_id uuid,
  supplier_purchase_order_id uuid,
  purchase_source_id uuid,
  supplier_company_id uuid,
  product_identity_id uuid,
  partner_company_id uuid,
  allocated_quantity numeric,
  tranche_quantity numeric,
  supplier_po_line_confirmation_event_id uuid,
  original_promised_date date,
  current_promised_date date,
  status "SupplierDeliveryTrancheStatus",
  delivery_alias text,
  operational_label text,
  location_details jsonb,
  receiving_contact jsonb,
  latest_change_at timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT
    t.id,
    t.supplier_purchase_order_line_id,
    l.supplier_purchase_order_id,
    po.purchase_source_id,
    po.supplier_company_id,
    l.product_identity_id,
    pr.partner_company_id,
    a.allocated_quantity,
    t.quantity,
    t.supplier_po_line_confirmation_event_id,
    confirmation.promised_delivery_date,
    COALESCE(changed.new_date, confirmation.promised_delivery_date),
    t.status,
    site.delivery_alias,
    site.operational_label,
    site.location_details,
    site.receiving_contact,
    changed.created_at
  FROM public.supplier_po_delivery_tranches t
  JOIN public.supplier_purchase_order_lines l ON l.id=t.supplier_purchase_order_line_id
  JOIN public.supplier_purchase_orders po ON po.id=l.supplier_purchase_order_id
  JOIN public.supplier_po_release_line_allocations a ON a.id=t.supplier_po_release_line_allocation_id
  JOIN public.procurement_release_lines rl ON rl.id=a.procurement_release_line_id
  JOIN public.procurement_releases pr ON pr.id=rl.release_id
  JOIN public.supplier_po_line_confirmation_events confirmation ON confirmation.id=t.supplier_po_line_confirmation_event_id
  JOIN public.partner_delivery_sites site ON site.id=t.partner_delivery_site_id
  LEFT JOIN LATERAL (
    SELECT c.new_date,c.created_at
    FROM public.supplier_po_delivery_tranche_change_events c
    WHERE c.tranche_id=t.id
    ORDER BY c.created_at DESC,c.id DESC
    LIMIT 1
  ) changed ON true
  WHERE (p_purchase_order IS NULL OR l.supplier_purchase_order_id=p_purchase_order)
    AND (
      public.internal_has_capability(p_actor,'supplier_po.delivery_schedule.read_all')
      OR (
        public.internal_has_capability(p_actor,'supplier_po.delivery_schedule.read_assigned')
        AND public.delivery_scope_allowed(p_actor,l.id)
      )
    )
  ORDER BY t.created_at,t.id
$$;

REVOKE ALL ON FUNCTION public.internal_supplier_po_delivery_schedule_list(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_po_delivery_schedule_list(uuid,uuid) TO sco_internal_executor;
