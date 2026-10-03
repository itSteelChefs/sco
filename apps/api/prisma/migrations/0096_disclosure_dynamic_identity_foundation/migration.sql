CREATE TYPE "DisclosureIdentityClass" AS ENUM ('ORGANIZATION','SUPPLIER_SOURCE','PERSON_CONTACT','PROJECT_SITE','EMBEDDED_IDENTITY_RISK');
CREATE TYPE "DisclosureRecipientContext" AS ENUM ('SAME_COMPANY_INTERNAL','PARTNER','SCO_INTERNAL','CROSS_PARTY_EXTERNAL');
CREATE TYPE "DisclosureAliasLifecycleStatus" AS ENUM ('ACTIVE','RETIRED');

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'disclosure.alias.manage', 'Create and retire controlled disclosure aliases'),
  (gen_random_uuid(), 'disclosure.projection.read', 'Read authorized controlled disclosure projections')
ON CONFLICT(code) DO NOTHING;

CREATE TABLE public.disclosure_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias TEXT NOT NULL UNIQUE CHECK (alias ~ '^[A-Za-z0-9_-]{32,128}$'),
  owner_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  recipient_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  recipient_context "DisclosureRecipientContext" NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type = 'DISCLOSURE_FIXTURE'),
  resource_id UUID NOT NULL,
  identity_class "DisclosureIdentityClass" NOT NULL,
  subject_reference UUID NOT NULL,
  status "DisclosureAliasLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  retired_at TIMESTAMPTZ,
  CHECK ((status = 'ACTIVE' AND retired_by IS NULL AND retired_at IS NULL) OR (status = 'RETIRED' AND retired_by IS NOT NULL AND retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX disclosure_aliases_active_scope_unique
  ON public.disclosure_aliases (owner_company_id, recipient_company_id, recipient_context, resource_type, resource_id, identity_class, subject_reference)
  WHERE status = 'ACTIVE';
CREATE INDEX disclosure_aliases_presentation_scope_idx
  ON public.disclosure_aliases (recipient_company_id, recipient_context, resource_type, resource_id, identity_class, subject_reference)
  WHERE status = 'ACTIVE';

ALTER TABLE public.disclosure_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disclosure_aliases FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.disclosure_aliases FROM PUBLIC, sco_runtime, sco_internal_executor;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_disclosure_gateway_owner') THEN
    CREATE ROLE sco_disclosure_gateway_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE sco_disclosure_gateway_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO sco_disclosure_gateway_owner;
GRANT SELECT ON public."User", public."CompanyMembership", public."Company", public."MembershipRole", public."RolePermission", public."Permission" TO sco_disclosure_gateway_owner;
GRANT EXECUTE ON FUNCTION public.internal_has_capability(UUID, TEXT) TO sco_disclosure_gateway_owner;
ALTER TABLE public.disclosure_aliases OWNER TO sco_disclosure_gateway_owner;
CREATE POLICY disclosure_aliases_gateway_owner ON public.disclosure_aliases
  FOR ALL TO sco_disclosure_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY company_membership_disclosure_gateway_owner_read ON public."CompanyMembership"
  FOR SELECT TO sco_disclosure_gateway_owner
  USING ("companyId" = NULLIF(current_setting('app.tenant_id', true), '')::UUID);
CREATE POLICY membership_role_disclosure_gateway_owner_read ON public."MembershipRole"
  FOR SELECT TO sco_disclosure_gateway_owner
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);
CREATE POLICY role_permission_disclosure_gateway_owner_read ON public."RolePermission"
  FOR SELECT TO sco_disclosure_gateway_owner
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);

CREATE TABLE public.disclosure_fixture_purpose_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id),
  company_id UUID NOT NULL REFERENCES public."Company"(id),
  resource_id UUID NOT NULL,
  subject_reference UUID NOT NULL,
  purpose_code TEXT NOT NULL CHECK (purpose_code = 'PUR-13'),
  flow_cpf_id TEXT NOT NULL CHECK (flow_cpf_id = 'CPF_15'),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_backend_pid INTEGER,
  consumed_transaction_id BIGINT,
  CHECK (expires_at > issued_at AND expires_at <= issued_at + INTERVAL '60 seconds'),
  CHECK ((consumed_at IS NULL AND consumed_backend_pid IS NULL AND consumed_transaction_id IS NULL) OR (consumed_at IS NOT NULL AND consumed_backend_pid IS NOT NULL AND consumed_transaction_id IS NOT NULL))
);
ALTER TABLE public.disclosure_fixture_purpose_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disclosure_fixture_purpose_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.disclosure_fixture_purpose_decisions OWNER TO sco_disclosure_gateway_owner;
REVOKE ALL ON TABLE public.disclosure_fixture_purpose_decisions FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;
CREATE POLICY disclosure_fixture_purpose_decisions_owner_scope ON public.disclosure_fixture_purpose_decisions
  FOR ALL TO sco_disclosure_gateway_owner
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID)
  WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);

CREATE FUNCTION public.disclosure_projection_allowed(p_actor UUID, p_company UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT current_setting('app.actor_id', true) = p_actor::TEXT
    AND current_setting('app.tenant_id', true) = p_company::TEXT
    AND EXISTS (
      SELECT 1 FROM public."CompanyMembership" cm
      JOIN public."User" u ON u.id = cm."userId" AND u.status = 'ACTIVE'
      JOIN public."Company" c ON c.id = cm."companyId" AND c.status = 'ACTIVE'
      JOIN public."MembershipRole" mr ON mr.membership_id = cm.id
      JOIN public."RolePermission" rp ON rp.role_id = mr.role_id
      JOIN public."Permission" permission ON permission.id = rp.permission_id
      WHERE cm."userId" = p_actor AND cm."companyId" = p_company
        AND cm.status = 'ACTIVE' AND permission.code = 'disclosure.projection.read'
    );
$$;

CREATE FUNCTION public.disclosure_owner_capability(p_actor UUID, p_owner_company UUID, p_permission TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_owner_company::TEXT, true);
  RETURN EXISTS (
    SELECT 1
    FROM public."CompanyMembership" cm
    JOIN public."Company" c ON c.id = cm."companyId" AND c.type = 'SCO' AND c.status = 'ACTIVE'
    JOIN public."MembershipRole" mr ON mr.membership_id = cm.id
    JOIN public."RolePermission" rp ON rp.role_id = mr.role_id
    JOIN public."Permission" permission ON permission.id = rp.permission_id
    WHERE cm."userId" = p_actor AND cm."companyId" = p_owner_company
      AND cm.status = 'ACTIVE' AND permission.code = p_permission
  );
END $$;

CREATE FUNCTION public.internal_disclosure_alias_create(
  p_actor UUID, p_owner_company UUID, p_recipient_company UUID, p_recipient_context "DisclosureRecipientContext",
  p_resource_type TEXT, p_resource UUID, p_identity_class "DisclosureIdentityClass", p_subject_reference UUID, p_alias TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id UUID;
BEGIN
  IF session_user <> 'sco_internal_executor' OR NOT EXISTS (
    SELECT 1 FROM public."Company" WHERE id = p_owner_company AND type = 'SCO' AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ALIAS_CREATE_FORBIDDEN';
  END IF;
  IF NOT public.disclosure_owner_capability(p_actor, p_owner_company, 'disclosure.alias.manage') THEN
    RAISE EXCEPTION 'DISCLOSURE_ALIAS_CREATE_FORBIDDEN';
  END IF;
  IF p_recipient_context = 'CROSS_PARTY_EXTERNAL' OR p_resource_type <> 'DISCLOSURE_FIXTURE' THEN
    RAISE EXCEPTION 'DISCLOSURE_ALIAS_SCOPE_UNSUPPORTED';
  END IF;
  INSERT INTO public.disclosure_aliases(alias, owner_company_id, recipient_company_id, recipient_context, resource_type, resource_id, identity_class, subject_reference, created_by)
  VALUES (p_alias, p_owner_company, p_recipient_company, p_recipient_context, p_resource_type, p_resource, p_identity_class, p_subject_reference, p_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.issue_disclosure_fixture_purpose_decision(p_actor UUID, p_company UUID, p_resource UUID, p_subject_reference UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id UUID;
BEGIN
  IF session_user <> 'sco_purpose_authority' THEN RAISE EXCEPTION 'DISCLOSURE_PURPOSE_ISSUE_FORBIDDEN'; END IF;
  PERFORM set_config('app.tenant_id', p_company::TEXT, true);
  IF NOT public.disclosure_projection_allowed(p_actor, p_company) THEN RAISE EXCEPTION 'DISCLOSURE_PURPOSE_ISSUE_FORBIDDEN'; END IF;
  INSERT INTO public.disclosure_fixture_purpose_decisions(actor_user_id, company_id, resource_id, subject_reference, purpose_code, flow_cpf_id, expires_at)
  VALUES (p_actor, p_company, p_resource, p_subject_reference, 'PUR-13', 'CPF_15', clock_timestamp() + INTERVAL '30 seconds') RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.disclosure_fixture_purpose_authorized(p_actor UUID, p_company UUID, p_resource UUID, p_subject_reference UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ SELECT false $$;

CREATE FUNCTION public.disclosure_alias_present(
  p_actor UUID, p_recipient_company UUID, p_resource_type TEXT, p_resource UUID,
  p_identity_class "DisclosureIdentityClass", p_subject_reference UUID
) RETURNS TEXT LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT alias FROM public.disclosure_aliases
  WHERE public.disclosure_projection_allowed(p_actor, p_recipient_company)
    AND public.disclosure_fixture_purpose_authorized(p_actor, p_recipient_company, p_resource, p_subject_reference)
    AND recipient_company_id = p_recipient_company AND recipient_context = 'PARTNER'
    AND resource_type = p_resource_type AND resource_id = p_resource
    AND identity_class = p_identity_class AND subject_reference = p_subject_reference AND status = 'ACTIVE'
  LIMIT 1;
$$;

CREATE FUNCTION public.consume_disclosure_fixture_purpose_decision(p_decision UUID, p_actor UUID, p_company UUID, p_resource UUID, p_subject_reference UUID, p_backend_pid INTEGER, p_transaction_id BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF session_user <> 'sco_purpose_authority' OR p_backend_pid <= 0 OR p_transaction_id <= 0 THEN RAISE EXCEPTION 'DISCLOSURE_PURPOSE_CONSUME_FORBIDDEN'; END IF;
  PERFORM set_config('app.tenant_id', p_company::TEXT, true);
  UPDATE public.disclosure_fixture_purpose_decisions SET consumed_at = clock_timestamp(), consumed_backend_pid = p_backend_pid, consumed_transaction_id = p_transaction_id
   WHERE id = p_decision AND actor_user_id = p_actor AND company_id = p_company AND resource_id = p_resource AND subject_reference = p_subject_reference
     AND consumed_at IS NULL AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'DISCLOSURE_PURPOSE_CONSUME_FORBIDDEN'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.disclosure_fixture_purpose_authorized(p_actor UUID, p_company UUID, p_resource UUID, p_subject_reference UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_decision UUID;
BEGIN
  BEGIN v_decision := NULLIF(current_setting('app.disclosure_purpose_decision', true), '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN RETURN FALSE;
  END;
  RETURN v_decision IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.disclosure_fixture_purpose_decisions
    WHERE id = v_decision AND actor_user_id = p_actor AND company_id = p_company AND resource_id = p_resource AND subject_reference = p_subject_reference
      AND purpose_code = 'PUR-13' AND flow_cpf_id = 'CPF_15' AND consumed_at IS NOT NULL AND expires_at > clock_timestamp()
      AND consumed_backend_pid = pg_backend_pid() AND consumed_transaction_id = txid_current()
  );
END $$;

CREATE FUNCTION public.internal_disclosure_alias_retire(p_actor UUID, p_alias UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_owner_company UUID;
BEGIN
  IF session_user <> 'sco_internal_executor' THEN
    RAISE EXCEPTION 'DISCLOSURE_ALIAS_RETIRE_FORBIDDEN';
  END IF;
  SELECT owner_company_id INTO v_owner_company FROM public.disclosure_aliases WHERE id = p_alias;
  IF v_owner_company IS NULL THEN RAISE EXCEPTION 'DISCLOSURE_ALIAS_RETIRE_FORBIDDEN'; END IF;
  IF NOT public.disclosure_owner_capability(p_actor, v_owner_company, 'disclosure.alias.manage') THEN RAISE EXCEPTION 'DISCLOSURE_ALIAS_RETIRE_FORBIDDEN'; END IF;
  UPDATE public.disclosure_aliases
     SET status = 'RETIRED', retired_by = p_actor, retired_at = clock_timestamp()
   WHERE id = p_alias AND status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'DISCLOSURE_ALIAS_RETIRE_FORBIDDEN'; END IF;
END $$;

ALTER FUNCTION public.disclosure_projection_allowed(UUID, UUID) OWNER TO sco_disclosure_gateway_owner;
ALTER FUNCTION public.disclosure_owner_capability(UUID, UUID, TEXT) OWNER TO sco_disclosure_gateway_owner;
ALTER FUNCTION public.internal_disclosure_alias_create(UUID, UUID, UUID, "DisclosureRecipientContext", TEXT, UUID, "DisclosureIdentityClass", UUID, TEXT) OWNER TO sco_disclosure_gateway_owner;
ALTER FUNCTION public.issue_disclosure_fixture_purpose_decision(UUID, UUID, UUID, UUID) OWNER TO sco_disclosure_gateway_owner;
ALTER FUNCTION public.consume_disclosure_fixture_purpose_decision(UUID, UUID, UUID, UUID, UUID, INTEGER, BIGINT) OWNER TO sco_disclosure_gateway_owner;
ALTER FUNCTION public.disclosure_fixture_purpose_authorized(UUID, UUID, UUID, UUID) OWNER TO sco_disclosure_gateway_owner;
ALTER FUNCTION public.disclosure_alias_present(UUID, UUID, TEXT, UUID, "DisclosureIdentityClass", UUID) OWNER TO sco_disclosure_gateway_owner;
ALTER FUNCTION public.internal_disclosure_alias_retire(UUID, UUID) OWNER TO sco_disclosure_gateway_owner;
REVOKE ALL ON FUNCTION public.disclosure_projection_allowed(UUID, UUID), public.disclosure_owner_capability(UUID, UUID, TEXT), public.internal_disclosure_alias_create(UUID, UUID, UUID, "DisclosureRecipientContext", TEXT, UUID, "DisclosureIdentityClass", UUID, TEXT), public.disclosure_alias_present(UUID, UUID, TEXT, UUID, "DisclosureIdentityClass", UUID), public.internal_disclosure_alias_retire(UUID, UUID), public.issue_disclosure_fixture_purpose_decision(UUID, UUID, UUID, UUID), public.consume_disclosure_fixture_purpose_decision(UUID, UUID, UUID, UUID, UUID, INTEGER, BIGINT), public.disclosure_fixture_purpose_authorized(UUID, UUID, UUID, UUID) FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;
GRANT EXECUTE ON FUNCTION public.disclosure_alias_present(UUID, UUID, TEXT, UUID, "DisclosureIdentityClass", UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.issue_disclosure_fixture_purpose_decision(UUID, UUID, UUID, UUID), public.consume_disclosure_fixture_purpose_decision(UUID, UUID, UUID, UUID, UUID, INTEGER, BIGINT) TO sco_purpose_authority;
GRANT EXECUTE ON FUNCTION public.internal_disclosure_alias_create(UUID, UUID, UUID, "DisclosureRecipientContext", TEXT, UUID, "DisclosureIdentityClass", UUID, TEXT), public.internal_disclosure_alias_retire(UUID, UUID) TO sco_internal_executor;
