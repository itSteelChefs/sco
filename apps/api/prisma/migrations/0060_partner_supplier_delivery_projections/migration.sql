INSERT INTO "Permission"(id,code,description) VALUES
  (gen_random_uuid(),'partner_delivery_projection.read','Read the authenticated Partner delivery projection')
ON CONFLICT(code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.partner_delivery_projection_capability(
  p_actor uuid,
  p_company uuid
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public."User" u
    JOIN public."CompanyMembership" cm ON cm."userId"=u.id
      AND cm."companyId"=p_company
      AND cm.status='ACTIVE'
    JOIN public."Company" c ON c.id=cm."companyId"
      AND c.type='PARTNER'
      AND c.status='ACTIVE'
    JOIN public."MembershipRole" mr ON mr.membership_id=cm.id
    JOIN public."RolePermission" rp ON rp.role_id=mr.role_id
    JOIN public."Permission" permission ON permission.id=rp.permission_id
    WHERE u.id=p_actor
      AND u.status='ACTIVE'
      AND permission.code='partner_delivery_projection.read'
  );
$$;

CREATE OR REPLACE FUNCTION public.supplier_delivery_projection_capability(
  p_actor uuid,
  p_company uuid
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public."User" u
    JOIN public."CompanyMembership" cm ON cm."userId"=u.id
      AND cm."companyId"=p_company
      AND cm.status='ACTIVE'
    JOIN public."Company" c ON c.id=cm."companyId"
      AND c.type='SUPPLIER'
      AND c.status='ACTIVE'
    JOIN public."MembershipRole" mr ON mr.membership_id=cm.id
    JOIN public."RolePermission" rp ON rp.role_id=mr.role_id
    JOIN public."Permission" permission ON permission.id=rp.permission_id
    WHERE u.id=p_actor
      AND u.status='ACTIVE'
      AND permission.code='supplier_po.delivery_schedule.read_assigned'
  );
$$;

CREATE OR REPLACE FUNCTION public.partner_delivery_projection_list(
  p_actor uuid,
  p_company uuid,
  p_commitment uuid DEFAULT NULL
) RETURNS TABLE(
  commercial_commitment_id uuid,
  commercial_commitment_line_id uuid,
  product_identity_id uuid,
  product_description text,
  committed_quantity numeric,
  tranche_id uuid,
  tranche_quantity numeric,
  supplier_confirmed_quantity numeric,
  original_promised_date date,
  current_expected_date date,
  site_label text,
  location_details jsonb,
  tranche_status text,
  date_changed boolean
) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT
    cc.id,
    ccl.id,
    ccl.product_identity_id,
    ccl.product_description,
    ccl.quantity,
    t.id,
    t.quantity,
    LEAST(confirmation.confirmed_quantity_delta,a.allocated_quantity),
    confirmation.promised_delivery_date,
    COALESCE(changed.new_date,confirmation.promised_delivery_date),
    site.operational_label,
    site.location_details,
    t.status::text,
    (changed.id IS NOT NULL)
  FROM public.supplier_po_delivery_tranches t
  JOIN public.supplier_po_release_line_allocations a ON a.id=t.supplier_po_release_line_allocation_id
  JOIN public.procurement_release_lines rl ON rl.id=a.procurement_release_line_id
  JOIN public.procurement_releases pr ON pr.id=rl.release_id
  JOIN public.commercial_commitments cc ON cc.id=pr.commercial_commitment_id
    AND cc.partner_company_id=p_company
  JOIN public.commercial_commitment_lines ccl ON ccl.id=rl.commercial_commitment_line_id
    AND ccl.commercial_commitment_id=cc.id
  JOIN public.supplier_po_line_confirmation_events confirmation ON confirmation.id=t.supplier_po_line_confirmation_event_id
  JOIN public.partner_delivery_sites site ON site.id=t.partner_delivery_site_id
    AND site.company_id=p_company
  LEFT JOIN LATERAL (
    SELECT c.id,c.new_date
    FROM public.supplier_po_delivery_tranche_change_events c
    WHERE c.tranche_id=t.id
    ORDER BY c.created_at DESC,c.id DESC
    LIMIT 1
  ) changed ON true
  WHERE current_setting('app.tenant_id',true)=p_company::text
    AND public.partner_delivery_projection_capability(p_actor,p_company)
    AND (p_commitment IS NULL OR cc.id=p_commitment)
  ORDER BY t.created_at,t.id
$$;

CREATE OR REPLACE FUNCTION public.supplier_delivery_disclosure_projection(
  p_actor uuid,
  p_tranche uuid
) RETURNS TABLE(
  tranche_id uuid,
  destination_alias text,
  product_identity_id uuid,
  quantity numeric,
  expected_date date,
  tranche_status text,
  location_details jsonb,
  receiving_contact jsonb,
  date_changed boolean
) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT
    t.id,
    site.delivery_alias,
    l.product_identity_id,
    t.quantity,
    COALESCE(changed.new_date,confirmation.promised_delivery_date),
    t.status::text,
    CASE WHEN t.status='READY_FOR_DELIVERY' THEN site.location_details ELSE NULL END,
    CASE WHEN t.status='READY_FOR_DELIVERY' THEN site.receiving_contact ELSE NULL END,
    (changed.id IS NOT NULL)
  FROM public.supplier_po_delivery_tranches t
  JOIN public.supplier_purchase_order_lines l ON l.id=t.supplier_purchase_order_line_id
  JOIN public.supplier_purchase_orders po ON po.id=l.supplier_purchase_order_id
  JOIN public.purchase_sources source ON source.id=po.purchase_source_id
  JOIN public.supplier_po_line_confirmation_events confirmation ON confirmation.id=t.supplier_po_line_confirmation_event_id
  JOIN public.partner_delivery_sites site ON site.id=t.partner_delivery_site_id
  LEFT JOIN LATERAL (
    SELECT c.id,c.new_date
    FROM public.supplier_po_delivery_tranche_change_events c
    WHERE c.tranche_id=t.id
    ORDER BY c.created_at DESC,c.id DESC
    LIMIT 1
  ) changed ON true
  WHERE t.id=p_tranche
    AND current_setting('app.tenant_id',true)=source.supplier_company_id::text
    AND public.supplier_delivery_projection_capability(p_actor,source.supplier_company_id)
$$;

REVOKE ALL ON FUNCTION public.partner_delivery_projection_capability(uuid,uuid),public.supplier_delivery_projection_capability(uuid,uuid) FROM PUBLIC,sco_runtime,sco_internal_executor;
REVOKE ALL ON FUNCTION public.partner_delivery_projection_list(uuid,uuid,uuid),public.supplier_delivery_disclosure_projection(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_delivery_projection_list(uuid,uuid,uuid),public.supplier_delivery_disclosure_projection(uuid,uuid) TO sco_runtime;
