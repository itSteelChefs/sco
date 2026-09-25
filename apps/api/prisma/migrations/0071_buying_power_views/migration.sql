INSERT INTO "Permission"(id,code,description)
VALUES (gen_random_uuid(),'buying_power.partner_own_read','Read the authenticated Partner own Buying Power context')
ON CONFLICT(code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.internal_buying_power_summary_view(p_actor uuid,p_snapshot uuid)
RETURNS TABLE(
  snapshot_id uuid,
  aggregation_run_id uuid,
  product_identity_id uuid,
  product_description text,
  unit_id uuid,
  unit_code text,
  unit_name text,
  horizon "BuyingPowerHorizon",
  time_bucket date,
  potential_quantity numeric,
  qualified_quantity numeric,
  committed_quantity numeric,
  open_quantity numeric,
  released_quantity numeric,
  procured_quantity numeric,
  cutoff_at timestamptz,
  published_at timestamptz,
  snapshot_status "BuyingPowerRunStatus"
)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT s.id,r.id,sl.product_identity_id,
         btrim(concat_ws(' ',pi.manufacturer,pi.brand,pi.model_reference)),
         sl.unit_id,u.code,u.name,s.horizon,s.time_bucket,
         sl.potential_quantity,sl.qualified_quantity,sl.committed_quantity,
         sl.open_quantity,sl.released_quantity,sl.procured_quantity,
         s.cutoff_at,s.published_at,r.status
    FROM public.buying_power_snapshots s
    JOIN public.buying_power_aggregation_runs r ON r.id=s.aggregation_run_id AND r.status='PUBLISHED'
    JOIN public.buying_power_snapshot_lines sl ON sl.snapshot_id=s.id
    JOIN public.product_identities pi ON pi.id=sl.product_identity_id
    JOIN public.unit_definitions u ON u.id=sl.unit_id
   WHERE s.id=p_snapshot
     AND public.internal_has_capability(p_actor,'buying_power.read_summary')
$$;

CREATE OR REPLACE FUNCTION public.internal_buying_power_lineage_view(p_actor uuid,p_snapshot uuid)
RETURNS TABLE(
  snapshot_membership_id uuid,
  snapshot_id uuid,
  source_type "BuyingPowerConversionSourceType",
  source_record_id uuid,
  source_company_id uuid,
  product_identity_id uuid,
  unit_id uuid,
  contribution_class text,
  contribution_quantity numeric,
  horizon "BuyingPowerHorizon",
  time_bucket date,
  source_reference jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT m.id,m.snapshot_id,m.source_type,m.source_record_id,m.source_company_id,
         l.product_identity_id,m.unit_id,m.contribution_class,m.contribution_quantity,
         s.horizon,s.time_bucket,m.source_reference
    FROM public.buying_power_snapshot_source_memberships m
    JOIN public.buying_power_snapshots s ON s.id=m.snapshot_id
    JOIN public.buying_power_snapshot_lines l ON l.id=m.snapshot_line_id
   WHERE m.snapshot_id=p_snapshot
     AND public.internal_has_capability(p_actor,'buying_power.read_lineage')
$$;

CREATE OR REPLACE FUNCTION public.partner_buying_power_own_context(
  p_actor uuid,
  p_company uuid,
  p_horizon text DEFAULT NULL,
  p_bucket date DEFAULT NULL
)
RETURNS TABLE(
  product_identity_id uuid,
  unit_id uuid,
  horizon text,
  time_bucket date,
  potential_quantity numeric,
  qualified_quantity numeric,
  committed_quantity numeric,
  open_quantity numeric,
  released_quantity numeric,
  procured_quantity numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  WITH own_needs AS (
    SELECT n.product_identity_id,n.unit_id,
           CASE WHEN n.maturity IN ('FORECAST','PLANNED') THEN 'ROLLING_PLANNED' ELSE 'WEEKLY_IMMEDIATE' END AS horizon,
           date_trunc('week',n.need_date)::date AS time_bucket,
           sum(CASE WHEN n.maturity IN ('FORECAST','PLANNED') THEN n.quantity ELSE 0 END) AS potential_quantity,
           sum(CASE WHEN n.maturity IN ('APPROVED','READY') THEN n.quantity ELSE 0 END) AS qualified_quantity
      FROM public.procurement_needs n
     WHERE n.company_id=p_company
       AND (p_horizon IS NULL OR CASE WHEN n.maturity IN ('FORECAST','PLANNED') THEN 'ROLLING_PLANNED' ELSE 'WEEKLY_IMMEDIATE' END=p_horizon)
       AND (p_bucket IS NULL OR date_trunc('week',n.need_date)::date=p_bucket)
     GROUP BY n.product_identity_id,n.unit_id,CASE WHEN n.maturity IN ('FORECAST','PLANNED') THEN 'ROLLING_PLANNED' ELSE 'WEEKLY_IMMEDIATE' END,date_trunc('week',n.need_date)::date
  ), own_commitments AS (
    SELECT l.product_identity_id,l.unit_id,sum(l.quantity) AS committed_quantity
      FROM public.commercial_commitments c
      JOIN public.commercial_commitment_lines l ON l.commercial_commitment_id=c.id
     WHERE c.partner_company_id=p_company
     GROUP BY l.product_identity_id,l.unit_id
  ), own_releases AS (
    SELECT l.product_identity_id,l.unit_id,sum(l.released_quantity) AS released_quantity
      FROM public.procurement_releases r
      JOIN public.procurement_release_lines l ON l.release_id=r.id
     WHERE r.partner_company_id=p_company AND r.status='PROCUREMENT_RELEASED'
     GROUP BY l.product_identity_id,l.unit_id
  ), own_procured AS (
    SELECT l.product_identity_id,l.unit_id,sum(a.allocated_quantity) AS procured_quantity
      FROM public.supplier_po_release_line_allocations a
      JOIN public.supplier_purchase_order_lines pol ON pol.id=a.supplier_purchase_order_line_id
      JOIN public.supplier_purchase_orders po ON po.id=pol.supplier_purchase_order_id AND po.status='ISSUED'
      JOIN public.procurement_release_lines l ON l.id=a.procurement_release_line_id
      JOIN public.procurement_releases r ON r.id=l.release_id AND r.partner_company_id=p_company
     GROUP BY l.product_identity_id,l.unit_id
  )
  SELECT n.product_identity_id,n.unit_id,n.horizon,n.time_bucket,n.potential_quantity,n.qualified_quantity,
         COALESCE(c.committed_quantity,0),
         GREATEST(n.qualified_quantity-COALESCE(r.released_quantity,0),0),
         COALESCE(r.released_quantity,0),COALESCE(p.procured_quantity,0)
    FROM own_needs n
    LEFT JOIN own_commitments c USING(product_identity_id,unit_id)
    LEFT JOIN own_releases r USING(product_identity_id,unit_id)
    LEFT JOIN own_procured p USING(product_identity_id,unit_id)
   WHERE current_setting('app.tenant_id',true)=p_company::text
     AND public.partner_po_capability(p_actor,p_company,'buying_power.partner_own_read')
$$;

REVOKE ALL ON FUNCTION public.internal_buying_power_summary_view(uuid,uuid),public.internal_buying_power_lineage_view(uuid,uuid),public.partner_buying_power_own_context(uuid,uuid,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_buying_power_summary_view(uuid,uuid),public.internal_buying_power_lineage_view(uuid,uuid) TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.partner_buying_power_own_context(uuid,uuid,text,date) TO sco_runtime;
