DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_collaboration_gateway_owner') THEN
    CREATE ROLE sco_collaboration_gateway_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

ALTER ROLE sco_collaboration_gateway_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE ALL ON SCHEMA public FROM sco_collaboration_gateway_owner;
GRANT USAGE ON SCHEMA public TO sco_collaboration_gateway_owner;

ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_purpose_code_valid;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_purpose_code_valid
  CHECK (purpose_code IS NULL OR purpose_code ~ '^PUR-(0[1-9]|1[0-9])$');
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_flow_source_valid;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_flow_source_valid
  CHECK (flow_source IS NULL OR flow_source ~ '^PUR-(0[1-9]|1[0-9])$');
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_flow_target_valid;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_flow_target_valid
  CHECK (flow_target IS NULL OR flow_target ~ '^PUR-(0[1-9]|1[0-9])$');

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'partner.collaboration.read', 'Read Partner Collaboration resources'),
  (gen_random_uuid(), 'partner.collaboration.create', 'Create Partner Collaboration resources'),
  (gen_random_uuid(), 'partner.collaboration.manage', 'Archive Collaborations and manage Participation'),
  (gen_random_uuid(), 'partner.collaboration.participation.manage', 'Grant and revoke Collaboration Participation'),
  (gen_random_uuid(), 'partner.collaboration.participate', 'Use an existing active Collaboration Participation')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE public.partner_collaborations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.partner_workspaces(id) ON DELETE RESTRICT,
  project_id UUID REFERENCES public.projects(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'ARCHIVED')),
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  archived_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  archived_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK ((state = 'ACTIVE' AND archived_by IS NULL AND archived_at IS NULL)
      OR (state = 'ARCHIVED' AND archived_by IS NOT NULL AND archived_at IS NOT NULL))
);

CREATE INDEX partner_collaborations_company_idx
  ON public.partner_collaborations(company_id, created_at DESC);

CREATE TABLE public.partner_collaboration_participations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  collaboration_id UUID NOT NULL REFERENCES public.partner_collaborations(id) ON DELETE RESTRICT,
  membership_id UUID NOT NULL REFERENCES public."CompanyMembership"(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'REVOKED')),
  granted_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK ((state = 'ACTIVE' AND revoked_by IS NULL AND revoked_at IS NULL)
      OR (state = 'REVOKED' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX partner_collaboration_participation_grant_idempotency_unique
  ON public.partner_collaboration_participations(company_id, granted_by, idempotency_key);

CREATE UNIQUE INDEX partner_collaboration_active_participation_unique
  ON public.partner_collaboration_participations(collaboration_id, membership_id)
  WHERE state = 'ACTIVE';
CREATE INDEX partner_collaboration_participations_company_idx
  ON public.partner_collaboration_participations(company_id, collaboration_id, state);

CREATE TABLE public.partner_collaboration_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  collaboration_id UUID NOT NULL REFERENCES public.partner_collaborations(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATED', 'ARCHIVED')),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.partner_collaboration_participation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  participation_id UUID NOT NULL REFERENCES public.partner_collaboration_participations(id) ON DELETE RESTRICT,
  collaboration_id UUID NOT NULL REFERENCES public.partner_collaborations(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('GRANTED', 'REVOKED')),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX partner_collaboration_events_latest_idx
  ON public.partner_collaboration_events(collaboration_id, created_at DESC, id DESC);
CREATE INDEX partner_collaboration_participation_events_latest_idx
  ON public.partner_collaboration_participation_events(participation_id, created_at DESC, id DESC);

GRANT SELECT ON public."Company", public."User", public."CompanyMembership", public."MembershipRole",
  public."Role", public."RolePermission", public."Permission", public.company_partnerships,
  public.partner_workspaces, public.partner_workspace_project_links,
  public.projects TO sco_collaboration_gateway_owner;
GRANT EXECUTE ON FUNCTION public.partner_required_agreements_satisfied(UUID) TO sco_collaboration_gateway_owner;
GRANT INSERT ON public.partner_collaboration_events, public.partner_collaboration_participation_events,
  public.audit_logs TO sco_collaboration_gateway_owner;

CREATE POLICY collaboration_gateway_company_read ON public."Company"
  FOR SELECT TO sco_collaboration_gateway_owner USING (true);
CREATE POLICY collaboration_gateway_user_read ON public."User"
  FOR SELECT TO sco_collaboration_gateway_owner USING (true);
CREATE POLICY collaboration_gateway_membership_read ON public."CompanyMembership"
  FOR SELECT TO sco_collaboration_gateway_owner USING (true);
CREATE POLICY collaboration_gateway_membership_role_read ON public."MembershipRole"
  FOR SELECT TO sco_collaboration_gateway_owner USING (true);
CREATE POLICY collaboration_gateway_role_read ON public."Role"
  FOR SELECT TO sco_collaboration_gateway_owner USING (true);
CREATE POLICY collaboration_gateway_role_permission_read ON public."RolePermission"
  FOR SELECT TO sco_collaboration_gateway_owner USING (true);
CREATE POLICY collaboration_gateway_permission_read ON public."Permission"
  FOR SELECT TO sco_collaboration_gateway_owner USING (true);
CREATE POLICY collaboration_gateway_partnership_read ON public.company_partnerships
  FOR SELECT TO sco_collaboration_gateway_owner USING (true);
CREATE POLICY collaboration_gateway_workspace_read ON public.partner_workspaces
  FOR SELECT TO sco_collaboration_gateway_owner USING (true);
CREATE POLICY collaboration_gateway_workspace_project_read ON public.partner_workspace_project_links
  FOR SELECT TO sco_collaboration_gateway_owner USING (true);
CREATE POLICY collaboration_gateway_projects_read ON public.projects
  FOR SELECT TO sco_collaboration_gateway_owner USING (true);
CREATE POLICY collaboration_gateway_audit_insert ON public.audit_logs
  FOR INSERT TO sco_collaboration_gateway_owner WITH CHECK (true);
CREATE POLICY collaboration_gateway_event_insert ON public.partner_collaboration_events
  FOR INSERT TO sco_collaboration_gateway_owner WITH CHECK (true);
CREATE POLICY collaboration_gateway_participation_event_insert ON public.partner_collaboration_participation_events
  FOR INSERT TO sco_collaboration_gateway_owner WITH CHECK (true);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'partner_collaborations', 'partner_collaboration_participations',
    'partner_collaboration_events', 'partner_collaboration_participation_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I OWNER TO sco_collaboration_gateway_owner', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO sco_collaboration_gateway_owner USING (true) WITH CHECK (true)', table_name || '_gateway_owner', table_name);
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.partner_collaborations, public.partner_collaboration_participations,
  public.partner_collaboration_events, public.partner_collaboration_participation_events
  FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;

CREATE FUNCTION public.s13_uuid_setting(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE value_text TEXT;
BEGIN
  value_text := NULLIF(current_setting(p_name, true), '');
  IF value_text IS NULL THEN RAISE EXCEPTION 'COLLABORATION_CONTEXT_FORBIDDEN'; END IF;
  BEGIN RETURN value_text::UUID;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'COLLABORATION_CONTEXT_FORBIDDEN';
  END;
END
$$;

CREATE FUNCTION public.s13_require_context(p_company UUID, p_permission TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE actor UUID;
DECLARE tenant UUID;
BEGIN
  IF session_user <> 'sco_runtime' THEN RAISE EXCEPTION 'COLLABORATION_CONTEXT_FORBIDDEN'; END IF;
  actor := public.s13_uuid_setting('app.actor_id');
  tenant := public.s13_uuid_setting('app.tenant_id');
  IF p_company IS NULL OR p_company IS DISTINCT FROM tenant THEN RAISE EXCEPTION 'COLLABORATION_CONTEXT_FORBIDDEN'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."Company" c
    WHERE c.id = tenant AND c.type = 'PARTNER' AND c.status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'COLLABORATION_CONTEXT_FORBIDDEN'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public."User" u
    JOIN public."CompanyMembership" m ON m."userId" = u.id
    WHERE u.id = actor AND u.status = 'ACTIVE'
      AND m."companyId" = tenant AND m.status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'COLLABORATION_CONTEXT_FORBIDDEN'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public."CompanyMembership" m
    JOIN public."MembershipRole" mr ON mr.membership_id = m.id AND mr.company_id = tenant
    JOIN public."RolePermission" rp ON rp.role_id = mr.role_id AND rp.company_id = tenant
    JOIN public."Permission" p ON p.id = rp.permission_id AND p.code = 'partner.portal.read'
    JOIN public."User" u ON u.id = m."userId" AND u.status = 'ACTIVE'
    WHERE m."userId" = actor AND m."companyId" = tenant AND m.status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'COLLABORATION_PERMISSION_FORBIDDEN'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public."CompanyMembership" m
    JOIN public."MembershipRole" mr ON mr.membership_id = m.id AND mr.company_id = tenant
    JOIN public."RolePermission" rp ON rp.role_id = mr.role_id AND rp.company_id = tenant
    JOIN public."Permission" p ON p.id = rp.permission_id AND p.code = p_permission
    WHERE m."userId" = actor AND m."companyId" = tenant AND m.status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'COLLABORATION_PERMISSION_FORBIDDEN'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_partnerships partnership
    WHERE partnership.company_id = tenant
      AND partnership.type = 'BUYER_PARTNERSHIP'
      AND partnership.status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'COLLABORATION_PARTNER_INELIGIBLE'; END IF;
  IF NOT public.partner_required_agreements_satisfied(tenant) THEN
    RAISE EXCEPTION 'COLLABORATION_PARTNER_INELIGIBLE';
  END IF;
  RETURN actor;
END
$$;

CREATE FUNCTION public.s13_collaboration_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'COLLABORATION_COMPANY_IMMUTABLE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."Company" c WHERE c.id = NEW.company_id AND c.type = 'PARTNER' AND c.status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'COLLABORATION_COMPANY_FORBIDDEN'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.partner_workspaces w
    WHERE w.id = NEW.workspace_id AND w.company_id = NEW.company_id AND w.state = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'COLLABORATION_WORKSPACE_FORBIDDEN'; END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.partner_workspace_project_links link
    JOIN public.projects project ON project.id = link.project_id AND project.company_id = NEW.company_id
    WHERE link.workspace_id = NEW.workspace_id AND link.company_id = NEW.company_id AND link.project_id = NEW.project_id
  ) THEN RAISE EXCEPTION 'COLLABORATION_PROJECT_FORBIDDEN'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN RAISE EXCEPTION 'COLLABORATION_WORKSPACE_IMMUTABLE'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN RAISE EXCEPTION 'COLLABORATION_PROJECT_IMMUTABLE'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.state = 'ARCHIVED' AND NEW.state <> 'ARCHIVED' THEN RAISE EXCEPTION 'COLLABORATION_ARCHIVE_TERMINAL'; END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.s13_participation_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'PARTICIPATION_COMPANY_IMMUTABLE'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.partner_collaborations c
    WHERE c.id = NEW.collaboration_id AND c.company_id = NEW.company_id AND c.state = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'PARTICIPATION_COLLABORATION_FORBIDDEN'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."CompanyMembership" m
    JOIN public."User" u ON u.id = m."userId" AND u.status = 'ACTIVE'
    WHERE m.id = NEW.membership_id AND m."companyId" = NEW.company_id AND m.status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'PARTICIPATION_MEMBERSHIP_FORBIDDEN'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.state = 'REVOKED' AND NEW.state <> 'REVOKED' THEN RAISE EXCEPTION 'PARTICIPATION_REVOKE_TERMINAL'; END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER partner_collaboration_validate_trigger
BEFORE INSERT OR UPDATE ON public.partner_collaborations
FOR EACH ROW EXECUTE FUNCTION public.s13_collaboration_validate();
CREATE TRIGGER partner_collaboration_participation_validate_trigger
BEFORE INSERT OR UPDATE ON public.partner_collaboration_participations
FOR EACH ROW EXECUTE FUNCTION public.s13_participation_validate();

CREATE FUNCTION public.s13_immutable_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'COLLABORATION_HISTORY_IMMUTABLE';
END
$$;

CREATE FUNCTION public.s13_event_tuple_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE expected_company UUID;
DECLARE expected_collaboration UUID;
BEGIN
  IF TG_TABLE_NAME = 'partner_collaboration_events' THEN
    SELECT c.company_id INTO expected_company
    FROM public.partner_collaborations c
    WHERE c.id = NEW.collaboration_id;
    IF expected_company IS NULL OR NEW.company_id IS DISTINCT FROM expected_company THEN
      RAISE EXCEPTION 'COLLABORATION_EVENT_TUPLE_FORBIDDEN';
    END IF;
  ELSE
    SELECT p.company_id, p.collaboration_id
      INTO expected_company, expected_collaboration
    FROM public.partner_collaboration_participations p
    WHERE p.id = NEW.participation_id;
    IF expected_company IS NULL
       OR NEW.company_id IS DISTINCT FROM expected_company
       OR NEW.collaboration_id IS DISTINCT FROM expected_collaboration THEN
      RAISE EXCEPTION 'PARTICIPATION_EVENT_TUPLE_FORBIDDEN';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER partner_collaboration_events_tuple_validate
BEFORE INSERT ON public.partner_collaboration_events
FOR EACH ROW EXECUTE FUNCTION public.s13_event_tuple_validate();
CREATE TRIGGER partner_collaboration_participation_events_tuple_validate
BEFORE INSERT ON public.partner_collaboration_participation_events
FOR EACH ROW EXECUTE FUNCTION public.s13_event_tuple_validate();

CREATE TRIGGER partner_collaboration_events_immutable
BEFORE UPDATE OR DELETE ON public.partner_collaboration_events
FOR EACH ROW EXECUTE FUNCTION public.s13_immutable_history();
CREATE TRIGGER partner_collaboration_participation_events_immutable
BEFORE UPDATE OR DELETE ON public.partner_collaboration_participation_events
FOR EACH ROW EXECUTE FUNCTION public.s13_immutable_history();

CREATE FUNCTION public.partner_collaboration_list()
RETURNS TABLE(id UUID, company_id UUID, workspace_id UUID, project_id UUID, state TEXT, version INTEGER, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE actor UUID;
DECLARE tenant UUID;
BEGIN
  tenant := public.s13_uuid_setting('app.tenant_id');
  actor := public.s13_require_context(tenant, 'partner.collaboration.read');
  RETURN QUERY SELECT c.id, c.company_id, c.workspace_id, c.project_id, c.state, c.version, c.created_at
    FROM public.partner_collaborations c WHERE c.company_id = tenant AND c.state = 'ACTIVE' ORDER BY c.created_at DESC, c.id DESC;
END
$$;

CREATE FUNCTION public.partner_collaboration_create(p_workspace_id UUID, p_project_id UUID, p_correlation_id UUID)
RETURNS TABLE(id UUID, company_id UUID, workspace_id UUID, project_id UUID, state TEXT, version INTEGER, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE actor UUID;
DECLARE tenant UUID;
DECLARE created public.partner_collaborations%ROWTYPE;
BEGIN
  tenant := public.s13_uuid_setting('app.tenant_id');
  actor := public.s13_require_context(tenant, 'partner.collaboration.create');
  INSERT INTO public.partner_collaborations(company_id, workspace_id, project_id, created_by)
  VALUES (tenant, p_workspace_id, p_project_id, actor) RETURNING * INTO created;
  INSERT INTO public.partner_collaboration_events(company_id, collaboration_id, event_type, actor_user_id, correlation_id)
  VALUES (tenant, created.id, 'CREATED', actor, p_correlation_id);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (actor, tenant, 'TENANT', 'partner_collaboration.created', 'PartnerCollaboration', created.id, '{}'::jsonb, p_correlation_id, 'PUR-19', 'ALLOWED');
  RETURN QUERY SELECT created.id, created.company_id, created.workspace_id, created.project_id, created.state, created.version, created.created_at;
END
$$;

CREATE FUNCTION public.partner_collaboration_read(p_id UUID)
RETURNS TABLE(id UUID, company_id UUID, workspace_id UUID, project_id UUID, state TEXT, version INTEGER, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE actor UUID;
DECLARE tenant UUID;
BEGIN
  tenant := public.s13_uuid_setting('app.tenant_id');
  actor := public.s13_require_context(tenant, 'partner.collaboration.read');
  IF NOT EXISTS (SELECT 1 FROM public.partner_collaborations c WHERE c.id = p_id AND c.company_id = tenant AND c.state = 'ACTIVE') THEN
    RAISE EXCEPTION 'COLLABORATION_FORBIDDEN';
  END IF;
  RETURN QUERY SELECT c.id, c.company_id, c.workspace_id, c.project_id, c.state, c.version, c.created_at
    FROM public.partner_collaborations c WHERE c.id = p_id AND c.company_id = tenant AND c.state = 'ACTIVE';
END
$$;

CREATE FUNCTION public.partner_collaboration_archive(p_id UUID, p_correlation_id UUID)
RETURNS TABLE(id UUID, state TEXT, version INTEGER, archived_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE actor UUID;
DECLARE tenant UUID;
DECLARE updated public.partner_collaborations%ROWTYPE;
BEGIN
  tenant := public.s13_uuid_setting('app.tenant_id');
  actor := public.s13_require_context(tenant, 'partner.collaboration.manage');
  SELECT * INTO updated FROM public.partner_collaborations c WHERE c.id = p_id AND c.company_id = tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLABORATION_FORBIDDEN'; END IF;
  IF updated.state = 'ARCHIVED' THEN RAISE EXCEPTION 'COLLABORATION_FORBIDDEN'; END IF;
  UPDATE public.partner_collaborations c SET state = 'ARCHIVED', archived_by = actor, archived_at = clock_timestamp(), version = c.version + 1
    WHERE c.id = p_id RETURNING c.* INTO updated;
  INSERT INTO public.partner_collaboration_events(company_id, collaboration_id, event_type, actor_user_id, correlation_id)
  VALUES (tenant, p_id, 'ARCHIVED', actor, p_correlation_id);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (actor, tenant, 'TENANT', 'partner_collaboration.archived', 'PartnerCollaboration', p_id, '{}'::jsonb, p_correlation_id, 'PUR-19', 'ALLOWED');
  RETURN QUERY SELECT updated.id, updated.state, updated.version, updated.archived_at;
END
$$;

CREATE FUNCTION public.partner_collaboration_participation_grant(p_collaboration_id UUID, p_membership_id UUID, p_idempotency_key TEXT, p_correlation_id UUID)
RETURNS TABLE(id UUID, collaboration_id UUID, membership_id UUID, state TEXT, version INTEGER, granted_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE actor UUID;
DECLARE tenant UUID;
DECLARE normalized_key TEXT;
DECLARE fingerprint TEXT;
DECLARE created public.partner_collaboration_participations%ROWTYPE;
DECLARE violated_constraint TEXT;
BEGIN
  tenant := public.s13_uuid_setting('app.tenant_id');
  actor := public.s13_require_context(tenant, 'partner.collaboration.participation.manage');
  normalized_key := btrim(COALESCE(p_idempotency_key, ''));
  IF normalized_key = '' THEN RAISE EXCEPTION 'PARTICIPATION_GRANT_IDEMPOTENCY_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partner_collaborations c WHERE c.id = p_collaboration_id AND c.company_id = tenant AND c.state = 'ACTIVE') THEN RAISE EXCEPTION 'COLLABORATION_FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."CompanyMembership" m JOIN public."User" u ON u.id = m."userId" WHERE m.id = p_membership_id AND m."companyId" = tenant AND m.status = 'ACTIVE' AND u.status = 'ACTIVE') THEN RAISE EXCEPTION 'PARTICIPATION_MEMBERSHIP_FORBIDDEN'; END IF;
  -- Lock order: Collaboration before Participation.
  PERFORM 1 FROM public.partner_collaborations c WHERE c.id = p_collaboration_id AND c.company_id = tenant FOR KEY SHARE;
  IF NOT EXISTS (SELECT 1 FROM public.partner_collaborations c WHERE c.id = p_collaboration_id AND c.company_id = tenant AND c.state = 'ACTIVE') THEN RAISE EXCEPTION 'COLLABORATION_FORBIDDEN'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(tenant::TEXT || ':' || actor::TEXT || ':partner_collaboration_participation_grant:' || normalized_key, 1313));
  fingerprint := encode(digest(tenant::TEXT || ':partner_collaboration_participation.grant:' || p_collaboration_id::TEXT || ':' || p_membership_id::TEXT || ':' || actor::TEXT, 'sha256'), 'hex');
  SELECT * INTO created
  FROM public.partner_collaboration_participations p
  WHERE p.company_id = tenant AND p.granted_by = actor AND p.idempotency_key = normalized_key
  FOR UPDATE;
  IF FOUND THEN
    IF created.request_fingerprint <> fingerprint THEN RAISE EXCEPTION 'PARTICIPATION_GRANT_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN QUERY SELECT created.id, created.collaboration_id, created.membership_id, created.state, created.version, created.granted_at;
    RETURN;
  END IF;
  BEGIN
    INSERT INTO public.partner_collaboration_participations(company_id, collaboration_id, membership_id, granted_by, idempotency_key, request_fingerprint)
    VALUES (tenant, p_collaboration_id, p_membership_id, actor, normalized_key, fingerprint) RETURNING * INTO created;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    IF violated_constraint = 'partner_collaboration_active_participation_unique' THEN
      RAISE EXCEPTION 'PARTICIPATION_ALREADY_ACTIVE';
    END IF;
    RAISE;
  END;
  INSERT INTO public.partner_collaboration_participation_events(company_id, participation_id, collaboration_id, event_type, actor_user_id, correlation_id)
  VALUES (tenant, created.id, created.collaboration_id, 'GRANTED', actor, p_correlation_id);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (actor, tenant, 'TENANT', 'partner_collaboration.participation_granted', 'PartnerCollaborationParticipation', created.id, '{}'::jsonb, p_correlation_id, 'PUR-19', 'ALLOWED');
  RETURN QUERY SELECT created.id, created.collaboration_id, created.membership_id, created.state, created.version, created.granted_at;
END
$$;

CREATE FUNCTION public.partner_collaboration_participation_revoke(p_id UUID, p_reason TEXT, p_correlation_id UUID)
RETURNS TABLE(id UUID, state TEXT, version INTEGER, revoked_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE actor UUID;
DECLARE tenant UUID;
DECLARE updated public.partner_collaboration_participations%ROWTYPE;
BEGIN
  tenant := public.s13_uuid_setting('app.tenant_id');
  actor := public.s13_require_context(tenant, 'partner.collaboration.participation.manage');
  -- Lock order: Collaboration before Participation (Binding follows in the invalidate trigger).
  PERFORM 1 FROM public.partner_collaborations c
   WHERE c.company_id = tenant
     AND c.id = (
       SELECT p0.collaboration_id
         FROM public.partner_collaboration_participations p0
        WHERE p0.id = p_id AND p0.company_id = tenant
     )
   FOR KEY SHARE;
  SELECT * INTO updated FROM public.partner_collaboration_participations p WHERE p.id = p_id AND p.company_id = tenant FOR UPDATE;
  IF NOT FOUND OR updated.state = 'REVOKED' THEN RAISE EXCEPTION 'PARTICIPATION_FORBIDDEN'; END IF;
  UPDATE public.partner_collaboration_participations
    SET state = 'REVOKED', revoked_by = actor, revoked_at = clock_timestamp(), revocation_reason = NULLIF(btrim(p_reason), ''), version = partner_collaboration_participations.version + 1
    WHERE partner_collaboration_participations.id = p_id RETURNING partner_collaboration_participations.* INTO updated;
  INSERT INTO public.partner_collaboration_participation_events(company_id, participation_id, collaboration_id, event_type, actor_user_id, correlation_id)
  VALUES (tenant, p_id, updated.collaboration_id, 'REVOKED', actor, p_correlation_id);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (actor, tenant, 'TENANT', 'partner_collaboration.participation_revoked', 'PartnerCollaborationParticipation', p_id, jsonb_build_object('reasonProvided', p_reason IS NOT NULL AND btrim(p_reason) <> ''), p_correlation_id, 'PUR-19', 'ALLOWED');
  RETURN QUERY SELECT updated.id, updated.state, updated.version, updated.revoked_at;
END
$$;

CREATE FUNCTION public.partner_collaboration_participation_join(p_id UUID)
RETURNS TABLE(id UUID, collaboration_id UUID, membership_id UUID, state TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE actor UUID;
DECLARE tenant UUID;
BEGIN
  tenant := public.s13_uuid_setting('app.tenant_id');
  actor := public.s13_require_context(tenant, 'partner.collaboration.participate');
  IF NOT EXISTS (
    SELECT 1
    FROM public.partner_collaboration_participations p
    JOIN public."CompanyMembership" m ON m.id = p.membership_id AND m."userId" = actor AND m.status = 'ACTIVE'
    JOIN public.partner_collaborations c ON c.id = p.collaboration_id AND c.state = 'ACTIVE'
    WHERE p.id = p_id AND p.company_id = tenant AND p.state = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'PARTICIPATION_FORBIDDEN'; END IF;
  RETURN QUERY SELECT p.id, p.collaboration_id, p.membership_id, p.state FROM public.partner_collaboration_participations p WHERE p.id = p_id;
END
$$;

-- OD-1 (Owner-approved for Stage013): leave is pinned as a documented NO-OP.
-- It delegates to join and performs no authority or state transition.
-- Do not invent revoke, session-exit, REMOVED, or durable-exit semantics here.
CREATE FUNCTION public.partner_collaboration_participation_leave(p_id UUID)
RETURNS TABLE(id UUID, collaboration_id UUID, membership_id UUID, state TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY SELECT * FROM public.partner_collaboration_participation_join(p_id);
END
$$;

DO $$
DECLARE function_name TEXT;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    's13_uuid_setting', 's13_require_context', 's13_collaboration_validate', 's13_participation_validate',
    's13_immutable_history', 's13_event_tuple_validate', 'partner_collaboration_list', 'partner_collaboration_create',
    'partner_collaboration_read', 'partner_collaboration_archive', 'partner_collaboration_participation_grant',
    'partner_collaboration_participation_revoke', 'partner_collaboration_participation_join',
    'partner_collaboration_participation_leave'
  ] LOOP
    EXECUTE format('ALTER FUNCTION public.%I OWNER TO sco_collaboration_gateway_owner', function_name);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.s13_uuid_setting(TEXT), public.s13_require_context(UUID, TEXT), public.s13_collaboration_validate(), public.s13_participation_validate(), public.s13_immutable_history(), public.s13_event_tuple_validate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_collaboration_list(), public.partner_collaboration_create(UUID, UUID, UUID), public.partner_collaboration_read(UUID), public.partner_collaboration_archive(UUID, UUID), public.partner_collaboration_participation_grant(UUID, UUID, TEXT, UUID), public.partner_collaboration_participation_revoke(UUID, TEXT, UUID), public.partner_collaboration_participation_join(UUID), public.partner_collaboration_participation_leave(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_collaboration_list(), public.partner_collaboration_create(UUID, UUID, UUID), public.partner_collaboration_read(UUID), public.partner_collaboration_archive(UUID, UUID), public.partner_collaboration_participation_grant(UUID, UUID, TEXT, UUID), public.partner_collaboration_participation_revoke(UUID, TEXT, UUID), public.partner_collaboration_participation_join(UUID), public.partner_collaboration_participation_leave(UUID) TO sco_runtime;
