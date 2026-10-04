DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_procurement_intelligence_gateway_owner') THEN
    CREATE ROLE sco_procurement_intelligence_gateway_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE sco_procurement_intelligence_gateway_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE ALL ON SCHEMA public FROM sco_procurement_intelligence_gateway_owner;
GRANT USAGE ON SCHEMA public TO sco_procurement_intelligence_gateway_owner;

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'procurement_intelligence.aggregate', 'Materialize approved Procurement Intelligence snapshots'),
  (gen_random_uuid(), 'procurement_intelligence.read_summary', 'Read approved Procurement Intelligence summaries'),
  (gen_random_uuid(), 'procurement_intelligence.read_lineage', 'Read protected Procurement Intelligence lineage')
ON CONFLICT (code) DO NOTHING;

CREATE TYPE "ProcurementIntelligenceRunStatus" AS ENUM ('STARTED', 'PUBLISHED', 'FAILED');

CREATE TABLE public.procurement_intelligence_purpose_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  authorization_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  source_buying_power_snapshot_id UUID NOT NULL REFERENCES public.buying_power_snapshots(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation = 'PI_SNAPSHOT_MATERIALIZE'),
  purpose_code TEXT NOT NULL CHECK (purpose_code = 'PUR-17'),
  flow_cpf_id TEXT NOT NULL CHECK (flow_cpf_id = 'CPF_33'),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  consumed_backend_pid INTEGER,
  consumed_transaction_id BIGINT,
  CHECK (expires_at > issued_at AND expires_at <= issued_at + INTERVAL '60 seconds'),
  CHECK ((consumed_at IS NULL AND consumed_backend_pid IS NULL AND consumed_transaction_id IS NULL)
    OR (consumed_at IS NOT NULL AND consumed_backend_pid IS NOT NULL AND consumed_transaction_id IS NOT NULL))
);

CREATE TABLE public.procurement_intelligence_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiated_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  authority_decision_id UUID NOT NULL UNIQUE REFERENCES public.procurement_intelligence_purpose_decisions(id) ON DELETE RESTRICT,
  source_buying_power_snapshot_id UUID NOT NULL REFERENCES public.buying_power_snapshots(id) ON DELETE RESTRICT,
  horizon "BuyingPowerHorizon" NOT NULL,
  time_bucket DATE NOT NULL,
  cutoff_at TIMESTAMPTZ NOT NULL,
  request_key TEXT NOT NULL CHECK (btrim(request_key) <> ''),
  source_fingerprint TEXT NOT NULL CHECK (btrim(source_fingerprint) <> ''),
  status "ProcurementIntelligenceRunStatus" NOT NULL DEFAULT 'STARTED',
  correlation_id UUID,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (request_key),
  CHECK (
    (status = 'STARTED' AND completed_at IS NULL AND error_code IS NULL)
    OR (status = 'PUBLISHED' AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'FAILED' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  )
);

CREATE TABLE public.procurement_intelligence_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_intelligence_run_id UUID NOT NULL UNIQUE REFERENCES public.procurement_intelligence_runs(id) ON DELETE RESTRICT,
  source_buying_power_snapshot_id UUID NOT NULL REFERENCES public.buying_power_snapshots(id) ON DELETE RESTRICT,
  horizon "BuyingPowerHorizon" NOT NULL,
  time_bucket DATE NOT NULL,
  cutoff_at TIMESTAMPTZ NOT NULL,
  source_fingerprint TEXT NOT NULL CHECK (btrim(source_fingerprint) <> ''),
  published_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  published_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.procurement_intelligence_snapshot_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES public.procurement_intelligence_snapshots(id) ON DELETE RESTRICT,
  source_buying_power_snapshot_line_id UUID NOT NULL REFERENCES public.buying_power_snapshot_lines(id) ON DELETE RESTRICT,
  product_identity_id UUID NOT NULL REFERENCES public.product_identities(id) ON DELETE RESTRICT,
  unit_id UUID NOT NULL REFERENCES public.unit_definitions(id) ON DELETE RESTRICT,
  committed_quantity NUMERIC(18,4),
  potential_quantity NUMERIC(18,4),
  qualified_quantity NUMERIC(18,4),
  open_quantity NUMERIC(18,4),
  released_quantity NUMERIC(18,4),
  procured_quantity NUMERIC(18,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (committed_quantity IS NULL OR committed_quantity >= 0),
  CHECK (potential_quantity IS NULL OR potential_quantity >= 0),
  CHECK (qualified_quantity IS NULL OR qualified_quantity >= 0),
  CHECK (open_quantity IS NULL OR open_quantity >= 0),
  CHECK (released_quantity IS NULL OR released_quantity >= 0),
  CHECK (procured_quantity IS NULL OR procured_quantity >= 0),
  UNIQUE (snapshot_id, product_identity_id, unit_id),
  UNIQUE (snapshot_id, source_buying_power_snapshot_line_id)
);

CREATE TABLE public.procurement_intelligence_snapshot_source_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_line_id UUID NOT NULL CONSTRAINT pi_snapshot_source_memberships_line_fkey REFERENCES public.procurement_intelligence_snapshot_lines(id) ON DELETE RESTRICT,
  snapshot_id UUID NOT NULL CONSTRAINT pi_snapshot_source_memberships_snapshot_fkey REFERENCES public.procurement_intelligence_snapshots(id) ON DELETE RESTRICT,
  source_buying_power_snapshot_line_id UUID NOT NULL REFERENCES public.buying_power_snapshot_lines(id) ON DELETE RESTRICT,
  source_buying_power_snapshot_membership_id UUID NOT NULL REFERENCES public.buying_power_snapshot_source_memberships(id) ON DELETE RESTRICT,
  contribution_class TEXT NOT NULL CHECK (contribution_class IN ('LINKED_COMMITMENT', 'EXTERNAL_COMMITMENT', 'COMMITTED', 'POTENTIAL', 'QUALIFIED', 'OPEN', 'RELEASED', 'PROCURED')),
  contribution_quantity NUMERIC(18,4) NOT NULL CHECK (contribution_quantity > 0),
  unit_id UUID NOT NULL REFERENCES public.unit_definitions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (snapshot_line_id, source_buying_power_snapshot_membership_id)
);

CREATE INDEX procurement_intelligence_runs_source_idx ON public.procurement_intelligence_runs(source_buying_power_snapshot_id);
CREATE INDEX procurement_intelligence_lines_snapshot_idx ON public.procurement_intelligence_snapshot_lines(snapshot_id);
CREATE INDEX procurement_intelligence_memberships_snapshot_idx ON public.procurement_intelligence_snapshot_source_memberships(snapshot_id);
CREATE INDEX procurement_intelligence_decisions_expiry_idx
  ON public.procurement_intelligence_purpose_decisions(expires_at)
  WHERE consumed_at IS NULL;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'procurement_intelligence_purpose_decisions',
    'procurement_intelligence_runs',
    'procurement_intelligence_snapshots',
    'procurement_intelligence_snapshot_lines',
    'procurement_intelligence_snapshot_source_memberships'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I OWNER TO sco_procurement_intelligence_gateway_owner', table_name);
  END LOOP;
END $$;

REVOKE ALL ON TABLE
  public.procurement_intelligence_purpose_decisions,
  public.procurement_intelligence_runs,
  public.procurement_intelligence_snapshots,
  public.procurement_intelligence_snapshot_lines,
  public.procurement_intelligence_snapshot_source_memberships
FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;
GRANT INSERT ON public.audit_logs TO sco_procurement_intelligence_gateway_owner;
CREATE POLICY audit_logs_procurement_intelligence_gateway_owner_insert
ON public.audit_logs
FOR INSERT TO sco_procurement_intelligence_gateway_owner
WITH CHECK (scope = 'SCO_INTERNAL');

CREATE POLICY procurement_intelligence_decisions_owner_scope
ON public.procurement_intelligence_purpose_decisions
FOR ALL TO sco_procurement_intelligence_gateway_owner
USING (authorization_company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID)
WITH CHECK (authorization_company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);
CREATE POLICY procurement_intelligence_runs_owner
ON public.procurement_intelligence_runs
FOR ALL TO sco_procurement_intelligence_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY procurement_intelligence_snapshots_owner
ON public.procurement_intelligence_snapshots
FOR ALL TO sco_procurement_intelligence_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY procurement_intelligence_lines_owner
ON public.procurement_intelligence_snapshot_lines
FOR ALL TO sco_procurement_intelligence_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY procurement_intelligence_memberships_owner
ON public.procurement_intelligence_snapshot_source_memberships
FOR ALL TO sco_procurement_intelligence_gateway_owner USING (true) WITH CHECK (true);

GRANT SELECT ON
  public.buying_power_aggregation_runs,
  public.buying_power_snapshots,
  public.buying_power_snapshot_lines,
  public.buying_power_snapshot_source_memberships,
  public.product_identities,
  public.unit_definitions
TO sco_procurement_intelligence_gateway_owner;

CREATE POLICY buying_power_runs_procurement_intelligence_source
ON public.buying_power_aggregation_runs
FOR SELECT TO sco_procurement_intelligence_gateway_owner USING (true);
CREATE POLICY buying_power_snapshots_procurement_intelligence_source
ON public.buying_power_snapshots
FOR SELECT TO sco_procurement_intelligence_gateway_owner USING (true);
CREATE POLICY buying_power_lines_procurement_intelligence_source
ON public.buying_power_snapshot_lines
FOR SELECT TO sco_procurement_intelligence_gateway_owner USING (true);
CREATE POLICY buying_power_memberships_procurement_intelligence_source
ON public.buying_power_snapshot_source_memberships
FOR SELECT TO sco_procurement_intelligence_gateway_owner USING (true);
CREATE POLICY product_identities_procurement_intelligence_source
ON public.product_identities
FOR SELECT TO sco_procurement_intelligence_gateway_owner USING (true);
CREATE POLICY unit_definitions_procurement_intelligence_source
ON public.unit_definitions
FOR SELECT TO sco_procurement_intelligence_gateway_owner USING (true);

CREATE FUNCTION public.procurement_intelligence_capability_context(
  p_actor UUID,
  p_capability TEXT
) RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT cm."companyId"
  FROM public."CompanyMembership" cm
  JOIN public."Company" c ON c.id = cm."companyId" AND c.type = 'SCO' AND c.status = 'ACTIVE'
  JOIN public."MembershipRole" mr ON mr.membership_id = cm.id
  JOIN public."RolePermission" rp ON rp.role_id = mr.role_id
  JOIN public."Permission" p ON p.id = rp.permission_id
  WHERE cm."userId" = p_actor
    AND cm.status = 'ACTIVE'
    AND p.code = p_capability
  ORDER BY cm."companyId"
  LIMIT 1
$$;
ALTER FUNCTION public.procurement_intelligence_capability_context(UUID, TEXT) OWNER TO sco_internal_gateway_owner;
REVOKE ALL ON FUNCTION public.procurement_intelligence_capability_context(UUID, TEXT)
FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;
GRANT EXECUTE ON FUNCTION public.procurement_intelligence_capability_context(UUID, TEXT)
TO sco_procurement_intelligence_gateway_owner;

CREATE FUNCTION public.issue_procurement_intelligence_purpose_decision(
  p_actor UUID,
  p_source_buying_power_snapshot UUID
) RETURNS TABLE(decision_id UUID, authorization_company_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_authorization_company UUID;
  v_decision UUID;
BEGIN
  IF session_user <> 'sco_purpose_authority' THEN
    RAISE EXCEPTION 'PROCUREMENT_INTELLIGENCE_PURPOSE_ISSUE_FORBIDDEN';
  END IF;
  v_authorization_company := public.procurement_intelligence_capability_context(p_actor, 'procurement_intelligence.aggregate');
  IF v_authorization_company IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.buying_power_snapshots s
    JOIN public.buying_power_aggregation_runs r ON r.id = s.aggregation_run_id
    WHERE s.id = p_source_buying_power_snapshot
      AND r.status = 'PUBLISHED'
  ) THEN
    RAISE EXCEPTION 'PROCUREMENT_INTELLIGENCE_PURPOSE_ISSUE_FORBIDDEN';
  END IF;
  PERFORM set_config('app.tenant_id', v_authorization_company::TEXT, true);
  INSERT INTO public.procurement_intelligence_purpose_decisions (
    actor_user_id, authorization_company_id, source_buying_power_snapshot_id,
    operation, purpose_code, flow_cpf_id, expires_at
  ) VALUES (
    p_actor, v_authorization_company, p_source_buying_power_snapshot,
    'PI_SNAPSHOT_MATERIALIZE', 'PUR-17', 'CPF_33', clock_timestamp() + INTERVAL '30 seconds'
  ) RETURNING id INTO v_decision;
  RETURN QUERY SELECT v_decision, v_authorization_company;
END
$$;

CREATE FUNCTION public.consume_procurement_intelligence_purpose_decision(
  p_decision UUID,
  p_actor UUID,
  p_authorization_company UUID,
  p_source_buying_power_snapshot UUID,
  p_backend_pid INTEGER,
  p_transaction_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF session_user <> 'sco_purpose_authority' OR p_backend_pid <= 0 OR p_transaction_id <= 0 THEN
    RAISE EXCEPTION 'PROCUREMENT_INTELLIGENCE_PURPOSE_CONSUME_FORBIDDEN';
  END IF;
  PERFORM set_config('app.tenant_id', p_authorization_company::TEXT, true);
  UPDATE public.procurement_intelligence_purpose_decisions
     SET consumed_at = clock_timestamp(),
         consumed_backend_pid = p_backend_pid,
         consumed_transaction_id = p_transaction_id
   WHERE id = p_decision
     AND actor_user_id = p_actor
     AND authorization_company_id = p_authorization_company
     AND source_buying_power_snapshot_id = p_source_buying_power_snapshot
     AND operation = 'PI_SNAPSHOT_MATERIALIZE'
     AND purpose_code = 'PUR-17'
     AND flow_cpf_id = 'CPF_33'
     AND consumed_at IS NULL
     AND expires_at > clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROCUREMENT_INTELLIGENCE_PURPOSE_CONSUME_FORBIDDEN';
  END IF;
END
$$;

CREATE FUNCTION public.procurement_intelligence_purpose_authorized(
  p_decision UUID,
  p_actor UUID,
  p_authorization_company UUID,
  p_source_buying_power_snapshot UUID
) RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.procurement_intelligence_purpose_decisions
    WHERE id = p_decision
      AND actor_user_id = p_actor
      AND authorization_company_id = p_authorization_company
      AND source_buying_power_snapshot_id = p_source_buying_power_snapshot
      AND operation = 'PI_SNAPSHOT_MATERIALIZE'
      AND purpose_code = 'PUR-17'
      AND flow_cpf_id = 'CPF_33'
      AND consumed_at IS NOT NULL
      AND expires_at > clock_timestamp()
      AND consumed_backend_pid = pg_backend_pid()
      AND consumed_transaction_id = txid_current()
  )
$$;

CREATE FUNCTION public.prevent_procurement_intelligence_run_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'STARTED'
     AND NEW.status IN ('PUBLISHED', 'FAILED')
     AND current_setting('app.procurement_intelligence_gateway', true) = 'true' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'PROCUREMENT_INTELLIGENCE_HISTORY_IMMUTABLE';
END
$$;

CREATE FUNCTION public.prevent_procurement_intelligence_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'PROCUREMENT_INTELLIGENCE_HISTORY_IMMUTABLE';
END
$$;

CREATE TRIGGER procurement_intelligence_runs_immutable
BEFORE UPDATE OR DELETE ON public.procurement_intelligence_runs
FOR EACH ROW EXECUTE FUNCTION public.prevent_procurement_intelligence_run_mutation();
CREATE TRIGGER procurement_intelligence_snapshots_immutable
BEFORE UPDATE OR DELETE ON public.procurement_intelligence_snapshots
FOR EACH ROW EXECUTE FUNCTION public.prevent_procurement_intelligence_history_mutation();
CREATE TRIGGER procurement_intelligence_snapshot_lines_immutable
BEFORE UPDATE OR DELETE ON public.procurement_intelligence_snapshot_lines
FOR EACH ROW EXECUTE FUNCTION public.prevent_procurement_intelligence_history_mutation();
CREATE TRIGGER procurement_intelligence_snapshot_source_memberships_immutable
BEFORE UPDATE OR DELETE ON public.procurement_intelligence_snapshot_source_memberships
FOR EACH ROW EXECUTE FUNCTION public.prevent_procurement_intelligence_history_mutation();

CREATE FUNCTION public.internal_procurement_intelligence_run(
  p_actor UUID,
  p_source_buying_power_snapshot UUID,
  p_request_key TEXT,
  p_correlation UUID,
  p_decision UUID
) RETURNS TABLE(run_id UUID, snapshot_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_authorization_company UUID;
  v_source RECORD;
  v_existing RECORD;
  v_run UUID := gen_random_uuid();
  v_snapshot UUID := gen_random_uuid();
BEGIN
  IF session_user <> 'sco_internal_executor'
     OR btrim(COALESCE(p_request_key, '')) = '' THEN
    RAISE EXCEPTION 'PROCUREMENT_INTELLIGENCE_FORBIDDEN';
  END IF;
  v_authorization_company := public.procurement_intelligence_capability_context(p_actor, 'procurement_intelligence.aggregate');
  IF v_authorization_company IS NULL THEN
    RAISE EXCEPTION 'PROCUREMENT_INTELLIGENCE_FORBIDDEN';
  END IF;
  PERFORM set_config('app.tenant_id', v_authorization_company::TEXT, true);
  IF NOT public.procurement_intelligence_purpose_authorized(p_decision, p_actor, v_authorization_company, p_source_buying_power_snapshot) THEN
    RAISE EXCEPTION 'PROCUREMENT_INTELLIGENCE_FORBIDDEN';
  END IF;
  UPDATE public.procurement_intelligence_purpose_decisions
     SET executed_at = clock_timestamp()
   WHERE id = p_decision
     AND actor_user_id = p_actor
     AND authorization_company_id = v_authorization_company
     AND source_buying_power_snapshot_id = p_source_buying_power_snapshot
     AND operation = 'PI_SNAPSHOT_MATERIALIZE'
     AND purpose_code = 'PUR-17'
     AND flow_cpf_id = 'CPF_33'
     AND executed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROCUREMENT_INTELLIGENCE_FORBIDDEN';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('procurement-intelligence-request:' || p_request_key));
  PERFORM pg_advisory_xact_lock(hashtext('procurement-intelligence:' || p_source_buying_power_snapshot::TEXT || ':' || p_request_key));
  SELECT s.id, s.horizon, s.time_bucket, s.cutoff_at, s.source_fingerprint
    INTO v_source
    FROM public.buying_power_snapshots s
    JOIN public.buying_power_aggregation_runs r ON r.id = s.aggregation_run_id
   WHERE s.id = p_source_buying_power_snapshot
     AND r.status = 'PUBLISHED'
  ;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROCUREMENT_INTELLIGENCE_SOURCE_INELIGIBLE';
  END IF;

  SELECT id, source_buying_power_snapshot_id, source_fingerprint INTO v_existing
    FROM public.procurement_intelligence_runs
   WHERE request_key = p_request_key;
  IF FOUND THEN
    IF v_existing.source_fingerprint <> v_source.source_fingerprint
       OR v_existing.source_buying_power_snapshot_id <> p_source_buying_power_snapshot THEN
      RAISE EXCEPTION 'PROCUREMENT_INTELLIGENCE_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN QUERY
    SELECT v_existing.id, s.id
    FROM public.procurement_intelligence_snapshots s
    WHERE s.procurement_intelligence_run_id = v_existing.id;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.buying_power_snapshot_lines l
    LEFT JOIN public.product_identities pi ON pi.id = l.product_identity_id AND pi.status = 'ACTIVE'
    LEFT JOIN public.unit_definitions u ON u.id = l.unit_id AND u.active
    WHERE l.snapshot_id = p_source_buying_power_snapshot
      AND (pi.id IS NULL OR u.id IS NULL)
  ) THEN
    RAISE EXCEPTION 'PROCUREMENT_INTELLIGENCE_SOURCE_INELIGIBLE';
  END IF;

  INSERT INTO public.procurement_intelligence_runs (
    id, initiated_by, authority_decision_id, source_buying_power_snapshot_id,
    horizon, time_bucket, cutoff_at, request_key, source_fingerprint, status, correlation_id
  ) VALUES (
    v_run, p_actor, p_decision, p_source_buying_power_snapshot,
    v_source.horizon, v_source.time_bucket, v_source.cutoff_at, p_request_key,
    v_source.source_fingerprint, 'STARTED', p_correlation
  );
  PERFORM set_config('app.procurement_intelligence_gateway', 'true', true);
  INSERT INTO public.procurement_intelligence_snapshots (
    id, procurement_intelligence_run_id, source_buying_power_snapshot_id,
    horizon, time_bucket, cutoff_at, source_fingerprint, published_by, correlation_id
  ) VALUES (
    v_snapshot, v_run, p_source_buying_power_snapshot,
    v_source.horizon, v_source.time_bucket, v_source.cutoff_at,
    v_source.source_fingerprint, p_actor, p_correlation
  );
  INSERT INTO public.procurement_intelligence_snapshot_lines (
    snapshot_id, source_buying_power_snapshot_line_id, product_identity_id, unit_id,
    committed_quantity, potential_quantity, qualified_quantity, open_quantity,
    released_quantity, procured_quantity
  )
  SELECT
    v_snapshot, l.id, l.product_identity_id, l.unit_id,
    l.committed_quantity, l.potential_quantity, l.qualified_quantity, l.open_quantity,
    l.released_quantity, l.procured_quantity
  FROM public.buying_power_snapshot_lines l
  WHERE l.snapshot_id = p_source_buying_power_snapshot;
  INSERT INTO public.procurement_intelligence_snapshot_source_memberships (
    snapshot_line_id, snapshot_id, source_buying_power_snapshot_line_id,
    source_buying_power_snapshot_membership_id, contribution_class, contribution_quantity, unit_id
  )
  SELECT
    pi_line.id, v_snapshot, bp_line.id, membership.id,
    membership.contribution_class, membership.contribution_quantity, membership.unit_id
  FROM public.buying_power_snapshot_source_memberships membership
  JOIN public.buying_power_snapshot_lines bp_line ON bp_line.id = membership.snapshot_line_id
  JOIN public.procurement_intelligence_snapshot_lines pi_line
    ON pi_line.snapshot_id = v_snapshot
   AND pi_line.source_buying_power_snapshot_line_id = bp_line.id
  WHERE membership.snapshot_id = p_source_buying_power_snapshot;

  IF EXISTS (
    SELECT 1
    FROM public.procurement_intelligence_snapshot_source_memberships m
    JOIN public.procurement_intelligence_snapshot_lines l ON l.id = m.snapshot_line_id
    WHERE m.snapshot_id = v_snapshot
      AND (l.snapshot_id <> v_snapshot
       OR m.source_buying_power_snapshot_line_id <> l.source_buying_power_snapshot_line_id
      )
  ) THEN
    RAISE EXCEPTION 'PROCUREMENT_INTELLIGENCE_SOURCE_INELIGIBLE';
  END IF;

  INSERT INTO public.audit_logs (
    actor_user_id, company_id, scope, action, entity_type, entity_id, metadata,
    correlation_id, purpose_code, flow_cpf_id, flow_source, flow_target, authorization_decision
  ) VALUES (
    p_actor, v_authorization_company, 'SCO_INTERNAL',
    'procurement_intelligence.snapshot.published',
    'ProcurementIntelligenceSnapshot', v_snapshot,
    jsonb_build_object('runId', v_run, 'status', 'PUBLISHED'),
    p_correlation, 'PUR-17', 'CPF_33', 'PUR-06', 'PUR-17', 'ALLOWED'
  );
  UPDATE public.procurement_intelligence_runs
     SET status = 'PUBLISHED', completed_at = clock_timestamp()
   WHERE id = v_run;
  RETURN QUERY SELECT v_run, v_snapshot;
END
$$;

CREATE FUNCTION public.internal_procurement_intelligence_summary_view(
  p_actor UUID,
  p_snapshot UUID
) RETURNS TABLE(
  snapshot_id UUID,
  product_identity_id UUID,
  unit_id UUID,
  horizon "BuyingPowerHorizon",
  time_bucket DATE,
  committed_quantity NUMERIC,
  potential_quantity NUMERIC,
  qualified_quantity NUMERIC,
  open_quantity NUMERIC,
  released_quantity NUMERIC,
  procured_quantity NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.id, l.product_identity_id, l.unit_id, s.horizon, s.time_bucket,
         l.committed_quantity, l.potential_quantity, l.qualified_quantity,
         l.open_quantity, l.released_quantity, l.procured_quantity
  FROM public.procurement_intelligence_snapshots s
  JOIN public.procurement_intelligence_runs r
    ON r.id = s.procurement_intelligence_run_id AND r.status = 'PUBLISHED'
  JOIN public.procurement_intelligence_snapshot_lines l ON l.snapshot_id = s.id
  WHERE s.id = p_snapshot
    AND public.procurement_intelligence_capability_context(p_actor, 'procurement_intelligence.read_summary') IS NOT NULL
$$;

CREATE FUNCTION public.internal_procurement_intelligence_lineage_view(
  p_actor UUID,
  p_snapshot UUID
) RETURNS TABLE(
  snapshot_id UUID,
  snapshot_line_id UUID,
  source_buying_power_snapshot_line_id UUID,
  source_buying_power_snapshot_membership_id UUID,
  product_identity_id UUID,
  unit_id UUID,
  contribution_class TEXT,
  contribution_quantity NUMERIC,
  horizon "BuyingPowerHorizon",
  time_bucket DATE
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.id, l.id, m.source_buying_power_snapshot_line_id,
         m.source_buying_power_snapshot_membership_id,
         l.product_identity_id, l.unit_id, m.contribution_class,
         m.contribution_quantity, s.horizon, s.time_bucket
  FROM public.procurement_intelligence_snapshots s
  JOIN public.procurement_intelligence_runs r
    ON r.id = s.procurement_intelligence_run_id AND r.status = 'PUBLISHED'
  JOIN public.procurement_intelligence_snapshot_lines l ON l.snapshot_id = s.id
  JOIN public.procurement_intelligence_snapshot_source_memberships m
    ON m.snapshot_line_id = l.id AND m.snapshot_id = s.id
  WHERE s.id = p_snapshot
    AND public.procurement_intelligence_capability_context(p_actor, 'procurement_intelligence.read_lineage') IS NOT NULL
$$;

ALTER FUNCTION public.issue_procurement_intelligence_purpose_decision(UUID, UUID)
  OWNER TO sco_procurement_intelligence_gateway_owner;
ALTER FUNCTION public.consume_procurement_intelligence_purpose_decision(UUID, UUID, UUID, UUID, INTEGER, BIGINT)
  OWNER TO sco_procurement_intelligence_gateway_owner;
ALTER FUNCTION public.procurement_intelligence_purpose_authorized(UUID, UUID, UUID, UUID)
  OWNER TO sco_procurement_intelligence_gateway_owner;
ALTER FUNCTION public.prevent_procurement_intelligence_history_mutation()
  OWNER TO sco_procurement_intelligence_gateway_owner;
ALTER FUNCTION public.prevent_procurement_intelligence_run_mutation()
  OWNER TO sco_procurement_intelligence_gateway_owner;
ALTER FUNCTION public.internal_procurement_intelligence_run(UUID, UUID, TEXT, UUID, UUID)
  OWNER TO sco_procurement_intelligence_gateway_owner;
ALTER FUNCTION public.internal_procurement_intelligence_summary_view(UUID, UUID)
  OWNER TO sco_procurement_intelligence_gateway_owner;
ALTER FUNCTION public.internal_procurement_intelligence_lineage_view(UUID, UUID)
  OWNER TO sco_procurement_intelligence_gateway_owner;

REVOKE ALL ON FUNCTION
  public.issue_procurement_intelligence_purpose_decision(UUID, UUID),
  public.consume_procurement_intelligence_purpose_decision(UUID, UUID, UUID, UUID, INTEGER, BIGINT),
  public.procurement_intelligence_purpose_authorized(UUID, UUID, UUID, UUID),
  public.prevent_procurement_intelligence_run_mutation(),
  public.prevent_procurement_intelligence_history_mutation(),
  public.internal_procurement_intelligence_run(UUID, UUID, TEXT, UUID, UUID),
  public.internal_procurement_intelligence_summary_view(UUID, UUID),
  public.internal_procurement_intelligence_lineage_view(UUID, UUID)
FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;

GRANT EXECUTE ON FUNCTION
  public.issue_procurement_intelligence_purpose_decision(UUID, UUID),
  public.consume_procurement_intelligence_purpose_decision(UUID, UUID, UUID, UUID, INTEGER, BIGINT)
TO sco_purpose_authority;
GRANT EXECUTE ON FUNCTION
  public.internal_procurement_intelligence_run(UUID, UUID, TEXT, UUID, UUID),
  public.internal_procurement_intelligence_summary_view(UUID, UUID),
  public.internal_procurement_intelligence_lineage_view(UUID, UUID)
TO sco_internal_executor;
