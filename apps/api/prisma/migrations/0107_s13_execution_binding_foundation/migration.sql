CREATE TABLE public.partner_collaboration_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  collaboration_id UUID NOT NULL REFERENCES public.partner_collaborations(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'TERMINATION_REQUESTED', 'TERMINATED', 'FAILED')),
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  terminated_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK ((state IN ('OPEN', 'TERMINATION_REQUESTED') AND terminated_at IS NULL)
      OR (state IN ('TERMINATED', 'FAILED') AND terminated_at IS NOT NULL))
);

CREATE UNIQUE INDEX partner_collaboration_executions_id_company_collaboration_unique
  ON public.partner_collaboration_executions(id, company_id, collaboration_id);

CREATE UNIQUE INDEX partner_collaborations_id_company_unique
  ON public.partner_collaborations(id, company_id);

CREATE UNIQUE INDEX partner_collaborations_id_company_workspace_unique
  ON public.partner_collaborations(id, company_id, workspace_id);

CREATE UNIQUE INDEX partner_collaboration_participations_id_company_collaboration_unique
  ON public.partner_collaboration_participations(id, company_id, collaboration_id);

CREATE UNIQUE INDEX partner_collaboration_one_open_execution
  ON public.partner_collaboration_executions(collaboration_id)
  WHERE state IN ('OPEN', 'TERMINATION_REQUESTED');
CREATE INDEX partner_collaboration_executions_company_idx
  ON public.partner_collaboration_executions(company_id, collaboration_id, created_at DESC);

CREATE TABLE public.partner_participant_execution_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  collaboration_id UUID NOT NULL,
  execution_id UUID NOT NULL,
  participation_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'INVALIDATED', 'TERMINATED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  invalidated_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK ((state = 'ACTIVE' AND invalidated_at IS NULL)
      OR (state IN ('INVALIDATED', 'TERMINATED') AND invalidated_at IS NOT NULL)),
  UNIQUE (execution_id, participation_id)
);

ALTER TABLE public.partner_collaboration_executions
  ADD CONSTRAINT partner_collaboration_executions_company_collaboration_fk
  FOREIGN KEY (collaboration_id, company_id)
  REFERENCES public.partner_collaborations(id, company_id)
  ON DELETE RESTRICT;

ALTER TABLE public.partner_participant_execution_bindings
  ADD CONSTRAINT partner_participant_execution_bindings_id_company_execution_participation_collaboration_unique
  UNIQUE (id, company_id, execution_id, participation_id, collaboration_id);

/* The unique constraint above is the FK support; retain the named index only for catalog evidence. */
/* no-op comment: PostgreSQL uses the unique constraint's backing index */

ALTER TABLE public.partner_participant_execution_bindings
  ADD CONSTRAINT partner_participant_execution_bindings_execution_tuple_fk
  FOREIGN KEY (execution_id, company_id, collaboration_id)
  REFERENCES public.partner_collaboration_executions(id, company_id, collaboration_id)
  ON DELETE RESTRICT,
  ADD CONSTRAINT partner_participant_execution_bindings_participation_tuple_fk
  FOREIGN KEY (participation_id, company_id, collaboration_id)
  REFERENCES public.partner_collaboration_participations(id, company_id, collaboration_id)
  ON DELETE RESTRICT;

CREATE TABLE public.partner_collaboration_execution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  collaboration_id UUID NOT NULL,
  execution_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATED', 'ESTABLISHED', 'TERMINATION_REQUESTED', 'TERMINATED', 'FAILED')),
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_user_id UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  correlation_id UUID NOT NULL,
  provenance TEXT NOT NULL CHECK (btrim(provenance) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.partner_collaboration_execution_events
  ADD CONSTRAINT partner_collaboration_execution_events_execution_tuple_fk
  FOREIGN KEY (execution_id, company_id, collaboration_id)
  REFERENCES public.partner_collaboration_executions(id, company_id, collaboration_id)
  ON DELETE RESTRICT;

CREATE TABLE public.partner_participant_execution_binding_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  collaboration_id UUID NOT NULL,
  execution_id UUID NOT NULL,
  binding_id UUID NOT NULL,
  participation_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATED', 'INVALIDATED', 'TERMINATED')),
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_user_id UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  correlation_id UUID NOT NULL,
  provenance TEXT NOT NULL CHECK (btrim(provenance) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.partner_participant_execution_binding_events
  ADD CONSTRAINT partner_participant_execution_binding_events_binding_tuple_fk
  FOREIGN KEY (binding_id, company_id, execution_id, participation_id, collaboration_id)
  REFERENCES public.partner_participant_execution_bindings(id, company_id, execution_id, participation_id, collaboration_id)
  ON DELETE RESTRICT;

CREATE INDEX partner_collaboration_execution_events_latest_idx
  ON public.partner_collaboration_execution_events(execution_id, created_at DESC, id DESC);
CREATE INDEX partner_participant_execution_binding_events_latest_idx
  ON public.partner_participant_execution_binding_events(binding_id, created_at DESC, id DESC);

CREATE INDEX partner_participant_execution_bindings_company_idx
  ON public.partner_participant_execution_bindings(company_id, execution_id, state);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'partner_collaboration_executions', 'partner_participant_execution_bindings',
    'partner_collaboration_execution_events', 'partner_participant_execution_binding_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I OWNER TO sco_collaboration_gateway_owner', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO sco_collaboration_gateway_owner USING (true) WITH CHECK (true)', table_name || '_gateway_owner', table_name);
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.partner_collaboration_executions, public.partner_participant_execution_bindings
  FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;
REVOKE ALL ON TABLE public.partner_collaboration_execution_events, public.partner_participant_execution_binding_events
  FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;

GRANT INSERT ON public.partner_collaboration_execution_events, public.partner_participant_execution_binding_events
  TO sco_collaboration_gateway_owner;

CREATE FUNCTION public.s13_execution_history_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'S13_EXECUTION_HISTORY_IMMUTABLE';
END
$$;

CREATE TRIGGER partner_collaboration_execution_events_immutable
BEFORE UPDATE OR DELETE ON public.partner_collaboration_execution_events
FOR EACH ROW EXECUTE FUNCTION public.s13_execution_history_immutable();
CREATE TRIGGER partner_participant_execution_binding_events_immutable
BEFORE UPDATE OR DELETE ON public.partner_participant_execution_binding_events
FOR EACH ROW EXECUTE FUNCTION public.s13_execution_history_immutable();

CREATE FUNCTION public.s13_execution_invalidate_bindings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'partner_collaborations' AND NEW.state = 'ARCHIVED' AND OLD.state IS DISTINCT FROM NEW.state THEN
    INSERT INTO public.partner_participant_execution_binding_events
      (company_id, collaboration_id, execution_id, binding_id, participation_id, event_type, from_state, to_state, correlation_id, provenance)
    SELECT b.company_id, e.collaboration_id, b.execution_id, b.id, b.participation_id,
           'INVALIDATED', 'ACTIVE', 'INVALIDATED', gen_random_uuid(), 'system-collaboration-archive'
      FROM public.partner_participant_execution_bindings b
      JOIN public.partner_collaboration_executions e ON e.id = b.execution_id
     WHERE b.company_id = NEW.company_id AND e.collaboration_id = NEW.id AND b.state = 'ACTIVE';
    UPDATE public.partner_participant_execution_bindings b
       SET state = 'INVALIDATED', invalidated_at = clock_timestamp(), version = b.version + 1
     WHERE b.company_id = NEW.company_id
       AND b.execution_id IN (SELECT e.id FROM public.partner_collaboration_executions e WHERE e.collaboration_id = NEW.id)
       AND b.state = 'ACTIVE';
  ELSIF TG_TABLE_NAME = 'partner_collaboration_participations' AND NEW.state = 'REVOKED' AND OLD.state IS DISTINCT FROM NEW.state THEN
    INSERT INTO public.partner_participant_execution_binding_events
      (company_id, collaboration_id, execution_id, binding_id, participation_id, event_type, from_state, to_state, correlation_id, provenance)
    SELECT b.company_id, e.collaboration_id, b.execution_id, b.id, b.participation_id,
           'INVALIDATED', 'ACTIVE', 'INVALIDATED', gen_random_uuid(), 'system-participation-revoke'
      FROM public.partner_participant_execution_bindings b
      JOIN public.partner_collaboration_executions e ON e.id = b.execution_id
     WHERE b.company_id = NEW.company_id AND b.participation_id = NEW.id AND b.state = 'ACTIVE';
    UPDATE public.partner_participant_execution_bindings b
       SET state = 'INVALIDATED', invalidated_at = clock_timestamp(), version = b.version + 1
     WHERE b.company_id = NEW.company_id AND b.participation_id = NEW.id AND b.state = 'ACTIVE';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER partner_collaboration_execution_archive_invalidate
AFTER UPDATE OF state ON public.partner_collaborations
FOR EACH ROW EXECUTE FUNCTION public.s13_execution_invalidate_bindings();
CREATE TRIGGER partner_participant_execution_revoke_invalidate
AFTER UPDATE OF state ON public.partner_collaboration_participations
FOR EACH ROW EXECUTE FUNCTION public.s13_execution_invalidate_bindings();

CREATE FUNCTION public.s13_execution_context(p_company UUID, p_collaboration UUID, p_permission TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE actor UUID;
DECLARE tenant UUID;
BEGIN
  tenant := public.s13_uuid_setting('app.tenant_id');
  actor := public.s13_require_context(tenant, p_permission);
  IF p_company IS NULL OR p_company IS DISTINCT FROM tenant
     OR NOT EXISTS (
       SELECT 1 FROM public.partner_collaborations c
       WHERE c.id = p_collaboration AND c.company_id = tenant AND c.state = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION 'EXECUTION_COLLABORATION_FORBIDDEN';
  END IF;
  RETURN actor;
END
$$;

CREATE FUNCTION public.s13_collaboration_execution_ensure(p_collaboration_id UUID, p_correlation_id UUID)
RETURNS TABLE(id UUID, company_id UUID, collaboration_id UUID, state TEXT, version INTEGER, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE actor UUID;
DECLARE tenant UUID;
DECLARE execution public.partner_collaboration_executions%ROWTYPE;
BEGIN
  tenant := public.s13_uuid_setting('app.tenant_id');
  actor := public.s13_execution_context(tenant, p_collaboration_id, 'partner.collaboration.manage');
  -- Lock order: Collaboration before Execution.
  PERFORM 1 FROM public.partner_collaborations c WHERE c.id = p_collaboration_id AND c.company_id = tenant FOR KEY SHARE;
  IF NOT EXISTS (SELECT 1 FROM public.partner_collaborations c WHERE c.id = p_collaboration_id AND c.company_id = tenant AND c.state = 'ACTIVE') THEN
    RAISE EXCEPTION 'EXECUTION_COLLABORATION_FORBIDDEN';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(tenant::TEXT || ':s13-execution:' || p_collaboration_id::TEXT, 1314));
  SELECT * INTO execution FROM public.partner_collaboration_executions e
   WHERE e.company_id = tenant AND e.collaboration_id = p_collaboration_id
     AND e.state IN ('OPEN', 'TERMINATION_REQUESTED')
   ORDER BY e.created_at DESC, e.id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.partner_collaboration_executions(company_id, collaboration_id, created_by)
    VALUES (tenant, p_collaboration_id, actor) RETURNING * INTO execution;
    INSERT INTO public.partner_collaboration_execution_events
      (company_id, collaboration_id, execution_id, event_type, to_state, actor_user_id, correlation_id, provenance)
    VALUES (tenant, p_collaboration_id, execution.id, 'CREATED', execution.state, actor, p_correlation_id, 's13-collaboration-execution-ensure');
  END IF;
  RETURN QUERY SELECT execution.id, execution.company_id, execution.collaboration_id, execution.state, execution.version, execution.created_at;
END
$$;

CREATE FUNCTION public.s13_participant_execution_binding_bind(p_execution_id UUID, p_participation_id UUID, p_correlation_id UUID)
RETURNS TABLE(id UUID, company_id UUID, collaboration_id UUID, execution_id UUID, participation_id UUID, state TEXT, version INTEGER, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE actor UUID;
DECLARE tenant UUID;
DECLARE binding public.partner_participant_execution_bindings%ROWTYPE;
DECLARE execution public.partner_collaboration_executions%ROWTYPE;
BEGIN
  tenant := public.s13_uuid_setting('app.tenant_id');
  SELECT * INTO execution FROM public.partner_collaboration_executions e WHERE e.id = p_execution_id AND e.company_id = tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXECUTION_BINDING_FORBIDDEN'; END IF;
  actor := public.s13_execution_context(tenant, execution.collaboration_id, 'partner.collaboration.participate');
  -- Lock order: Collaboration -> Execution -> Participation -> Binding.
  -- Authority is re-evaluated AFTER these locks (pre-lock check alone is insufficient).
  PERFORM 1 FROM public.partner_collaborations c WHERE c.id = execution.collaboration_id AND c.company_id = tenant FOR KEY SHARE;
  SELECT * INTO execution FROM public.partner_collaboration_executions e WHERE e.id = p_execution_id AND e.company_id = tenant FOR KEY SHARE;
  PERFORM 1 FROM public.partner_collaboration_participations p
   WHERE p.id = p_participation_id AND p.company_id = tenant AND p.collaboration_id = execution.collaboration_id
   FOR KEY SHARE;
  IF execution.state <> 'OPEN' OR NOT EXISTS (
    SELECT 1
    FROM public.partner_collaboration_participations p
    JOIN public.partner_collaborations c ON c.id = p.collaboration_id AND c.company_id = tenant AND c.state = 'ACTIVE'
    JOIN public."CompanyMembership" m ON m.id = p.membership_id AND m."userId" = actor AND m."companyId" = tenant AND m.status = 'ACTIVE'
    JOIN public."User" u ON u.id = m."userId" AND u.status = 'ACTIVE'
    WHERE p.id = p_participation_id AND p.company_id = tenant AND p.collaboration_id = execution.collaboration_id AND p.state = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'EXECUTION_BINDING_FORBIDDEN';
  END IF;
  SELECT b.* INTO binding FROM public.partner_participant_execution_bindings b
   WHERE b.execution_id = p_execution_id AND b.participation_id = p_participation_id FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT binding.id, binding.company_id, binding.collaboration_id, binding.execution_id, binding.participation_id, binding.state, binding.version, binding.created_at;
    RETURN;
  END IF;
  INSERT INTO public.partner_participant_execution_bindings(company_id, collaboration_id, execution_id, participation_id)
  VALUES (tenant, execution.collaboration_id, p_execution_id, p_participation_id)
  ON CONFLICT ON CONSTRAINT partner_participant_execution_execution_id_participation_id_key DO NOTHING
  RETURNING * INTO binding;
  IF NOT FOUND THEN
    SELECT b.* INTO binding FROM public.partner_participant_execution_bindings b
     WHERE b.execution_id = p_execution_id AND b.participation_id = p_participation_id;
    RETURN QUERY SELECT binding.id, binding.company_id, binding.collaboration_id, binding.execution_id, binding.participation_id, binding.state, binding.version, binding.created_at;
    RETURN;
  END IF;
  INSERT INTO public.partner_participant_execution_binding_events
    (company_id, collaboration_id, execution_id, binding_id, participation_id, event_type, to_state, actor_user_id, correlation_id, provenance)
  VALUES (tenant, execution.collaboration_id, binding.execution_id, binding.id, binding.participation_id, 'CREATED', binding.state, actor, p_correlation_id, 's13-participant-execution-binding-bind');
  RETURN QUERY SELECT binding.id, binding.company_id, binding.collaboration_id, binding.execution_id, binding.participation_id, binding.state, binding.version, binding.created_at;
END
$$;

CREATE FUNCTION public.s13_participant_execution_binding_use(p_binding_id UUID)
RETURNS TABLE(id UUID, company_id UUID, execution_id UUID, participation_id UUID, state TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE tenant UUID;
DECLARE actor UUID;
DECLARE binding public.partner_participant_execution_bindings%ROWTYPE;
BEGIN
  tenant := public.s13_uuid_setting('app.tenant_id');
  SELECT * INTO binding FROM public.partner_participant_execution_bindings b WHERE b.id = p_binding_id AND b.company_id = tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXECUTION_BINDING_FORBIDDEN'; END IF;
  actor := public.s13_execution_context(tenant, (SELECT e.collaboration_id FROM public.partner_collaboration_executions e WHERE e.id = binding.execution_id), 'partner.collaboration.participate');
  IF binding.state <> 'ACTIVE' OR NOT EXISTS (
    SELECT 1
    FROM public.partner_collaboration_executions e
    JOIN public.partner_collaborations c ON c.id = e.collaboration_id AND c.state = 'ACTIVE'
    JOIN public.partner_collaboration_participations p ON p.id = binding.participation_id AND p.collaboration_id = e.collaboration_id AND p.company_id = tenant AND p.state = 'ACTIVE'
    JOIN public."CompanyMembership" m ON m.id = p.membership_id AND m."userId" = actor AND m.status = 'ACTIVE'
    JOIN public."User" u ON u.id = m."userId" AND u.status = 'ACTIVE'
    WHERE e.id = binding.execution_id AND e.company_id = tenant AND e.state = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'EXECUTION_BINDING_FORBIDDEN';
  END IF;
  RETURN QUERY SELECT binding.id, binding.company_id, binding.execution_id, binding.participation_id, binding.state;
END
$$;

CREATE FUNCTION public.s13_collaboration_execution_request_termination(p_execution_id UUID, p_correlation_id UUID)
RETURNS TABLE(id UUID, state TEXT, version INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE tenant UUID;
DECLARE actor UUID;
DECLARE execution public.partner_collaboration_executions%ROWTYPE;
BEGIN
  -- F2 Option B: prove manage on the caller tenant BEFORE any execution object read.
  tenant := public.s13_uuid_setting('app.tenant_id');
  actor := public.s13_require_context(tenant, 'partner.collaboration.manage');
  -- Lock order: Collaboration before Execution.
  PERFORM 1 FROM public.partner_collaborations c
   WHERE c.company_id = tenant
     AND c.id = (
       SELECT e0.collaboration_id
         FROM public.partner_collaboration_executions e0
        WHERE e0.id = p_execution_id AND e0.company_id = tenant
     )
   FOR KEY SHARE;
  SELECT e.* INTO execution
    FROM public.partner_collaboration_executions e
    JOIN public.partner_collaborations c
      ON c.id = e.collaboration_id AND c.company_id = tenant AND c.state = 'ACTIVE'
   WHERE e.id = p_execution_id AND e.company_id = tenant
   FOR UPDATE OF e;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXECUTION_FORBIDDEN'; END IF;
  IF execution.state = 'OPEN' THEN
    UPDATE public.partner_collaboration_executions e SET state = 'TERMINATION_REQUESTED', version = e.version + 1 WHERE e.id = p_execution_id RETURNING e.* INTO execution;
    INSERT INTO public.partner_collaboration_execution_events
      (company_id, collaboration_id, execution_id, event_type, from_state, to_state, actor_user_id, correlation_id, provenance)
    VALUES (execution.company_id, execution.collaboration_id, execution.id, 'TERMINATION_REQUESTED', 'OPEN', execution.state, actor, p_correlation_id, 's13-collaboration-execution-request-termination');
  END IF;
  RETURN QUERY SELECT execution.id, execution.state, execution.version;
END
$$;

DO $$
DECLARE function_name TEXT;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    's13_execution_invalidate_bindings', 's13_execution_history_immutable', 's13_execution_context',
    's13_collaboration_execution_ensure', 's13_participant_execution_binding_bind',
    's13_participant_execution_binding_use', 's13_collaboration_execution_request_termination'
  ] LOOP
    EXECUTE format('ALTER FUNCTION public.%I OWNER TO sco_collaboration_gateway_owner', function_name);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.s13_execution_invalidate_bindings(), public.s13_execution_history_immutable(), public.s13_execution_context(UUID, UUID, TEXT), public.s13_collaboration_execution_ensure(UUID, UUID), public.s13_participant_execution_binding_bind(UUID, UUID, UUID), public.s13_participant_execution_binding_use(UUID), public.s13_collaboration_execution_request_termination(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.s13_collaboration_execution_ensure(UUID, UUID), public.s13_participant_execution_binding_bind(UUID, UUID, UUID), public.s13_participant_execution_binding_use(UUID), public.s13_collaboration_execution_request_termination(UUID, UUID) TO sco_runtime;
