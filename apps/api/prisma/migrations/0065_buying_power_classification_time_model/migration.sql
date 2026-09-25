ALTER TABLE public.buying_power_snapshot_source_memberships
  DROP CONSTRAINT IF EXISTS buying_power_snapshot_source_memberships_contribution_class_check;
ALTER TABLE public.buying_power_snapshot_source_memberships
  ADD CONSTRAINT buying_power_snapshot_source_memberships_contribution_class_check
  CHECK (contribution_class IN ('LINKED_COMMITMENT','EXTERNAL_COMMITMENT','COMMITTED','POTENTIAL','QUALIFIED','OPEN','RELEASED','PROCURED'));

CREATE OR REPLACE FUNCTION public.internal_buying_power_classified_run(
  p_actor uuid,
  p_horizon text,
  p_bucket date,
  p_request_key text,
  p_need_ids uuid[],
  p_line_ids uuid[],
  p_correlation text
) RETURNS TABLE(run_id uuid,snapshot_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_run uuid:=gen_random_uuid();
  v_snapshot uuid:=gen_random_uuid();
  v_fingerprint text;
  v_existing record;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'buying_power.aggregate')
     OR p_horizon NOT IN ('WEEKLY_IMMEDIATE','ROLLING_PLANNED')
     OR p_bucket IS NULL
     OR btrim(COALESCE(p_request_key,''))=''
     OR (COALESCE(cardinality(p_need_ids),0)=0 AND COALESCE(cardinality(p_line_ids),0)=0)
  THEN RAISE EXCEPTION 'BUYING_POWER_AGGREGATION_FORBIDDEN'; END IF;

  SELECT md5(COALESCE(string_agg(x.value,',' ORDER BY x.value),''))
    INTO v_fingerprint
    FROM (
      SELECT n.id::text||':'||n.product_identity_id::text||':'||n.unit_id::text||':'||n.quantity::text||':'||n.maturity::text||':'||n.need_date::text AS value
        FROM procurement_needs n WHERE n.id=ANY(COALESCE(p_need_ids,ARRAY[]::uuid[]))
      UNION ALL
      SELECT a.id::text||':'||a.commitment_line_id::text||':'||a.source_type::text||':'||COALESCE(a.source_id::text,'external')||':'||a.converted_quantity::text
        FROM commitment_demand_conversion_allocations a WHERE a.commitment_line_id=ANY(COALESCE(p_line_ids,ARRAY[]::uuid[]))
    ) x;
  IF v_fingerprint=md5('') THEN RAISE EXCEPTION 'BUYING_POWER_AGGREGATION_EMPTY'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('buying-power-classified:'||p_horizon||':'||p_bucket::text||':'||p_request_key));
  SELECT r.id,s.id AS snapshot_id,r.source_fingerprint INTO v_existing
    FROM buying_power_aggregation_runs r
    LEFT JOIN buying_power_snapshots s ON s.aggregation_run_id=r.id
   WHERE r.horizon=p_horizon::"BuyingPowerHorizon" AND r.time_bucket=p_bucket AND r.request_key=p_request_key
   FOR UPDATE OF r;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.source_fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'BUYING_POWER_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN QUERY SELECT v_existing.id,v_existing.snapshot_id; RETURN;
  END IF;

  PERFORM set_config('app.buying_power_gateway','true',true);
  INSERT INTO buying_power_aggregation_runs(id,initiated_by,horizon,time_bucket,request_key,source_fingerprint,correlation_id)
  VALUES(v_run,p_actor,p_horizon::"BuyingPowerHorizon",p_bucket,p_request_key,v_fingerprint,NULLIF(p_correlation,'')::uuid);
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id)
  VALUES(p_actor,'SCO_INTERNAL','buying_power.classification.started','BuyingPowerAggregationRun',v_run,
         jsonb_build_object('horizon',p_horizon,'timeBucket',p_bucket,'sourceFingerprint',v_fingerprint),NULLIF(p_correlation,'')::uuid);
  INSERT INTO buying_power_snapshots(id,aggregation_run_id,horizon,time_bucket,cutoff_at,source_fingerprint,published_by,correlation_id)
  SELECT v_snapshot,v_run,p_horizon::"BuyingPowerHorizon",p_bucket,r.cutoff_at,v_fingerprint,p_actor,NULLIF(p_correlation,'')::uuid
    FROM buying_power_aggregation_runs r WHERE r.id=v_run;

  WITH roots AS (
    SELECT n.id,n.product_identity_id,n.unit_id,n.quantity,n.maturity,
           COALESCE((SELECT sum(e.allocated_quantity) FROM procurement_execution_items e WHERE e.procurement_need_id=n.id AND e.status NOT IN ('WITHDRAWN','CANCELLED')),0) AS reserved,
           COALESCE((SELECT sum(a.converted_quantity) FROM commitment_demand_conversion_allocations a JOIN procurement_execution_items e ON e.id=a.source_id WHERE a.source_type='EXECUTION_ITEM' AND e.procurement_need_id=n.id),0) AS execution_committed,
           COALESCE((SELECT sum(a.converted_quantity) FROM commitment_demand_conversion_allocations a WHERE a.source_type='NEED' AND a.source_id=n.id),0) AS direct_committed
      FROM procurement_needs n
     WHERE n.id=ANY(COALESCE(p_need_ids,ARRAY[]::uuid[]))
  ),
  need_metrics AS (
    SELECT r.product_identity_id,r.unit_id,
           (r.execution_committed+r.direct_committed) AS committed_quantity,
           CASE WHEN r.maturity IN ('FORECAST','PLANNED') AND p_horizon='ROLLING_PLANNED' THEN GREATEST(r.quantity-r.reserved-r.direct_committed,0) ELSE 0 END AS potential_quantity,
           CASE WHEN r.maturity IN ('APPROVED','READY') AND p_horizon='ROLLING_PLANNED' THEN GREATEST(r.quantity-r.reserved-r.direct_committed,0) ELSE 0 END AS qualified_quantity,
           CASE WHEN p_horizon='WEEKLY_IMMEDIATE' THEN GREATEST(r.reserved-r.execution_committed,0) ELSE GREATEST(r.quantity-r.reserved-r.direct_committed,0) END AS open_quantity,
           0::numeric AS released_quantity,0::numeric AS procured_quantity
      FROM roots r
  ),
  external_metrics AS (
    SELECT cl.product_identity_id,cl.unit_id,sum(a.converted_quantity) AS committed_quantity,0::numeric AS potential_quantity,0::numeric AS qualified_quantity,0::numeric AS open_quantity,0::numeric AS released_quantity,0::numeric AS procured_quantity
      FROM commitment_demand_conversion_allocations a JOIN commercial_commitment_lines cl ON cl.id=a.commitment_line_id
     WHERE a.source_type='EXTERNAL' AND a.commitment_line_id=ANY(COALESCE(p_line_ids,ARRAY[]::uuid[]))
     GROUP BY cl.product_identity_id,cl.unit_id
  ),
  all_metrics AS (
    SELECT * FROM need_metrics UNION ALL SELECT * FROM external_metrics
  )
  INSERT INTO buying_power_snapshot_lines(snapshot_id,product_identity_id,unit_id,committed_quantity,potential_quantity,qualified_quantity,open_quantity,released_quantity,procured_quantity)
  SELECT v_snapshot,product_identity_id,unit_id,sum(committed_quantity),NULLIF(sum(potential_quantity),0),NULLIF(sum(qualified_quantity),0),NULLIF(sum(open_quantity),0),NULLIF(sum(released_quantity),0),NULLIF(sum(procured_quantity),0)
    FROM all_metrics GROUP BY product_identity_id,unit_id;

  INSERT INTO buying_power_snapshot_source_memberships(snapshot_line_id,snapshot_id,source_type,source_record_id,source_company_id,contribution_class,contribution_quantity,unit_id,source_reference)
  SELECT l.id,v_snapshot,'NEED',r.id,n.company_id,
         CASE WHEN p_horizon='WEEKLY_IMMEDIATE' THEN 'OPEN' WHEN n.maturity IN ('FORECAST','PLANNED') THEN 'POTENTIAL' ELSE 'QUALIFIED' END,
         CASE WHEN p_horizon='WEEKLY_IMMEDIATE' THEN GREATEST(r.reserved-r.execution_committed,0) ELSE GREATEST(r.quantity-r.reserved-r.direct_committed,0) END,
         r.unit_id,jsonb_build_object('needId',r.id,'horizon',p_horizon,'timeBucket',p_bucket)
    FROM (
      SELECT n.id,n.product_identity_id,n.unit_id,n.quantity,n.maturity,
             n.company_id,
             COALESCE((SELECT sum(e.allocated_quantity) FROM procurement_execution_items e WHERE e.procurement_need_id=n.id AND e.status NOT IN ('WITHDRAWN','CANCELLED')),0) AS reserved,
             COALESCE((SELECT sum(a.converted_quantity) FROM commitment_demand_conversion_allocations a JOIN procurement_execution_items e ON e.id=a.source_id WHERE a.source_type='EXECUTION_ITEM' AND e.procurement_need_id=n.id),0) AS execution_committed,
             COALESCE((SELECT sum(a.converted_quantity) FROM commitment_demand_conversion_allocations a WHERE a.source_type='NEED' AND a.source_id=n.id),0) AS direct_committed
        FROM procurement_needs n WHERE n.id=ANY(COALESCE(p_need_ids,ARRAY[]::uuid[]))
    ) r
    JOIN procurement_needs n ON n.id=r.id
    JOIN buying_power_snapshot_lines l ON l.snapshot_id=v_snapshot AND l.product_identity_id=r.product_identity_id AND l.unit_id=r.unit_id
   WHERE CASE WHEN p_horizon='WEEKLY_IMMEDIATE' THEN GREATEST(r.reserved-r.execution_committed,0) ELSE GREATEST(r.quantity-r.reserved-r.direct_committed,0) END > 0;

  INSERT INTO buying_power_snapshot_source_memberships(snapshot_line_id,snapshot_id,source_type,source_record_id,source_company_id,contribution_class,contribution_quantity,unit_id,source_reference)
  SELECT l.id,v_snapshot,a.source_type,a.source_id,a.source_company_id,'COMMITTED',a.converted_quantity,a.unit_id,jsonb_build_object('commitmentLineId',a.commitment_line_id)
    FROM commitment_demand_conversion_allocations a
    JOIN commercial_commitment_lines cl ON cl.id=a.commitment_line_id
    JOIN buying_power_snapshot_lines l ON l.snapshot_id=v_snapshot AND l.product_identity_id=cl.product_identity_id AND l.unit_id=cl.unit_id
   WHERE a.commitment_line_id=ANY(COALESCE(p_line_ids,ARRAY[]::uuid[]));

  UPDATE buying_power_aggregation_runs SET status='PUBLISHED',completed_at=now() WHERE id=v_run;
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id)
  VALUES(p_actor,'SCO_INTERNAL','buying_power.classification.published','BuyingPowerSnapshot',v_snapshot,jsonb_build_object('runId',v_run,'sourceFingerprint',v_fingerprint),NULLIF(p_correlation,'')::uuid);
  RETURN QUERY SELECT v_run,v_snapshot;
END $$;

CREATE OR REPLACE FUNCTION public.internal_buying_power_classified_summary_get(p_actor uuid,p_snapshot uuid)
RETURNS TABLE(product_identity_id uuid,unit_id uuid,committed_quantity numeric,potential_quantity numeric,qualified_quantity numeric,open_quantity numeric,released_quantity numeric,procured_quantity numeric,horizon "BuyingPowerHorizon",time_bucket date)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT l.product_identity_id,l.unit_id,l.committed_quantity,l.potential_quantity,l.qualified_quantity,l.open_quantity,l.released_quantity,l.procured_quantity,s.horizon,s.time_bucket
    FROM buying_power_snapshots s JOIN buying_power_snapshot_lines l ON l.snapshot_id=s.id
   WHERE s.id=p_snapshot AND public.internal_has_capability(p_actor,'buying_power.read_summary')
$$;

REVOKE ALL ON FUNCTION public.internal_buying_power_classified_run(uuid,text,date,text,uuid[],uuid[],text),public.internal_buying_power_classified_summary_get(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_buying_power_classified_run(uuid,text,date,text,uuid[],uuid[],text),public.internal_buying_power_classified_summary_get(uuid,uuid) TO sco_internal_executor;
