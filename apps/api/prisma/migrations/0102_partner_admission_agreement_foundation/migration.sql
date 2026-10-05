DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_partner_admission_gateway_owner') THEN
    CREATE ROLE sco_partner_admission_gateway_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE sco_partner_admission_gateway_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE ALL ON SCHEMA public FROM sco_partner_admission_gateway_owner;
GRANT USAGE ON SCHEMA public TO sco_partner_admission_gateway_owner;

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'partner.admission.read', 'Read company-scoped admission and agreement requirements'),
  (gen_random_uuid(), 'partner.agreement.accept', 'Accept an agreement for the active company'),
  (gen_random_uuid(), 'agreement.policy.manage', 'Manage versioned agreement policy')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.qualification_applications
  ADD COLUMN company_id UUID REFERENCES public."Company"(id) ON DELETE RESTRICT;
CREATE INDEX qualification_applications_company_idx
  ON public.qualification_applications(company_id, created_at DESC);

ALTER TABLE public.company_partnerships
  DROP CONSTRAINT company_partnerships_company_id_type_key,
  ADD COLUMN qualification_application_id UUID REFERENCES public.qualification_applications(id) ON DELETE RESTRICT,
  ADD COLUMN decision_reason TEXT,
  ADD COLUMN suspended_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  ADD COLUMN revoked_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX company_partnerships_open_company_type_unique
  ON public.company_partnerships(company_id, type)
  WHERE status IN ('UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED');

CREATE TABLE public.qualification_application_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_application_id UUID NOT NULL REFERENCES public.qualification_applications(id) ON DELETE RESTRICT,
  company_id UUID REFERENCES public."Company"(id) ON DELETE RESTRICT,
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('APPLICATION', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')),
  to_status TEXT NOT NULL CHECK (to_status IN ('APPLICATION', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  reason TEXT,
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.company_partnership_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_id UUID NOT NULL REFERENCES public.company_partnerships(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED')),
  to_status TEXT NOT NULL CHECK (to_status IN ('UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED')),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  reason TEXT,
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.partner_agreement_policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_type TEXT NOT NULL CHECK (agreement_type ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  version_code TEXT NOT NULL CHECK (btrim(version_code) <> ''),
  content_text TEXT NOT NULL CHECK (btrim(content_text) <> '' AND octet_length(content_text) <= 262144),
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  required BOOLEAN NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  acceptance_permission_code TEXT NOT NULL REFERENCES public."Permission"(code) ON DELETE RESTRICT,
  reacceptance_required BOOLEAN NOT NULL,
  suspension_effect TEXT NOT NULL CHECK (suspension_effect IN ('NO_ACCESS_CHANGE', 'REQUIRE_REACCEPTANCE', 'BLOCK_OPERATIONAL_ACCESS')),
  termination_effect TEXT NOT NULL CHECK (termination_effect IN ('NO_ACCESS_CHANGE', 'REQUIRE_REACCEPTANCE', 'BLOCK_OPERATIONAL_ACCESS')),
  retention_classification TEXT NOT NULL CHECK (btrim(retention_classification) <> ''),
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'PUBLISHED', 'SUSPENDED', 'TERMINATED')),
  supersedes_policy_id UUID REFERENCES public.partner_agreement_policy_versions(id) ON DELETE RESTRICT,
  superseded_by_policy_id UUID REFERENCES public.partner_agreement_policy_versions(id) ON DELETE RESTRICT,
  superseded_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (agreement_type, version_code),
  UNIQUE (agreement_type, effective_at),
  CHECK (agreement_type <> 'BINDING_CONFIDENTIALITY' OR required)
);
CREATE INDEX partner_agreement_policy_current_idx
  ON public.partner_agreement_policy_versions(agreement_type, effective_at DESC)
  WHERE state IN ('PUBLISHED', 'SUSPENDED', 'TERMINATED');

CREATE TABLE public.partner_agreement_policy_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_version_id UUID NOT NULL REFERENCES public.partner_agreement_policy_versions(id) ON DELETE RESTRICT,
  agreement_type TEXT NOT NULL,
  version_code TEXT NOT NULL,
  from_state TEXT CHECK (from_state IS NULL OR from_state IN ('DRAFT', 'PUBLISHED', 'SUSPENDED', 'TERMINATED')),
  to_state TEXT NOT NULL CHECK (to_state IN ('DRAFT', 'PUBLISHED', 'SUSPENDED', 'TERMINATED')),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  reason TEXT,
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.partner_agreement_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  membership_id UUID NOT NULL REFERENCES public."CompanyMembership"(id) ON DELETE RESTRICT,
  policy_version_id UUID NOT NULL REFERENCES public.partner_agreement_policy_versions(id) ON DELETE RESTRICT,
  agreement_type TEXT NOT NULL,
  version_code TEXT NOT NULL,
  accepted_content_sha256 TEXT NOT NULL CHECK (accepted_content_sha256 ~ '^[0-9a-f]{64}$'),
  authority_permission_code TEXT NOT NULL REFERENCES public."Permission"(code) ON DELETE RESTRICT,
  authority_basis JSONB NOT NULL CHECK (jsonb_typeof(authority_basis) = 'object'),
  purpose_code TEXT NOT NULL CHECK (purpose_code = 'PUR-02'),
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  correlation_id UUID NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (company_id, actor_user_id, idempotency_key)
);
CREATE INDEX partner_agreement_acceptances_company_type_idx
  ON public.partner_agreement_acceptances(company_id, agreement_type, accepted_at DESC);

CREATE TABLE public.partner_agreement_acceptance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acceptance_id UUID NOT NULL REFERENCES public.partner_agreement_acceptances(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('ACCEPTED', 'SUPERSEDED', 'SUSPENDED', 'TERMINATED', 'HISTORICALLY_RETAINED')),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  reason TEXT,
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX partner_agreement_acceptance_events_latest_idx
  ON public.partner_agreement_acceptance_events(acceptance_id, created_at DESC);

GRANT SELECT ON public."Company", public."User", public."CompanyMembership", public."Role", public."MembershipRole",
  public."RolePermission", public."Permission", public.qualification_applications,
  public.company_partnerships, public.projects, public.product_identities,
  public.partner_agreement_policy_versions, public.partner_agreement_acceptances,
  public.partner_agreement_acceptance_events, public.procurement_needs TO sco_partner_admission_gateway_owner;
GRANT INSERT, UPDATE ON public.qualification_applications, public.company_partnerships TO sco_partner_admission_gateway_owner;
GRANT INSERT ON public.qualification_application_events, public.company_partnership_events,
  public.partner_agreement_policy_versions, public.partner_agreement_policy_events,
  public.partner_agreement_acceptances, public.partner_agreement_acceptance_events,
  public.procurement_needs, public.audit_logs TO sco_partner_admission_gateway_owner;
GRANT UPDATE ON public.partner_agreement_policy_versions TO sco_partner_admission_gateway_owner;
GRANT INSERT ON public.qualification_application_events, public.company_partnership_events TO sco_internal_gateway_owner;
GRANT EXECUTE ON FUNCTION public.internal_has_capability(UUID, TEXT) TO sco_partner_admission_gateway_owner;

CREATE POLICY admission_gateway_company_read ON public."Company"
  FOR SELECT TO sco_partner_admission_gateway_owner USING (true);
CREATE POLICY admission_gateway_user_read ON public."User"
  FOR SELECT TO sco_partner_admission_gateway_owner USING (true);
CREATE POLICY admission_gateway_membership_read ON public."CompanyMembership"
  FOR SELECT TO sco_partner_admission_gateway_owner USING (true);
CREATE POLICY admission_gateway_role_read ON public."Role"
  FOR SELECT TO sco_partner_admission_gateway_owner USING (true);
CREATE POLICY admission_gateway_membership_role_read ON public."MembershipRole"
  FOR SELECT TO sco_partner_admission_gateway_owner USING (true);
CREATE POLICY admission_gateway_role_permission_read ON public."RolePermission"
  FOR SELECT TO sco_partner_admission_gateway_owner USING (true);
CREATE POLICY admission_gateway_permission_read ON public."Permission"
  FOR SELECT TO sco_partner_admission_gateway_owner USING (true);
CREATE POLICY admission_gateway_projects_read ON public.projects
  FOR SELECT TO sco_partner_admission_gateway_owner USING (true);
CREATE POLICY admission_gateway_product_identities_read ON public.product_identities
  FOR SELECT TO sco_partner_admission_gateway_owner USING (true);
CREATE POLICY admission_gateway_qualification ON public.qualification_applications
  FOR ALL TO sco_partner_admission_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY admission_gateway_partnership ON public.company_partnerships
  FOR ALL TO sco_partner_admission_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY admission_internal_qualification_events ON public.qualification_application_events
  FOR INSERT TO sco_internal_gateway_owner WITH CHECK (true);
CREATE POLICY admission_internal_partnership_events ON public.company_partnership_events
  FOR INSERT TO sco_internal_gateway_owner WITH CHECK (true);
CREATE POLICY admission_gateway_procurement_needs_insert ON public.procurement_needs
  FOR ALL TO sco_partner_admission_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY admission_gateway_audit_insert ON public.audit_logs
  FOR INSERT TO sco_partner_admission_gateway_owner WITH CHECK (true);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'qualification_application_events', 'company_partnership_events',
    'partner_agreement_policy_versions', 'partner_agreement_policy_events',
    'partner_agreement_acceptances', 'partner_agreement_acceptance_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I OWNER TO sco_partner_admission_gateway_owner', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO sco_partner_admission_gateway_owner USING (true) WITH CHECK (true)', table_name || '_gateway_owner', table_name);
  END LOOP;
END $$;

REVOKE INSERT, UPDATE, DELETE ON public.company_partnerships FROM sco_runtime;
REVOKE ALL ON public.qualification_application_events, public.company_partnership_events,
  public.partner_agreement_policy_versions, public.partner_agreement_policy_events,
  public.partner_agreement_acceptances, public.partner_agreement_acceptance_events
  FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;
GRANT SELECT ON public.company_partnerships TO sco_runtime;

CREATE FUNCTION public.admission_prevent_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  caller_is_superuser BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT role.rolsuper INTO caller_is_superuser
      FROM pg_catalog.pg_roles role WHERE role.rolname = current_user;
    IF caller_is_superuser THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'ADMISSION_HISTORY_IMMUTABLE';
END
$$;
ALTER FUNCTION public.admission_prevent_history_mutation() OWNER TO sco_partner_admission_gateway_owner;
REVOKE ALL ON FUNCTION public.admission_prevent_history_mutation() FROM PUBLIC;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'qualification_application_events', 'company_partnership_events',
    'partner_agreement_policy_events', 'partner_agreement_acceptances',
    'partner_agreement_acceptance_events'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.admission_prevent_history_mutation()', table_name || '_immutable', table_name);
  END LOOP;
END $$;

CREATE FUNCTION public.admission_qualification_company_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'QUALIFICATION_COMPANY_BINDING_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION public.admission_qualification_company_immutable() OWNER TO sco_partner_admission_gateway_owner;
REVOKE ALL ON FUNCTION public.admission_qualification_company_immutable() FROM PUBLIC;
CREATE TRIGGER qualification_company_binding_immutable
  BEFORE UPDATE OF company_id ON public.qualification_applications
  FOR EACH ROW EXECUTE FUNCTION public.admission_qualification_company_immutable();

CREATE FUNCTION public.admission_policy_content_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.agreement_type IS DISTINCT FROM OLD.agreement_type
     OR NEW.version_code IS DISTINCT FROM OLD.version_code
     OR NEW.content_text IS DISTINCT FROM OLD.content_text
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.required IS DISTINCT FROM OLD.required
     OR NEW.effective_at IS DISTINCT FROM OLD.effective_at
     OR NEW.acceptance_permission_code IS DISTINCT FROM OLD.acceptance_permission_code
     OR NEW.reacceptance_required IS DISTINCT FROM OLD.reacceptance_required
     OR NEW.suspension_effect IS DISTINCT FROM OLD.suspension_effect
     OR NEW.termination_effect IS DISTINCT FROM OLD.termination_effect
     OR NEW.retention_classification IS DISTINCT FROM OLD.retention_classification
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'AGREEMENT_POLICY_VERSION_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION public.admission_policy_content_immutable() OWNER TO sco_partner_admission_gateway_owner;
REVOKE ALL ON FUNCTION public.admission_policy_content_immutable() FROM PUBLIC;
CREATE TRIGGER partner_agreement_policy_content_immutable
  BEFORE UPDATE ON public.partner_agreement_policy_versions
  FOR EACH ROW EXECUTE FUNCTION public.admission_policy_content_immutable();

CREATE FUNCTION public.admission_actor_has_permission(p_actor UUID, p_company UUID, p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."CompanyMembership" membership
    JOIN public."MembershipRole" membership_role
      ON membership_role.membership_id = membership.id
     AND membership_role.company_id = p_company
    JOIN public."RolePermission" role_permission
      ON role_permission.role_id = membership_role.role_id
     AND role_permission.company_id = p_company
    JOIN public."Permission" permission ON permission.id = role_permission.permission_id
    JOIN public."User" actor ON actor.id = membership."userId"
    JOIN public."Company" company ON company.id = membership."companyId"
    WHERE membership."userId" = p_actor
      AND membership."companyId" = p_company
      AND membership.status = 'ACTIVE'
      AND actor.status = 'ACTIVE'
      AND company.status = 'ACTIVE'
      AND company.type = 'PARTNER'
      AND permission.code = p_permission
  )
$$;
ALTER FUNCTION public.admission_actor_has_permission(UUID, UUID, TEXT) OWNER TO sco_partner_admission_gateway_owner;
REVOKE ALL ON FUNCTION public.admission_actor_has_permission(UUID, UUID, TEXT) FROM PUBLIC;

CREATE FUNCTION public.partner_company_has_portal_member(p_company UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."CompanyMembership" membership
    JOIN public."MembershipRole" membership_role
      ON membership_role.membership_id = membership.id
     AND membership_role.company_id = p_company
    JOIN public."RolePermission" role_permission
      ON role_permission.role_id = membership_role.role_id
     AND role_permission.company_id = p_company
    JOIN public."Permission" permission
      ON permission.id = role_permission.permission_id
     AND permission.code = 'partner.portal.read'
    JOIN public."User" actor ON actor.id = membership."userId"
    JOIN public."Company" company ON company.id = membership."companyId"
    WHERE membership."companyId" = p_company
      AND membership.status = 'ACTIVE'
      AND actor.status = 'ACTIVE'
      AND company.status = 'ACTIVE'
      AND company.type = 'PARTNER'
  )
$$;
ALTER FUNCTION public.partner_company_has_portal_member(UUID) OWNER TO sco_partner_admission_gateway_owner;
REVOKE ALL ON FUNCTION public.partner_company_has_portal_member(UUID) FROM PUBLIC;

CREATE FUNCTION public.partner_required_agreements_satisfied(p_company UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_policy RECORD;
  valid_acceptance BOOLEAN;
  found_binding_confidentiality BOOLEAN := false;
BEGIN
  FOR current_policy IN
    SELECT DISTINCT ON (policy.agreement_type)
      policy.id, policy.agreement_type, policy.required, policy.reacceptance_required,
      policy.suspension_effect, policy.termination_effect, policy.state, policy.version_code
    FROM public.partner_agreement_policy_versions policy
    WHERE policy.effective_at <= clock_timestamp()
      AND (policy.superseded_at IS NULL OR policy.superseded_at > clock_timestamp())
      AND policy.state IN ('PUBLISHED', 'SUSPENDED', 'TERMINATED')
    ORDER BY policy.agreement_type, policy.effective_at DESC
  LOOP
    IF current_policy.agreement_type = 'BINDING_CONFIDENTIALITY' AND current_policy.required THEN
      found_binding_confidentiality := true;
    END IF;
    IF NOT current_policy.required THEN
      CONTINUE;
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM public.partner_agreement_acceptances acceptance
      JOIN LATERAL (
        SELECT event.status
        FROM public.partner_agreement_acceptance_events event
        WHERE event.acceptance_id = acceptance.id
        ORDER BY event.created_at DESC, event.id DESC
        LIMIT 1
      ) current_event ON true
      WHERE acceptance.company_id = p_company
        AND acceptance.agreement_type = current_policy.agreement_type
        AND current_event.status IN ('ACCEPTED', 'SUPERSEDED', 'HISTORICALLY_RETAINED')
        AND (
          acceptance.policy_version_id = current_policy.id
          OR (NOT current_policy.reacceptance_required AND current_event.status IN ('ACCEPTED', 'SUPERSEDED', 'HISTORICALLY_RETAINED'))
        )
    ) INTO valid_acceptance;

    IF current_policy.state = 'SUSPENDED' THEN
      IF current_policy.suspension_effect <> 'NO_ACCESS_CHANGE' OR NOT valid_acceptance THEN
        RETURN false;
      END IF;
    ELSIF current_policy.state = 'TERMINATED' THEN
      IF current_policy.termination_effect <> 'NO_ACCESS_CHANGE' OR NOT valid_acceptance THEN
        RETURN false;
      END IF;
    ELSIF NOT valid_acceptance THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN found_binding_confidentiality;
END
$$;
ALTER FUNCTION public.partner_required_agreements_satisfied(UUID) OWNER TO sco_partner_admission_gateway_owner;
REVOKE ALL ON FUNCTION public.partner_required_agreements_satisfied(UUID) FROM PUBLIC;

CREATE FUNCTION public.internal_partner_agreement_policy_create(
  p_actor UUID,
  p_agreement_type TEXT,
  p_version_code TEXT,
  p_content_text TEXT,
  p_effective_at TIMESTAMPTZ,
  p_acceptance_permission_code TEXT,
  p_reacceptance_required BOOLEAN,
  p_suspension_effect TEXT,
  p_termination_effect TEXT,
  p_retention_classification TEXT,
  p_required BOOLEAN,
  p_correlation_id UUID
)
RETURNS TABLE(id UUID, agreement_type TEXT, version_code TEXT, content_sha256 TEXT, state TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  policy_id UUID;
  policy_hash TEXT;
  correlation UUID := COALESCE(p_correlation_id, gen_random_uuid());
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'agreement.policy.manage') THEN
    RAISE EXCEPTION 'AGREEMENT_POLICY_MANAGE_FORBIDDEN';
  END IF;
  IF p_agreement_type IS NULL OR p_agreement_type !~ '^[A-Z][A-Z0-9_]{2,63}$'
     OR btrim(COALESCE(p_version_code, '')) = ''
     OR btrim(COALESCE(p_content_text, '')) = ''
     OR octet_length(p_content_text) > 262144
     OR p_effective_at IS NULL
     OR btrim(COALESCE(p_acceptance_permission_code, '')) = ''
     OR btrim(COALESCE(p_retention_classification, '')) = ''
     OR (p_agreement_type = 'BINDING_CONFIDENTIALITY' AND NOT p_required) THEN
    RAISE EXCEPTION 'AGREEMENT_POLICY_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."Permission" permission WHERE permission.code = p_acceptance_permission_code) THEN
    RAISE EXCEPTION 'AGREEMENT_ACCEPTANCE_PERMISSION_UNKNOWN';
  END IF;
  policy_hash := encode(digest(convert_to(p_content_text, 'UTF8'), 'sha256'), 'hex');
  INSERT INTO public.partner_agreement_policy_versions (
    agreement_type, version_code, content_text, content_sha256, required, effective_at,
    acceptance_permission_code, reacceptance_required, suspension_effect, termination_effect,
    retention_classification, created_by
  ) VALUES (
    p_agreement_type, p_version_code, p_content_text, policy_hash, p_required, p_effective_at,
    p_acceptance_permission_code, p_reacceptance_required, p_suspension_effect, p_termination_effect,
    p_retention_classification, p_actor
  ) RETURNING partner_agreement_policy_versions.id INTO policy_id;
  INSERT INTO public.partner_agreement_policy_events (
    policy_version_id, agreement_type, version_code, to_state, actor_user_id, correlation_id
  ) VALUES (policy_id, p_agreement_type, p_version_code, 'DRAFT', p_actor, correlation);
  INSERT INTO public.audit_logs (
    actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
  ) VALUES (
    p_actor, 'SCO_INTERNAL', 'agreement.policy.created', 'PartnerAgreementPolicyVersion', policy_id,
    jsonb_build_object('agreementType', p_agreement_type, 'versionCode', p_version_code, 'contentSha256', policy_hash),
    correlation, 'PUR-02', 'ALLOWED'
  );
  RETURN QUERY SELECT policy.id, policy.agreement_type, policy.version_code, policy.content_sha256, policy.state
    FROM public.partner_agreement_policy_versions policy WHERE policy.id = policy_id;
END
$$;

CREATE FUNCTION public.internal_partner_agreement_policy_publish(p_actor UUID, p_policy_id UUID, p_correlation_id UUID)
RETURNS TABLE(id UUID, agreement_type TEXT, version_code TEXT, state TEXT, effective_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  policy public.partner_agreement_policy_versions%ROWTYPE;
  previous public.partner_agreement_policy_versions%ROWTYPE;
  correlation UUID := COALESCE(p_correlation_id, gen_random_uuid());
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'agreement.policy.manage') THEN
    RAISE EXCEPTION 'AGREEMENT_POLICY_MANAGE_FORBIDDEN';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('partner_agreement_policy', 1202));
  SELECT * INTO policy FROM public.partner_agreement_policy_versions policy_row WHERE policy_row.id = p_policy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGREEMENT_POLICY_NOT_FOUND'; END IF;
  IF policy.state = 'PUBLISHED' THEN
    RETURN QUERY SELECT policy.id, policy.agreement_type, policy.version_code, policy.state, policy.effective_at;
    RETURN;
  END IF;
  IF policy.state <> 'DRAFT' THEN RAISE EXCEPTION 'AGREEMENT_POLICY_STATE_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(policy.agreement_type, 1202));
  SELECT * INTO previous
    FROM public.partner_agreement_policy_versions existing
   WHERE existing.agreement_type = policy.agreement_type
     AND existing.state IN ('PUBLISHED', 'SUSPENDED', 'TERMINATED')
     AND existing.effective_at < policy.effective_at
     AND (existing.superseded_at IS NULL OR existing.superseded_at > policy.effective_at)
   ORDER BY existing.effective_at DESC
   LIMIT 1
   FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.partner_agreement_policy_versions existing
     WHERE existing.agreement_type = policy.agreement_type
       AND existing.state = 'PUBLISHED'
       AND existing.effective_at > policy.effective_at
       AND (existing.superseded_at IS NULL OR existing.superseded_at > policy.effective_at)
  ) THEN
    RAISE EXCEPTION 'AGREEMENT_POLICY_EFFECTIVE_DATE_CONFLICT';
  END IF;
  IF FOUND THEN
    UPDATE public.partner_agreement_policy_versions AS target
       SET superseded_at = policy.effective_at, superseded_by_policy_id = policy.id
     WHERE target.id = previous.id;
    UPDATE public.partner_agreement_policy_versions AS target
       SET supersedes_policy_id = previous.id
     WHERE target.id = policy.id;
  END IF;
  UPDATE public.partner_agreement_policy_versions AS target
     SET state = 'PUBLISHED'
   WHERE target.id = policy.id;
  INSERT INTO public.partner_agreement_policy_events (
    policy_version_id, agreement_type, version_code, from_state, to_state, actor_user_id, reason, correlation_id
  ) VALUES (policy.id, policy.agreement_type, policy.version_code, 'DRAFT', 'PUBLISHED', p_actor, 'POLICY_PUBLISHED', correlation);
  INSERT INTO public.audit_logs (
    actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
  ) VALUES (
    p_actor, 'SCO_INTERNAL', 'agreement.policy.published', 'PartnerAgreementPolicyVersion', policy.id,
    jsonb_build_object('agreementType', policy.agreement_type, 'versionCode', policy.version_code),
    correlation, 'PUR-02', 'ALLOWED'
  );
  RETURN QUERY SELECT updated.id, updated.agreement_type, updated.version_code, updated.state, updated.effective_at
    FROM public.partner_agreement_policy_versions updated WHERE updated.id = policy.id;
END
$$;

CREATE FUNCTION public.internal_partner_agreement_policy_transition(
  p_actor UUID, p_policy_id UUID, p_to_state TEXT, p_reason TEXT, p_correlation_id UUID
)
RETURNS TABLE(id UUID, agreement_type TEXT, version_code TEXT, state TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  policy public.partner_agreement_policy_versions%ROWTYPE;
  correlation UUID := COALESCE(p_correlation_id, gen_random_uuid());
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'agreement.policy.manage') THEN
    RAISE EXCEPTION 'AGREEMENT_POLICY_MANAGE_FORBIDDEN';
  END IF;
  IF p_to_state NOT IN ('SUSPENDED', 'TERMINATED') OR btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'AGREEMENT_POLICY_TRANSITION_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('partner_agreement_policy', 1202));
  SELECT * INTO policy FROM public.partner_agreement_policy_versions policy_row WHERE policy_row.id = p_policy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGREEMENT_POLICY_NOT_FOUND'; END IF;
  IF policy.state = p_to_state THEN
    RETURN QUERY SELECT policy.id, policy.agreement_type, policy.version_code, policy.state;
    RETURN;
  END IF;
  IF policy.state <> 'PUBLISHED' THEN RAISE EXCEPTION 'AGREEMENT_POLICY_STATE_INVALID'; END IF;
  IF policy.effective_at > clock_timestamp()
     OR (policy.superseded_at IS NOT NULL AND policy.superseded_at <= clock_timestamp()) THEN
    RAISE EXCEPTION 'AGREEMENT_POLICY_NOT_CURRENT';
  END IF;
  UPDATE public.partner_agreement_policy_versions AS target
     SET state = p_to_state
   WHERE target.id = policy.id;
  INSERT INTO public.partner_agreement_policy_events (
    policy_version_id, agreement_type, version_code, from_state, to_state, actor_user_id, reason, correlation_id
  ) VALUES (policy.id, policy.agreement_type, policy.version_code, policy.state, p_to_state, p_actor, p_reason, correlation);
  IF (p_to_state = 'SUSPENDED' AND policy.suspension_effect <> 'NO_ACCESS_CHANGE')
     OR (p_to_state = 'TERMINATED' AND policy.termination_effect <> 'NO_ACCESS_CHANGE') THEN
    INSERT INTO public.partner_agreement_acceptance_events (
      acceptance_id, company_id, status, actor_user_id, reason, correlation_id
    )
    SELECT acceptance.id, acceptance.company_id, p_to_state, p_actor, p_reason, correlation
      FROM public.partner_agreement_acceptances acceptance
     WHERE acceptance.policy_version_id = policy.id;
  END IF;
  INSERT INTO public.audit_logs (
    actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
  ) VALUES (
    p_actor, 'SCO_INTERNAL', 'agreement.policy.' || lower(p_to_state), 'PartnerAgreementPolicyVersion', policy.id,
    jsonb_build_object('agreementType', policy.agreement_type, 'versionCode', policy.version_code, 'reason', p_reason),
    correlation, 'PUR-02', 'ALLOWED'
  );
  RETURN QUERY SELECT updated.id, updated.agreement_type, updated.version_code, updated.state
    FROM public.partner_agreement_policy_versions updated WHERE updated.id = policy.id;
END
$$;

CREATE OR REPLACE FUNCTION public.internal_qualification_create(p_actor UUID, p_legal_name TEXT, p_contact_email TEXT)
RETURNS TABLE(id UUID, "legalName" TEXT, "contactEmail" TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE application_id UUID; correlation UUID := gen_random_uuid();
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'qualification.manage') THEN RAISE EXCEPTION 'QUALIFICATION_MANAGE_FORBIDDEN'; END IF;
  INSERT INTO public.qualification_applications (legal_name, contact_email, submitted_by)
    VALUES (p_legal_name, p_contact_email, p_actor)
    RETURNING qualification_applications.id INTO application_id;
  INSERT INTO public.qualification_application_events (qualification_application_id, to_status, actor_user_id, correlation_id)
    VALUES (application_id, 'APPLICATION', p_actor, correlation);
  INSERT INTO public.audit_logs (
    actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
  ) VALUES (
    p_actor, 'SCO_INTERNAL', 'qualification.created', 'QualificationApplication', application_id,
    '{}', correlation, 'PUR-03', 'ALLOWED'
  );
  RETURN QUERY SELECT application.id, application.legal_name, application.contact_email, application.status::TEXT
    FROM public.qualification_applications application WHERE application.id = application_id;
END $$;

CREATE FUNCTION public.internal_qualification_create_for_company(
  p_actor UUID, p_company_id UUID, p_legal_name TEXT, p_contact_email TEXT
)
RETURNS TABLE(id UUID, "companyId" UUID, "legalName" TEXT, "contactEmail" TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE application_id UUID; correlation UUID := gen_random_uuid();
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'qualification.manage') THEN RAISE EXCEPTION 'QUALIFICATION_MANAGE_FORBIDDEN'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."Company" company
    WHERE company.id = p_company_id AND company.type = 'PARTNER' AND company.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'QUALIFICATION_PARTNER_COMPANY_REQUIRED';
  END IF;
  INSERT INTO public.qualification_applications (company_id, legal_name, contact_email, submitted_by)
    VALUES (p_company_id, p_legal_name, p_contact_email, p_actor)
    RETURNING qualification_applications.id INTO application_id;
  INSERT INTO public.qualification_application_events (qualification_application_id, company_id, to_status, actor_user_id, correlation_id)
    VALUES (application_id, p_company_id, 'APPLICATION', p_actor, correlation);
  INSERT INTO public.audit_logs (
    actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
  ) VALUES (
    p_actor, p_company_id, 'SCO_INTERNAL', 'qualification.created', 'QualificationApplication', application_id,
    '{}', correlation, 'PUR-03', 'ALLOWED'
  );
  RETURN QUERY SELECT application.id, application.company_id, application.legal_name, application.contact_email, application.status::TEXT
    FROM public.qualification_applications application WHERE application.id = application_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_qualification_decide(p_actor UUID, p_id UUID, p_status TEXT, p_reason TEXT)
RETURNS TABLE(id UUID, status TEXT, "decisionReason" TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE application public.qualification_applications%ROWTYPE; correlation UUID := gen_random_uuid();
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'qualification.manage') THEN RAISE EXCEPTION 'QUALIFICATION_MANAGE_FORBIDDEN'; END IF;
  IF p_status NOT IN ('APPROVED','REJECTED') OR btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_QUALIFICATION_DECISION';
  END IF;
  SELECT * INTO application FROM public.qualification_applications WHERE qualification_applications.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUALIFICATION_NOT_FOUND'; END IF;
  IF application.status::TEXT = p_status THEN
    RETURN QUERY SELECT application.id, application.status::TEXT, application.decision_reason;
    RETURN;
  END IF;
  IF application.status NOT IN ('APPLICATION','UNDER_REVIEW') THEN RAISE EXCEPTION 'QUALIFICATION_STATE_INVALID'; END IF;
  UPDATE public.qualification_applications
     SET status = p_status::"QualificationStatus", reviewed_by = p_actor, reviewed_at = clock_timestamp(),
         decision_reason = p_reason, updated_at = clock_timestamp()
   WHERE qualification_applications.id = p_id;
  INSERT INTO public.qualification_application_events (
    qualification_application_id, company_id, from_status, to_status, actor_user_id, reason, correlation_id
  ) VALUES (application.id, application.company_id, application.status::TEXT, p_status, p_actor, p_reason, correlation);
  INSERT INTO public.audit_logs (
    actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
  ) VALUES (
    p_actor, application.company_id, 'SCO_INTERNAL', 'qualification.' || lower(p_status),
    'QualificationApplication', p_id, jsonb_build_object('reason', p_reason), correlation, 'PUR-03', 'ALLOWED'
  );
  RETURN QUERY SELECT updated.id, updated.status::TEXT, updated.decision_reason
    FROM public.qualification_applications updated WHERE updated.id = p_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_qualification_list(p_actor UUID)
RETURNS TABLE(id UUID, "legalName" TEXT, "contactEmail" TEXT, status TEXT, "createdAt" TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'qualification.manage') THEN RAISE EXCEPTION 'QUALIFICATION_MANAGE_FORBIDDEN'; END IF;
  RETURN QUERY SELECT application.id, application.legal_name, application.contact_email, application.status::TEXT, application.created_at
    FROM public.qualification_applications application ORDER BY application.created_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.internal_partnership_create(p_actor UUID, p_company_id UUID, p_type TEXT)
RETURNS TABLE(id UUID, "companyId" UUID, type TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE partnership_id UUID; qualification_id UUID; company_kind TEXT;
        correlation UUID := gen_random_uuid();
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'partnership.manage') THEN RAISE EXCEPTION 'PARTNERSHIP_MANAGE_FORBIDDEN'; END IF;
  IF p_type NOT IN ('BUYER_PARTNERSHIP', 'SUPPLIER_PARTNERSHIP') THEN RAISE EXCEPTION 'PARTNERSHIP_TYPE_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT || ':' || p_type, 1202));
  SELECT company.type::TEXT INTO company_kind FROM public."Company" company
   WHERE company.id = p_company_id AND company.status = 'ACTIVE';
  IF NOT FOUND OR (p_type = 'BUYER_PARTNERSHIP' AND company_kind <> 'PARTNER') THEN
    RAISE EXCEPTION 'PARTNERSHIP_COMPANY_TYPE_INVALID';
  END IF;
  IF p_type = 'BUYER_PARTNERSHIP' THEN
    SELECT application.id INTO qualification_id
      FROM public.qualification_applications application
     WHERE application.company_id = p_company_id AND application.status = 'APPROVED'
     ORDER BY application.reviewed_at DESC NULLS LAST, application.created_at DESC
     LIMIT 1;
    IF qualification_id IS NULL THEN RAISE EXCEPTION 'PARTNERSHIP_QUALIFICATION_REQUIRED'; END IF;
  END IF;
  SELECT partnership.id INTO partnership_id
    FROM public.company_partnerships partnership
   WHERE partnership.company_id = p_company_id
     AND partnership.type = p_type::"PartnershipType"
     AND partnership.status IN ('UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED')
   ORDER BY partnership.created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF partnership_id IS NULL THEN
    INSERT INTO public.company_partnerships (company_id, type, qualification_application_id)
      VALUES (p_company_id, p_type::"PartnershipType", qualification_id)
      RETURNING company_partnerships.id INTO partnership_id;
    INSERT INTO public.company_partnership_events (
      partnership_id, company_id, to_status, actor_user_id, reason, correlation_id
    ) VALUES (partnership_id, p_company_id, 'UNDER_REVIEW', p_actor, 'PARTNERSHIP_CREATED', correlation);
    INSERT INTO public.audit_logs (
      actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
    ) VALUES (
      p_actor, p_company_id, 'SCO_INTERNAL', 'partnership.created', 'CompanyPartnership', partnership_id,
      jsonb_build_object('type', p_type), correlation, 'PUR-03', 'ALLOWED'
    );
  END IF;
  RETURN QUERY SELECT partnership.id, partnership.company_id, partnership.type::TEXT, partnership.status::TEXT
    FROM public.company_partnerships partnership WHERE partnership.id = partnership_id;
END $$;

CREATE FUNCTION public.internal_partnership_approve(p_actor UUID, p_id UUID, p_reason TEXT, p_correlation_id UUID)
RETURNS TABLE(id UUID, "companyId" UUID, type TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE partnership public.company_partnerships%ROWTYPE; correlation UUID := COALESCE(p_correlation_id, gen_random_uuid());
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'partnership.manage') THEN RAISE EXCEPTION 'PARTNERSHIP_MANAGE_FORBIDDEN'; END IF;
  SELECT * INTO partnership FROM public.company_partnerships WHERE company_partnerships.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PARTNERSHIP_NOT_FOUND'; END IF;
  IF partnership.type <> 'BUYER_PARTNERSHIP' THEN RAISE EXCEPTION 'PARTNERSHIP_APPROVAL_TYPE_INVALID'; END IF;
  IF partnership.status = 'APPROVED' THEN
    IF NOT public.partner_required_agreements_satisfied(partnership.company_id) THEN RAISE EXCEPTION 'PARTNERSHIP_AGREEMENT_REQUIRED'; END IF;
    RETURN QUERY SELECT partnership.id, partnership.company_id, partnership.type::TEXT, partnership.status::TEXT;
    RETURN;
  END IF;
  IF partnership.status <> 'UNDER_REVIEW' THEN RAISE EXCEPTION 'PARTNERSHIP_STATE_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('partner_agreement_policy', 1202));
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'PARTNERSHIP_DECISION_REASON_REQUIRED'; END IF;
  IF partnership.qualification_application_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.qualification_applications application
     WHERE application.id = partnership.qualification_application_id
       AND application.company_id = partnership.company_id
       AND application.status = 'APPROVED'
  ) THEN RAISE EXCEPTION 'PARTNERSHIP_QUALIFICATION_REQUIRED'; END IF;
  IF NOT public.partner_required_agreements_satisfied(partnership.company_id) THEN
    RAISE EXCEPTION 'PARTNERSHIP_AGREEMENT_REQUIRED';
  END IF;
  UPDATE public.company_partnerships
     SET status = 'APPROVED', approved_by = p_actor, approved_at = clock_timestamp(),
         decision_reason = p_reason, updated_at = clock_timestamp()
   WHERE company_partnerships.id = p_id;
  INSERT INTO public.company_partnership_events (
    partnership_id, company_id, from_status, to_status, actor_user_id, reason, correlation_id
  ) VALUES (p_id, partnership.company_id, 'UNDER_REVIEW', 'APPROVED', p_actor, p_reason, correlation);
  INSERT INTO public.audit_logs (
    actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
  ) VALUES (
    p_actor, partnership.company_id, 'SCO_INTERNAL', 'partnership.approved', 'CompanyPartnership', p_id,
    jsonb_build_object('type', partnership.type::TEXT), correlation, 'PUR-03', 'ALLOWED'
  );
  RETURN QUERY SELECT updated.id, updated.company_id, updated.type::TEXT, updated.status::TEXT
    FROM public.company_partnerships updated WHERE updated.id = p_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_partnership_activate(p_actor UUID, p_id UUID)
RETURNS TABLE(id UUID, "companyId" UUID, type TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE partnership public.company_partnerships%ROWTYPE; correlation UUID := gen_random_uuid();
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'partnership.manage') THEN RAISE EXCEPTION 'PARTNERSHIP_MANAGE_FORBIDDEN'; END IF;
  SELECT * INTO partnership FROM public.company_partnerships WHERE company_partnerships.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PARTNERSHIP_NOT_FOUND'; END IF;
  IF partnership.type = 'BUYER_PARTNERSHIP' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('partner_agreement_policy', 1202));
    IF partnership.status NOT IN ('APPROVED', 'ACTIVE', 'SUSPENDED') THEN RAISE EXCEPTION 'PARTNERSHIP_APPROVAL_REQUIRED'; END IF;
    IF partnership.qualification_application_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.qualification_applications application
       WHERE application.id = partnership.qualification_application_id
         AND application.company_id = partnership.company_id
         AND application.status = 'APPROVED'
    ) THEN RAISE EXCEPTION 'PARTNERSHIP_QUALIFICATION_REQUIRED'; END IF;
    IF NOT public.partner_required_agreements_satisfied(partnership.company_id) THEN RAISE EXCEPTION 'PARTNERSHIP_AGREEMENT_REQUIRED'; END IF;
    IF NOT public.partner_company_has_portal_member(partnership.company_id) THEN
      RAISE EXCEPTION 'PARTNERSHIP_ONBOARDING_INCOMPLETE';
    END IF;
    IF partnership.status = 'ACTIVE' THEN
      RETURN QUERY SELECT partnership.id, partnership.company_id, partnership.type::TEXT, partnership.status::TEXT;
      RETURN;
    END IF;
  ELSIF partnership.status NOT IN ('APPROVED', 'ACTIVE', 'SUSPENDED') THEN
    RAISE EXCEPTION 'PARTNERSHIP_STATE_INVALID';
  ELSIF partnership.status = 'ACTIVE' THEN
    RETURN QUERY SELECT partnership.id, partnership.company_id, partnership.type::TEXT, partnership.status::TEXT;
    RETURN;
  END IF;
  UPDATE public.company_partnerships
     SET status = 'ACTIVE', approved_by = COALESCE(approved_by, p_actor), approved_at = COALESCE(approved_at, clock_timestamp()),
         active_from = clock_timestamp(), suspended_at = NULL, suspended_by = NULL, updated_at = clock_timestamp()
   WHERE company_partnerships.id = p_id;
  INSERT INTO public.company_partnership_events (
    partnership_id, company_id, from_status, to_status, actor_user_id, reason, correlation_id
  ) VALUES (p_id, partnership.company_id, partnership.status::TEXT, 'ACTIVE', p_actor, 'PARTNERSHIP_ACTIVATED', correlation);
  INSERT INTO public.audit_logs (
    actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
  ) VALUES (
    p_actor, partnership.company_id, 'SCO_INTERNAL', 'partnership.activated', 'CompanyPartnership', p_id,
    jsonb_build_object('type', partnership.type::TEXT), correlation, 'PUR-03', 'ALLOWED'
  );
  RETURN QUERY SELECT updated.id, updated.company_id, updated.type::TEXT, updated.status::TEXT
    FROM public.company_partnerships updated WHERE updated.id = p_id;
END $$;

CREATE FUNCTION public.internal_partnership_suspend(p_actor UUID, p_id UUID, p_reason TEXT, p_correlation_id UUID)
RETURNS TABLE(id UUID, "companyId" UUID, type TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE partnership public.company_partnerships%ROWTYPE; correlation UUID := COALESCE(p_correlation_id, gen_random_uuid());
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'partnership.manage') THEN RAISE EXCEPTION 'PARTNERSHIP_MANAGE_FORBIDDEN'; END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'PARTNERSHIP_DECISION_REASON_REQUIRED'; END IF;
  SELECT * INTO partnership FROM public.company_partnerships WHERE company_partnerships.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PARTNERSHIP_NOT_FOUND'; END IF;
  IF partnership.status = 'SUSPENDED' THEN
    RETURN QUERY SELECT partnership.id, partnership.company_id, partnership.type::TEXT, partnership.status::TEXT;
    RETURN;
  END IF;
  IF partnership.status <> 'ACTIVE' THEN RAISE EXCEPTION 'PARTNERSHIP_STATE_INVALID'; END IF;
  UPDATE public.company_partnerships SET status = 'SUSPENDED', suspended_at = clock_timestamp(), suspended_by = p_actor,
    decision_reason = p_reason, updated_at = clock_timestamp() WHERE company_partnerships.id = p_id;
  INSERT INTO public.company_partnership_events (
    partnership_id, company_id, from_status, to_status, actor_user_id, reason, correlation_id
  ) VALUES (p_id, partnership.company_id, 'ACTIVE', 'SUSPENDED', p_actor, p_reason, correlation);
  INSERT INTO public.audit_logs (
    actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
  ) VALUES (
    p_actor, partnership.company_id, 'SCO_INTERNAL', 'partnership.suspended', 'CompanyPartnership', p_id,
    jsonb_build_object('reason', p_reason), correlation, 'PUR-03', 'ALLOWED'
  );
  RETURN QUERY SELECT updated.id, updated.company_id, updated.type::TEXT, updated.status::TEXT
    FROM public.company_partnerships updated WHERE updated.id = p_id;
END $$;

CREATE FUNCTION public.internal_partnership_revoke(p_actor UUID, p_id UUID, p_reason TEXT, p_correlation_id UUID)
RETURNS TABLE(id UUID, "companyId" UUID, type TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE partnership public.company_partnerships%ROWTYPE; correlation UUID := COALESCE(p_correlation_id, gen_random_uuid());
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'partnership.manage') THEN RAISE EXCEPTION 'PARTNERSHIP_MANAGE_FORBIDDEN'; END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'PARTNERSHIP_DECISION_REASON_REQUIRED'; END IF;
  SELECT * INTO partnership FROM public.company_partnerships WHERE company_partnerships.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PARTNERSHIP_NOT_FOUND'; END IF;
  IF partnership.status = 'REVOKED' THEN
    RETURN QUERY SELECT partnership.id, partnership.company_id, partnership.type::TEXT, partnership.status::TEXT;
    RETURN;
  END IF;
  IF partnership.status = 'REJECTED' THEN RAISE EXCEPTION 'PARTNERSHIP_STATE_INVALID'; END IF;
  UPDATE public.company_partnerships SET status = 'REVOKED', revoked_at = clock_timestamp(), revoked_by = p_actor,
    decision_reason = p_reason, updated_at = clock_timestamp() WHERE company_partnerships.id = p_id;
  INSERT INTO public.company_partnership_events (
    partnership_id, company_id, from_status, to_status, actor_user_id, reason, correlation_id
  ) VALUES (p_id, partnership.company_id, partnership.status::TEXT, 'REVOKED', p_actor, p_reason, correlation);
  INSERT INTO public.audit_logs (
    actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
  ) VALUES (
    p_actor, partnership.company_id, 'SCO_INTERNAL', 'partnership.revoked', 'CompanyPartnership', p_id,
    jsonb_build_object('reason', p_reason), correlation, 'PUR-03', 'ALLOWED'
  );
  RETURN QUERY SELECT updated.id, updated.company_id, updated.type::TEXT, updated.status::TEXT
    FROM public.company_partnerships updated WHERE updated.id = p_id;
END $$;

CREATE FUNCTION public.internal_partnership_reject(p_actor UUID, p_id UUID, p_reason TEXT, p_correlation_id UUID)
RETURNS TABLE(id UUID, "companyId" UUID, type TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE partnership public.company_partnerships%ROWTYPE; correlation UUID := COALESCE(p_correlation_id, gen_random_uuid());
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'partnership.manage') THEN RAISE EXCEPTION 'PARTNERSHIP_MANAGE_FORBIDDEN'; END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'PARTNERSHIP_DECISION_REASON_REQUIRED'; END IF;
  SELECT * INTO partnership FROM public.company_partnerships WHERE company_partnerships.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PARTNERSHIP_NOT_FOUND'; END IF;
  IF partnership.status = 'REJECTED' THEN
    RETURN QUERY SELECT partnership.id, partnership.company_id, partnership.type::TEXT, partnership.status::TEXT;
    RETURN;
  END IF;
  IF partnership.status <> 'UNDER_REVIEW' THEN RAISE EXCEPTION 'PARTNERSHIP_STATE_INVALID'; END IF;
  UPDATE public.company_partnerships SET status = 'REJECTED', decision_reason = p_reason, approved_by = p_actor,
    approved_at = clock_timestamp(), updated_at = clock_timestamp() WHERE company_partnerships.id = p_id;
  INSERT INTO public.company_partnership_events (
    partnership_id, company_id, from_status, to_status, actor_user_id, reason, correlation_id
  ) VALUES (p_id, partnership.company_id, 'UNDER_REVIEW', 'REJECTED', p_actor, p_reason, correlation);
  INSERT INTO public.audit_logs (
    actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
  ) VALUES (
    p_actor, partnership.company_id, 'SCO_INTERNAL', 'partnership.rejected', 'CompanyPartnership', p_id,
    jsonb_build_object('reason', p_reason), correlation, 'PUR-03', 'ALLOWED'
  );
  RETURN QUERY SELECT updated.id, updated.company_id, updated.type::TEXT, updated.status::TEXT
    FROM public.company_partnerships updated WHERE updated.id = p_id;
END $$;

CREATE FUNCTION public.partner_admission_status()
RETURNS TABLE(partnership_type TEXT, partnership_status TEXT, qualification_status TEXT, agreement_ready BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor UUID := NULLIF(current_setting('app.actor_id', true), '')::UUID;
        company UUID := NULLIF(current_setting('app.tenant_id', true), '')::UUID;
BEGIN
  IF actor IS NULL OR company IS NULL
     OR NOT public.admission_actor_has_permission(actor, company, 'partner.admission.read') THEN
    RAISE EXCEPTION 'PARTNER_ADMISSION_READ_FORBIDDEN';
  END IF;
  RETURN QUERY
    SELECT partnership.type::TEXT, partnership.status::TEXT, application.status::TEXT,
      public.partner_required_agreements_satisfied(company)
    FROM public.company_partnerships partnership
    LEFT JOIN LATERAL (
      SELECT candidate.status
      FROM public.qualification_applications candidate
      WHERE candidate.company_id = company
      ORDER BY candidate.created_at DESC
      LIMIT 1
    ) application ON true
    WHERE partnership.company_id = company
      AND partnership.type = 'BUYER_PARTNERSHIP'
    ORDER BY partnership.created_at DESC
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::TEXT, NULL::TEXT,
      (SELECT application.status::TEXT FROM public.qualification_applications application
        WHERE application.company_id = company ORDER BY application.created_at DESC LIMIT 1),
      public.partner_required_agreements_satisfied(company);
  END IF;
END $$;

CREATE FUNCTION public.partner_agreement_current()
RETURNS TABLE(
  agreement_type TEXT, version_code TEXT, content_text TEXT,
  effective_at TIMESTAMPTZ, required BOOLEAN, acceptance_status TEXT, accepted_version_code TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor UUID := NULLIF(current_setting('app.actor_id', true), '')::UUID;
        company UUID := NULLIF(current_setting('app.tenant_id', true), '')::UUID;
BEGIN
  IF actor IS NULL OR company IS NULL
     OR NOT public.admission_actor_has_permission(actor, company, 'partner.admission.read') THEN
    RAISE EXCEPTION 'PARTNER_ADMISSION_READ_FORBIDDEN';
  END IF;
  RETURN QUERY
  SELECT policy.agreement_type, policy.version_code, policy.content_text,
         policy.effective_at, policy.required,
         CASE
           WHEN acceptance.id IS NULL THEN 'NOT_ACCEPTED'
           WHEN acceptance_event.status IN ('SUSPENDED', 'TERMINATED') THEN acceptance_event.status
           WHEN policy.reacceptance_required AND acceptance.policy_version_id <> policy.id THEN 'REACCEPTANCE_REQUIRED'
           WHEN acceptance.policy_version_id <> policy.id THEN 'ACCEPTED_HISTORICAL_VERSION'
           ELSE acceptance_event.status
         END,
         acceptance.version_code
    FROM (
      SELECT DISTINCT ON (candidate.agreement_type) candidate.*
      FROM public.partner_agreement_policy_versions candidate
      WHERE candidate.effective_at <= clock_timestamp()
        AND (candidate.superseded_at IS NULL OR candidate.superseded_at > clock_timestamp())
        AND candidate.state IN ('PUBLISHED', 'SUSPENDED', 'TERMINATED')
      ORDER BY candidate.agreement_type, candidate.effective_at DESC, candidate.id DESC
    ) policy
    LEFT JOIN LATERAL (
      SELECT candidate.*
      FROM public.partner_agreement_acceptances candidate
      WHERE candidate.company_id = company AND candidate.agreement_type = policy.agreement_type
      ORDER BY candidate.accepted_at DESC, candidate.id DESC
      LIMIT 1
    ) acceptance ON true
    LEFT JOIN LATERAL (
      SELECT event.status
      FROM public.partner_agreement_acceptance_events event
      WHERE event.acceptance_id = acceptance.id
      ORDER BY event.created_at DESC, event.id DESC
      LIMIT 1
    ) acceptance_event ON true
   ORDER BY policy.agreement_type;
END $$;

CREATE FUNCTION public.partner_agreement_accept(
  p_agreement_type TEXT, p_version_code TEXT, p_idempotency_key TEXT, p_correlation_id UUID
)
RETURNS TABLE(agreement_type TEXT, version_code TEXT, accepted_at TIMESTAMPTZ, acceptance_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor UUID := NULLIF(current_setting('app.actor_id', true), '');
        company UUID := NULLIF(current_setting('app.tenant_id', true), '');
        policy public.partner_agreement_policy_versions%ROWTYPE;
        v_membership_id UUID;
        acceptance public.partner_agreement_acceptances%ROWTYPE;
        fingerprint TEXT;
        permission_code TEXT;
              authority_basis_snapshot JSONB;
        correlation UUID := COALESCE(p_correlation_id, gen_random_uuid());
BEGIN
  IF actor IS NULL OR company IS NULL THEN RAISE EXCEPTION 'PARTNER_AGREEMENT_ACCEPT_FORBIDDEN'; END IF;
  IF btrim(COALESCE(p_agreement_type, '')) = ''
     OR btrim(COALESCE(p_version_code, '')) = ''
     OR btrim(COALESCE(p_idempotency_key, '')) = '' THEN
    RAISE EXCEPTION 'AGREEMENT_ACCEPTANCE_INPUT_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('partner_agreement_policy', 1202));
  PERFORM pg_advisory_xact_lock(hashtextextended(company::TEXT || ':' || actor::TEXT || ':' || COALESCE(p_idempotency_key, ''), 1202));
  SELECT * INTO policy FROM public.partner_agreement_policy_versions policy_row
   WHERE policy_row.agreement_type = p_agreement_type
     AND policy_row.version_code = p_version_code
     AND policy_row.state = 'PUBLISHED'
     AND policy_row.effective_at <= clock_timestamp()
     AND (policy_row.superseded_at IS NULL OR policy_row.superseded_at > clock_timestamp())
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGREEMENT_VERSION_NOT_CURRENT'; END IF;
  IF NOT public.admission_actor_has_permission(actor::UUID, company::UUID, 'partner.agreement.accept')
     OR NOT public.admission_actor_has_permission(actor::UUID, company::UUID, policy.acceptance_permission_code) THEN
    RAISE EXCEPTION 'AGREEMENT_ACCEPTANCE_AUTHORITY_FORBIDDEN';
  END IF;
  SELECT membership.id INTO v_membership_id
    FROM public."CompanyMembership" membership
   WHERE membership."userId" = actor::UUID AND membership."companyId" = company::UUID AND membership.status = 'ACTIVE';
  IF v_membership_id IS NULL THEN RAISE EXCEPTION 'AGREEMENT_ACCEPTANCE_AUTHORITY_FORBIDDEN'; END IF;
  PERFORM 1 FROM public."User" actor_row WHERE actor_row.id = actor::UUID AND actor_row.status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'AGREEMENT_ACCEPTANCE_AUTHORITY_FORBIDDEN'; END IF;
  PERFORM 1 FROM public."Company" company_row WHERE company_row.id = company::UUID AND company_row.status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'AGREEMENT_ACCEPTANCE_AUTHORITY_FORBIDDEN'; END IF;
  FOR permission_code IN
    SELECT DISTINCT required_permission.code
      FROM unnest(ARRAY['partner.agreement.accept', policy.acceptance_permission_code]) AS required_permission(code)
  LOOP
    PERFORM 1
      FROM public."MembershipRole" membership_role
      JOIN public."RolePermission" role_permission ON role_permission.role_id = membership_role.role_id
      JOIN public."Permission" permission ON permission.id = role_permission.permission_id
     WHERE membership_role.membership_id = v_membership_id
       AND membership_role.company_id = company::UUID
       AND role_permission.company_id = company::UUID
       AND permission.code = permission_code
     LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'AGREEMENT_ACCEPTANCE_AUTHORITY_FORBIDDEN'; END IF;
  END LOOP;
  SELECT jsonb_build_object(
    'membershipId', v_membership_id,
    'requiredPermissions', to_jsonb(ARRAY['partner.agreement.accept', policy.acceptance_permission_code]),
    'grantedRoles', COALESCE(jsonb_agg(DISTINCT jsonb_build_object('roleId', role.id, 'roleCode', role.code, 'roleName', role.name)), '[]'::jsonb)
  ) INTO authority_basis_snapshot
  FROM public."MembershipRole" membership_role
  JOIN public."Role" role ON role.id = membership_role.role_id AND role.company_id = company::UUID
  JOIN public."RolePermission" role_permission ON role_permission.role_id = role.id AND role_permission.company_id = company::UUID
  JOIN public."Permission" permission ON permission.id = role_permission.permission_id
  WHERE membership_role.membership_id = v_membership_id
    AND membership_role.company_id = company::UUID
    AND permission.code IN ('partner.agreement.accept', policy.acceptance_permission_code);
  fingerprint := encode(digest(convert_to(policy.agreement_type || E'\n' || policy.version_code || E'\n' || policy.content_sha256, 'UTF8'), 'sha256'), 'hex');
  SELECT * INTO acceptance FROM public.partner_agreement_acceptances
   WHERE company_id = company::UUID
     AND actor_user_id = actor::UUID
     AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF acceptance.request_fingerprint <> fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'; END IF;
    RETURN QUERY SELECT acceptance.agreement_type, acceptance.version_code, acceptance.accepted_at, 'ACCEPTED'::TEXT;
    RETURN;
  END IF;
  INSERT INTO public.partner_agreement_acceptances (
    company_id, actor_user_id, membership_id, policy_version_id, agreement_type, version_code,
    accepted_content_sha256, authority_permission_code, authority_basis, purpose_code, idempotency_key,
    request_fingerprint, correlation_id
  ) VALUES (
    company::UUID, actor::UUID, v_membership_id, policy.id, policy.agreement_type, policy.version_code,
    policy.content_sha256, policy.acceptance_permission_code, authority_basis_snapshot, 'PUR-02', p_idempotency_key,
    fingerprint, correlation
  ) RETURNING * INTO acceptance;
  INSERT INTO public.partner_agreement_acceptance_events (
    acceptance_id, company_id, status, actor_user_id, reason, correlation_id
  ) VALUES (acceptance.id, company::UUID, 'ACCEPTED', actor::UUID, 'PARTNER_ACCEPTED_CURRENT_VERSION', correlation);
  INSERT INTO public.audit_logs (
    actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
  ) VALUES (
    actor::UUID, company::UUID, 'TENANT', 'agreement.accepted', 'PartnerAgreementAcceptance', acceptance.id,
    jsonb_build_object('agreementType', policy.agreement_type, 'versionCode', policy.version_code, 'contentSha256', policy.content_sha256),
    correlation, 'PUR-02', 'ALLOWED'
  );
  RETURN QUERY SELECT acceptance.agreement_type, acceptance.version_code, acceptance.accepted_at, 'ACCEPTED'::TEXT;
END $$;

CREATE FUNCTION public.partner_procurement_access_allowed_for_current_actor()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor UUID := NULLIF(current_setting('app.actor_id', true), '')::UUID;
        company UUID := NULLIF(current_setting('app.tenant_id', true), '')::UUID;
BEGIN
  IF actor IS NULL OR company IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."Company" c WHERE c.id = company AND c.type = 'PARTNER') THEN
    RETURN true;
  END IF;
  RETURN public.admission_actor_has_permission(actor, company, 'partner.portal.read')
    AND EXISTS (
      SELECT 1 FROM public.company_partnerships partnership
       WHERE partnership.company_id = company AND partnership.type = 'BUYER_PARTNERSHIP' AND partnership.status = 'ACTIVE'
    )
    AND public.partner_required_agreements_satisfied(company);
END $$;

CREATE FUNCTION public.partner_procurement_access_allowed(p_actor UUID, p_company UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public."CompanyMembership" membership
      JOIN public."Company" company ON company.id = membership."companyId"
      JOIN public."User" actor ON actor.id = membership."userId"
     WHERE membership."userId" = p_actor
       AND membership."companyId" = p_company
       AND membership.status = 'ACTIVE'
       AND actor.status = 'ACTIVE'
       AND company.status = 'ACTIVE'
       AND company.type = 'PARTNER'
  )
  AND EXISTS (
    SELECT 1 FROM public.company_partnerships partnership
     WHERE partnership.company_id = p_company
       AND partnership.type = 'BUYER_PARTNERSHIP'
       AND partnership.status = 'ACTIVE'
  )
  AND public.admission_actor_has_permission(p_actor, p_company, 'partner.portal.read')
  AND public.partner_required_agreements_satisfied(p_company)
$$;

CREATE OR REPLACE FUNCTION public.internal_procurement_need_create(
  p_actor UUID,
  p_company UUID,
  p_description TEXT,
  p_quantity NUMERIC,
  p_unit_id UUID,
  p_need_date DATE,
  p_project_id UUID,
  p_product_identity_id UUID,
  p_product_candidate_id UUID,
  p_correlation_id UUID
)
RETURNS TABLE(id UUID, description TEXT, quantity NUMERIC, maturity TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_need public.procurement_needs%ROWTYPE; v_correlation_id UUID := COALESCE(p_correlation_id, public.gen_random_uuid());
BEGIN
  IF NOT public.partner_procurement_access_allowed(p_actor, p_company) THEN
    RAISE EXCEPTION 'PROCUREMENT_NEED_INTAKE_FORBIDDEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."CompanyMembership" cm
    WHERE cm."userId" = p_actor AND cm."companyId" = p_company AND cm.status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'PROCUREMENT_NEED_INTAKE_FORBIDDEN'; END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects WHERE projects.id = p_project_id AND projects.company_id = p_company
  ) THEN RAISE EXCEPTION 'PROCUREMENT_NEED_PROJECT_COMPANY_MISMATCH'; END IF;
  INSERT INTO public.procurement_needs (
    company_id, created_by, source_type, description, quantity, unit_id, need_date,
    project_id, product_identity_id, product_candidate_id
  ) VALUES (
    p_company, p_actor, 'MANUAL', p_description, p_quantity, p_unit_id, p_need_date,
    p_project_id, p_product_identity_id, p_product_candidate_id
  ) RETURNING * INTO v_need;
  INSERT INTO public.audit_logs (
    actor_user_id, company_id, scope, action, entity_type, entity_id, metadata,
    correlation_id, purpose_code, flow_cpf_id, flow_source, flow_target, authorization_decision
  ) VALUES (
    p_actor, p_company, 'TENANT', 'procurement_need.created', 'ProcurementNeed', v_need.id, '{}',
    v_correlation_id, 'PUR-05', 'CPF_03', 'PUR-03', 'PUR-05', 'ALLOWED'
  );
  RETURN QUERY SELECT v_need.id, v_need.description, v_need.quantity, v_need.maturity::TEXT;
END $$;

ALTER FUNCTION public.internal_qualification_create(UUID, TEXT, TEXT) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_qualification_create_for_company(UUID, UUID, TEXT, TEXT) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.internal_qualification_decide(UUID, UUID, TEXT, TEXT) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_qualification_list(UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_partnership_create(UUID, UUID, TEXT) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_partnership_approve(UUID, UUID, TEXT, UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.internal_partnership_activate(UUID, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_partnership_suspend(UUID, UUID, TEXT, UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.internal_partnership_revoke(UUID, UUID, TEXT, UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.internal_partnership_reject(UUID, UUID, TEXT, UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.internal_partner_agreement_policy_create(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.internal_partner_agreement_policy_publish(UUID, UUID, UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.internal_partner_agreement_policy_transition(UUID, UUID, TEXT, TEXT, UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.admission_actor_has_permission(UUID, UUID, TEXT) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.partner_company_has_portal_member(UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.partner_required_agreements_satisfied(UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.partner_admission_status() OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.partner_agreement_current() OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.partner_agreement_accept(TEXT, TEXT, TEXT, UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.partner_procurement_access_allowed_for_current_actor() OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.partner_procurement_access_allowed(UUID, UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.internal_procurement_need_create(UUID, UUID, TEXT, NUMERIC, UUID, DATE, UUID, UUID, UUID, UUID) OWNER TO sco_internal_gateway_owner;

REVOKE ALL ON FUNCTION public.internal_qualification_create(UUID, TEXT, TEXT),
  public.internal_qualification_create_for_company(UUID, UUID, TEXT, TEXT),
  public.internal_qualification_decide(UUID, UUID, TEXT, TEXT), public.internal_qualification_list(UUID),
  public.internal_partnership_create(UUID, UUID, TEXT), public.internal_partnership_approve(UUID, UUID, TEXT, UUID),
  public.internal_partnership_activate(UUID, UUID), public.internal_partnership_suspend(UUID, UUID, TEXT, UUID),
  public.internal_partnership_revoke(UUID, UUID, TEXT, UUID), public.internal_partnership_reject(UUID, UUID, TEXT, UUID),
  public.internal_partner_agreement_policy_create(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, UUID),
  public.internal_partner_agreement_policy_publish(UUID, UUID, UUID),
  public.internal_partner_agreement_policy_transition(UUID, UUID, TEXT, TEXT, UUID),
  public.admission_actor_has_permission(UUID, UUID, TEXT), public.partner_company_has_portal_member(UUID),
  public.partner_required_agreements_satisfied(UUID),
  public.partner_admission_status(), public.partner_agreement_current(), public.partner_agreement_accept(TEXT, TEXT, TEXT, UUID),
  public.partner_procurement_access_allowed_for_current_actor(), public.partner_procurement_access_allowed(UUID, UUID),
  public.internal_procurement_need_create(UUID, UUID, TEXT, NUMERIC, UUID, DATE, UUID, UUID, UUID, UUID)
  FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;

GRANT EXECUTE ON FUNCTION public.internal_qualification_create(UUID, TEXT, TEXT),
  public.internal_qualification_create_for_company(UUID, UUID, TEXT, TEXT),
  public.internal_qualification_decide(UUID, UUID, TEXT, TEXT), public.internal_qualification_list(UUID),
  public.internal_partnership_create(UUID, UUID, TEXT), public.internal_partnership_approve(UUID, UUID, TEXT, UUID),
  public.internal_partnership_activate(UUID, UUID), public.internal_partnership_suspend(UUID, UUID, TEXT, UUID),
  public.internal_partnership_revoke(UUID, UUID, TEXT, UUID), public.internal_partnership_reject(UUID, UUID, TEXT, UUID),
  public.internal_partner_agreement_policy_create(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, UUID),
  public.internal_partner_agreement_policy_publish(UUID, UUID, UUID),
  public.internal_partner_agreement_policy_transition(UUID, UUID, TEXT, TEXT, UUID),
  public.internal_procurement_need_create(UUID, UUID, TEXT, NUMERIC, UUID, DATE, UUID, UUID, UUID, UUID)
  TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.partner_admission_status(), public.partner_agreement_current(),
  public.partner_agreement_accept(TEXT, TEXT, TEXT, UUID), public.partner_procurement_access_allowed_for_current_actor()
  TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.partner_procurement_access_allowed(UUID, UUID)
  TO sco_internal_gateway_owner;

REVOKE ALL ON FUNCTION public.admission_actor_has_permission(UUID, UUID, TEXT),
  public.partner_required_agreements_satisfied(UUID), public.partner_procurement_access_allowed(UUID, UUID)
  FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;
GRANT EXECUTE ON FUNCTION public.partner_required_agreements_satisfied(UUID) TO sco_internal_gateway_owner;
GRANT EXECUTE ON FUNCTION public.partner_company_has_portal_member(UUID) TO sco_internal_gateway_owner;

-- Class D Partner surfaces retain their domain permissions, but every existing capability
-- boundary additionally requires a current active Buyer partnership and Binding Confidentiality.
CREATE OR REPLACE FUNCTION public.partner_po_capability(p_actor UUID, p_company UUID, p_code TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.partner_procurement_access_allowed(p_actor, p_company)
     AND public.admission_actor_has_permission(p_actor, p_company, p_code)
$$;

CREATE OR REPLACE FUNCTION public.partner_delivery_action_capability(p_actor UUID, p_company UUID, p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.partner_procurement_access_allowed(p_actor, p_company)
     AND public.admission_actor_has_permission(p_actor, p_company, p_permission)
$$;

CREATE OR REPLACE FUNCTION public.partner_delivery_projection_capability(p_actor UUID, p_company UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.partner_procurement_access_allowed(p_actor, p_company)
     AND public.admission_actor_has_permission(p_actor, p_company, 'partner_delivery_projection.read')
$$;

CREATE OR REPLACE FUNCTION public.partner_verify_read_allowed(p_actor UUID, p_company UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.partner_procurement_access_allowed(p_actor, p_company)
     AND public.admission_actor_has_permission(p_actor, p_company, 'partner_verify.read')
$$;

ALTER FUNCTION public.partner_po_capability(UUID, UUID, TEXT) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.partner_delivery_action_capability(UUID, UUID, TEXT) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.partner_delivery_projection_capability(UUID, UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.partner_verify_read_allowed(UUID, UUID) OWNER TO sco_verify_partner_read_owner;
REVOKE ALL ON FUNCTION public.partner_po_capability(UUID, UUID, TEXT),
  public.partner_delivery_action_capability(UUID, UUID, TEXT),
  public.partner_delivery_projection_capability(UUID, UUID),
  public.partner_verify_read_allowed(UUID, UUID)
  FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;
GRANT EXECUTE ON FUNCTION public.partner_po_capability(UUID, UUID, TEXT),
  public.partner_delivery_action_capability(UUID, UUID, TEXT),
  public.partner_delivery_projection_capability(UUID, UUID),
  public.partner_verify_read_allowed(UUID, UUID)
  TO sco_partner_admission_gateway_owner;
GRANT EXECUTE ON FUNCTION public.partner_verify_read_allowed(UUID, UUID)
  TO sco_verify_partner_read_owner;
GRANT EXECUTE ON FUNCTION public.partner_procurement_access_allowed(UUID, UUID),
  public.admission_actor_has_permission(UUID, UUID, TEXT)
  TO sco_verify_partner_read_owner;
