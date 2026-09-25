CREATE OR REPLACE FUNCTION public.internal_buying_power_foundation_run(p_actor uuid,p_horizon text,p_bucket date,p_request_key text,p_lines uuid[],p_correlation text) RETURNS TABLE(run_id uuid,snapshot_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_run uuid:=gen_random_uuid(); v_snapshot uuid:=gen_random_uuid(); v_fingerprint text; v_existing record;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'buying_power.aggregate') OR p_horizon NOT IN ('WEEKLY_IMMEDIATE','ROLLING_PLANNED') OR p_bucket IS NULL OR btrim(COALESCE(p_request_key,''))='' OR p_lines IS NULL OR cardinality(p_lines)=0 THEN RAISE EXCEPTION 'BUYING_POWER_AGGREGATION_FORBIDDEN'; END IF;
  SELECT md5(COALESCE(string_agg(a.commitment_line_id::text||':'||a.source_type::text||':'||COALESCE(a.source_id::text,'external')||':'||a.converted_quantity::text,',' ORDER BY a.commitment_line_id,a.source_type,a.source_id,a.id),'')) INTO v_fingerprint FROM commitment_demand_conversion_allocations a WHERE a.commitment_line_id=ANY(p_lines);
  IF v_fingerprint=md5('') THEN RAISE EXCEPTION 'BUYING_POWER_AGGREGATION_EMPTY'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('buying-power:'||p_horizon||':'||p_bucket::text||':'||p_request_key));
  SELECT r.id,s.id AS snapshot_id,r.source_fingerprint INTO v_existing FROM buying_power_aggregation_runs r LEFT JOIN buying_power_snapshots s ON s.aggregation_run_id=r.id WHERE r.horizon=p_horizon::"BuyingPowerHorizon" AND r.time_bucket=p_bucket AND r.request_key=p_request_key FOR UPDATE OF r;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.source_fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'BUYING_POWER_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN QUERY SELECT v_existing.id,v_existing.snapshot_id; RETURN;
  END IF;
  PERFORM set_config('app.buying_power_gateway','true',true);
  INSERT INTO buying_power_aggregation_runs(id,initiated_by,horizon,time_bucket,request_key,source_fingerprint,correlation_id) VALUES(v_run,p_actor,p_horizon::"BuyingPowerHorizon",p_bucket,p_request_key,v_fingerprint,NULLIF(p_correlation,'')::uuid);
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','buying_power.aggregation.started','BuyingPowerAggregationRun',v_run,jsonb_build_object('horizon',p_horizon,'timeBucket',p_bucket,'sourceFingerprint',v_fingerprint),NULLIF(p_correlation,'')::uuid);
  INSERT INTO buying_power_snapshots(id,aggregation_run_id,horizon,time_bucket,cutoff_at,source_fingerprint,published_by,correlation_id) SELECT v_snapshot,v_run,p_horizon::"BuyingPowerHorizon",p_bucket,r.cutoff_at,v_fingerprint,p_actor,NULLIF(p_correlation,'')::uuid FROM buying_power_aggregation_runs r WHERE r.id=v_run;
  INSERT INTO buying_power_snapshot_lines(id,snapshot_id,product_identity_id,unit_id,committed_quantity) SELECT gen_random_uuid(),v_snapshot,cl.product_identity_id,cl.unit_id,sum(a.converted_quantity) FROM commitment_demand_conversion_allocations a JOIN commercial_commitment_lines cl ON cl.id=a.commitment_line_id WHERE a.commitment_line_id=ANY(p_lines) GROUP BY cl.product_identity_id,cl.unit_id;
  INSERT INTO buying_power_snapshot_source_memberships(snapshot_line_id,snapshot_id,source_type,source_record_id,source_company_id,contribution_class,contribution_quantity,unit_id,source_reference) SELECT l.id,v_snapshot,a.source_type,a.source_id,a.source_company_id,CASE WHEN a.source_type='EXTERNAL' THEN 'EXTERNAL_COMMITMENT' ELSE 'LINKED_COMMITMENT' END,a.converted_quantity,a.unit_id,jsonb_build_object('commitmentLineId',a.commitment_line_id) FROM commitment_demand_conversion_allocations a JOIN commercial_commitment_lines cl ON cl.id=a.commitment_line_id JOIN buying_power_snapshot_lines l ON l.snapshot_id=v_snapshot AND l.product_identity_id=cl.product_identity_id AND l.unit_id=cl.unit_id WHERE a.commitment_line_id=ANY(p_lines);
  UPDATE buying_power_aggregation_runs SET status='PUBLISHED',completed_at=now() WHERE id=v_run;
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','buying_power.aggregation.published','BuyingPowerSnapshot',v_snapshot,jsonb_build_object('runId',v_run,'sourceFingerprint',v_fingerprint),NULLIF(p_correlation,'')::uuid);
  RETURN QUERY SELECT v_run,v_snapshot;
END $$;
