DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_service_access_gateway_owner') THEN
    CREATE ROLE sco_service_access_gateway_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE sco_service_access_gateway_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE ALL ON SCHEMA public FROM sco_service_access_gateway_owner;
GRANT USAGE ON SCHEMA public TO sco_service_access_gateway_owner;

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'service_access.manage', 'Grant, revoke, and administer company service access'),
  (gen_random_uuid(), 'service_access.use', 'Operate through an explicitly granted company service access scope')
ON CONFLICT (code) DO NOTHING;

CREATE TYPE "ServiceEntitlementState" AS ENUM ('ACTIVE', 'DISABLED', 'REVOKED');

CREATE TABLE public.service_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  service_code TEXT NOT NULL CHECK (service_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  state "ServiceEntitlementState" NOT NULL DEFAULT 'ACTIVE',
  changed_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (company_id, service_code)
);

CREATE TABLE public.service_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  actor_sco_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  granting_sco_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  target_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  entitlement_id UUID NOT NULL REFERENCES public.service_entitlements(id) ON DELETE RESTRICT,
  service_code TEXT NOT NULL CHECK (service_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  purpose_code TEXT NOT NULL CHECK (purpose_code = 'PUR-02'),
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  revocation_reason TEXT,
  granted_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > created_at),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)),
  UNIQUE (granting_sco_company_id, idempotency_key)
);

CREATE UNIQUE INDEX service_access_grants_active_scope_unique
  ON public.service_access_grants(actor_user_id, target_company_id, service_code, purpose_code)
  WHERE revoked_at IS NULL;
CREATE INDEX service_access_grants_effective_idx
  ON public.service_access_grants(actor_user_id, target_company_id, service_code, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE public.service_access_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id UUID NOT NULL REFERENCES public.service_access_grants(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  authorization_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  target_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  service_code TEXT NOT NULL CHECK (service_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  purpose_code TEXT NOT NULL CHECK (purpose_code = 'PUR-02'),
  operation TEXT NOT NULL CHECK (operation = 'SERVICE_ACCESS_EXECUTE'),
  resource_context TEXT NOT NULL CHECK (btrim(resource_context) <> ''),
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
CREATE INDEX service_access_decisions_expiry_idx
  ON public.service_access_decisions(expires_at) WHERE consumed_at IS NULL;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'service_entitlements',
    'service_access_grants',
    'service_access_decisions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I OWNER TO sco_service_access_gateway_owner', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO sco_service_access_gateway_owner USING (true) WITH CHECK (true)', table_name || '_gateway_owner', table_name);
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.service_entitlements, public.service_access_grants, public.service_access_decisions
  FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;

GRANT SELECT ON public."Company", public."CompanyMembership", public."MembershipRole", public."RolePermission", public."Permission"
  TO sco_service_access_gateway_owner;
CREATE POLICY service_access_company_owner_read ON public."Company"
  FOR SELECT TO sco_service_access_gateway_owner USING (true);
CREATE POLICY service_access_membership_owner_read ON public."CompanyMembership"
  FOR SELECT TO sco_service_access_gateway_owner USING (true);
CREATE POLICY service_access_membership_role_owner_read ON public."MembershipRole"
  FOR SELECT TO sco_service_access_gateway_owner USING (true);
CREATE POLICY service_access_role_permission_owner_read ON public."RolePermission"
  FOR SELECT TO sco_service_access_gateway_owner USING (true);
CREATE POLICY service_access_permission_owner_read ON public."Permission"
  FOR SELECT TO sco_service_access_gateway_owner USING (true);

GRANT INSERT ON public.audit_logs TO sco_service_access_gateway_owner;
CREATE POLICY audit_logs_service_access_gateway_insert ON public.audit_logs
  FOR INSERT TO sco_service_access_gateway_owner WITH CHECK (true);

CREATE FUNCTION public.service_access_trusted_sco_context(p_actor UUID, p_permission TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE context_ids UUID[];
BEGIN
  SELECT array_agg(DISTINCT cm."companyId") INTO context_ids
  FROM public."CompanyMembership" cm
  JOIN public."Company" company ON company.id = cm."companyId"
  JOIN public."MembershipRole" membership_role ON membership_role.membership_id = cm.id
  JOIN public."RolePermission" role_permission ON role_permission.role_id = membership_role.role_id
  JOIN public."Permission" permission ON permission.id = role_permission.permission_id
  WHERE cm."userId" = p_actor
    AND cm.status = 'ACTIVE'
    AND company.type = 'SCO'
    AND company.status = 'ACTIVE'
    AND permission.code = p_permission;

  IF COALESCE(cardinality(context_ids), 0) <> 1 THEN
    RAISE EXCEPTION 'SERVICE_ACCESS_TRUSTED_CONTEXT_REQUIRED';
  END IF;
  RETURN context_ids[1];
END
$$;

CREATE FUNCTION public.internal_service_entitlement_set(
  p_actor UUID,
  p_company UUID,
  p_service_code TEXT,
  p_state "ServiceEntitlementState"
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE entitlement_id UUID;
DECLARE trusted_company UUID;
BEGIN
  IF session_user <> 'sco_internal_executor' THEN
    RAISE EXCEPTION 'SERVICE_ENTITLEMENT_FORBIDDEN';
  END IF;
  trusted_company := public.service_access_trusted_sco_context(p_actor, 'service_access.manage');
  IF NOT EXISTS (
    SELECT 1 FROM public."Company"
    WHERE id = p_company AND type = 'PARTNER' AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'SERVICE_ENTITLEMENT_TARGET_FORBIDDEN';
  END IF;

  INSERT INTO public.service_entitlements(company_id, service_code, state, changed_by)
  VALUES (p_company, p_service_code, p_state, p_actor)
  ON CONFLICT (company_id, service_code) DO UPDATE
    SET state = EXCLUDED.state, changed_by = EXCLUDED.changed_by, changed_at = clock_timestamp()
  RETURNING id INTO entitlement_id;

  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, purpose_code, authorization_decision)
  VALUES (
    p_actor, p_company, 'TENANT', 'service_entitlement.changed', 'ServiceEntitlement', entitlement_id,
    jsonb_build_object('serviceCode', p_service_code, 'state', p_state::TEXT, 'trustedScoCompanyId', trusted_company),
    'PUR-02', 'ALLOWED'
  );
  RETURN entitlement_id;
END
$$;

CREATE FUNCTION public.internal_service_access_grant_create(
  p_issuer UUID,
  p_actor UUID,
  p_target_company UUID,
  p_service_code TEXT,
  p_expires_at TIMESTAMPTZ,
  p_idempotency_key TEXT,
  p_correlation_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE issuer_company UUID;
DECLARE actor_company UUID;
DECLARE entitlement UUID;
DECLARE grant_id UUID;
DECLARE existing public.service_access_grants%ROWTYPE;
BEGIN
  IF session_user <> 'sco_internal_executor' OR p_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'SERVICE_ACCESS_GRANT_FORBIDDEN';
  END IF;
  issuer_company := public.service_access_trusted_sco_context(p_issuer, 'service_access.manage');
  actor_company := public.service_access_trusted_sco_context(p_actor, 'service_access.use');
  PERFORM pg_advisory_xact_lock(hashtextextended('service-access-grant:' || issuer_company::TEXT || ':' || p_idempotency_key, 0));

  SELECT * INTO existing
  FROM public.service_access_grants
  WHERE granting_sco_company_id = issuer_company AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF existing.actor_user_id = p_actor
      AND existing.target_company_id = p_target_company
      AND existing.service_code = p_service_code
      AND existing.expires_at = p_expires_at THEN
      RETURN existing.id;
    END IF;
    RAISE EXCEPTION 'SERVICE_ACCESS_GRANT_IDEMPOTENCY_CONFLICT';
  END IF;

  SELECT id INTO entitlement
  FROM public.service_entitlements
  WHERE company_id = p_target_company AND service_code = p_service_code AND state = 'ACTIVE';
  IF entitlement IS NULL THEN
    RAISE EXCEPTION 'SERVICE_ACCESS_ENTITLEMENT_FORBIDDEN';
  END IF;

  INSERT INTO public.service_access_grants(
    actor_user_id, actor_sco_company_id, granting_sco_company_id, target_company_id, entitlement_id,
    service_code, purpose_code, idempotency_key, expires_at, granted_by, correlation_id
  ) VALUES (
    p_actor, actor_company, issuer_company, p_target_company, entitlement,
    p_service_code, 'PUR-02', p_idempotency_key, p_expires_at, p_issuer, p_correlation_id
  ) RETURNING id INTO grant_id;

  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (
    p_issuer, p_target_company, 'TENANT', 'service_access.granted', 'ServiceAccessGrant', grant_id,
    jsonb_build_object('actorUserId', p_actor, 'serviceCode', p_service_code, 'trustedScoCompanyId', issuer_company),
    p_correlation_id, 'PUR-02', 'ALLOWED'
  );
  RETURN grant_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'SERVICE_ACCESS_DUPLICATE_GRANT';
END
$$;

CREATE FUNCTION public.internal_service_access_grant_revoke(
  p_issuer UUID,
  p_grant UUID,
  p_reason TEXT,
  p_correlation_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE issuer_company UUID;
DECLARE grant_row public.service_access_grants%ROWTYPE;
BEGIN
  IF session_user <> 'sco_internal_executor' OR btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'SERVICE_ACCESS_REVOKE_FORBIDDEN';
  END IF;
  issuer_company := public.service_access_trusted_sco_context(p_issuer, 'service_access.manage');
  SELECT * INTO grant_row
  FROM public.service_access_grants
  WHERE id = p_grant AND granting_sco_company_id = issuer_company
  FOR UPDATE;
  IF NOT FOUND OR grant_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'SERVICE_ACCESS_REVOKE_FORBIDDEN';
  END IF;
  UPDATE public.service_access_grants
  SET revoked_at = clock_timestamp(), revoked_by = p_issuer, revocation_reason = p_reason
  WHERE id = p_grant AND granting_sco_company_id = issuer_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_ACCESS_REVOKE_FORBIDDEN';
  END IF;
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (
    p_issuer, grant_row.target_company_id, 'TENANT', 'service_access.revoked', 'ServiceAccessGrant', p_grant,
    jsonb_build_object('serviceCode', grant_row.service_code, 'trustedScoCompanyId', issuer_company),
    p_correlation_id, 'PUR-02', 'ALLOWED'
  );
END
$$;

CREATE FUNCTION public.issue_service_access_decision(
  p_actor UUID,
  p_target_company UUID,
  p_service_code TEXT,
  p_resource_context TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE decision_id UUID;
DECLARE trusted_company UUID;
DECLARE grant_id UUID;
BEGIN
  IF session_user <> 'sco_purpose_authority' OR btrim(COALESCE(p_resource_context, '')) = '' THEN
    RAISE EXCEPTION 'SERVICE_ACCESS_DECISION_ISSUE_FORBIDDEN';
  END IF;
  trusted_company := public.service_access_trusted_sco_context(p_actor, 'service_access.use');
  SELECT access_grant.id INTO grant_id
  FROM public.service_access_grants access_grant
  JOIN public.service_entitlements entitlement ON entitlement.id = access_grant.entitlement_id
  WHERE access_grant.actor_user_id = p_actor
    AND access_grant.actor_sco_company_id = trusted_company
    AND access_grant.target_company_id = p_target_company
    AND access_grant.service_code = p_service_code
    AND access_grant.purpose_code = 'PUR-02'
    AND access_grant.revoked_at IS NULL
    AND access_grant.expires_at > clock_timestamp()
    AND entitlement.company_id = p_target_company
    AND entitlement.service_code = p_service_code
    AND entitlement.state = 'ACTIVE'
  FOR UPDATE;
  IF grant_id IS NULL THEN
    RAISE EXCEPTION 'SERVICE_ACCESS_DECISION_ISSUE_FORBIDDEN';
  END IF;
  INSERT INTO public.service_access_decisions(
    grant_id, actor_user_id, authorization_company_id, target_company_id, service_code,
    purpose_code, operation, resource_context, expires_at
  ) VALUES (
    grant_id, p_actor, trusted_company, p_target_company, p_service_code,
    'PUR-02', 'SERVICE_ACCESS_EXECUTE', p_resource_context, clock_timestamp() + INTERVAL '30 seconds'
  ) RETURNING id INTO decision_id;
  RETURN decision_id;
END
$$;

CREATE FUNCTION public.consume_service_access_decision(
  p_decision UUID,
  p_actor UUID,
  p_target_company UUID,
  p_service_code TEXT,
  p_resource_context TEXT,
  p_backend_pid INTEGER,
  p_transaction_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF session_user <> 'sco_purpose_authority' OR p_backend_pid <= 0 OR p_transaction_id <= 0 THEN
    RAISE EXCEPTION 'SERVICE_ACCESS_DECISION_CONSUME_FORBIDDEN';
  END IF;
  UPDATE public.service_access_decisions
  SET consumed_at = clock_timestamp(), consumed_backend_pid = p_backend_pid, consumed_transaction_id = p_transaction_id
  WHERE id = p_decision
    AND actor_user_id = p_actor
    AND target_company_id = p_target_company
    AND service_code = p_service_code
    AND purpose_code = 'PUR-02'
    AND operation = 'SERVICE_ACCESS_EXECUTE'
    AND resource_context = p_resource_context
    AND consumed_at IS NULL
    AND expires_at > clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_ACCESS_DECISION_CONSUME_FORBIDDEN';
  END IF;
END
$$;

CREATE FUNCTION public.internal_service_access_authorize(
  p_actor UUID,
  p_target_company UUID,
  p_service_code TEXT,
  p_resource_context TEXT,
  p_decision UUID,
  p_correlation_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE decision_row public.service_access_decisions%ROWTYPE;
BEGIN
  IF session_user <> 'sco_internal_executor' THEN
    RAISE EXCEPTION 'SERVICE_ACCESS_AUTHORIZE_FORBIDDEN';
  END IF;
  UPDATE public.service_access_decisions decision
  SET executed_at = clock_timestamp()
  FROM public.service_access_grants access_grant
  JOIN public.service_entitlements entitlement ON entitlement.id = access_grant.entitlement_id
  WHERE decision.id = p_decision
    AND decision.grant_id = access_grant.id
    AND decision.actor_user_id = p_actor
    AND decision.target_company_id = p_target_company
    AND decision.service_code = p_service_code
    AND decision.purpose_code = 'PUR-02'
    AND decision.operation = 'SERVICE_ACCESS_EXECUTE'
    AND decision.resource_context = p_resource_context
    AND decision.consumed_at IS NOT NULL
    AND decision.consumed_backend_pid = pg_backend_pid()
    AND decision.consumed_transaction_id = txid_current()
    AND decision.executed_at IS NULL
    AND decision.expires_at > clock_timestamp()
    AND access_grant.revoked_at IS NULL
    AND access_grant.expires_at > clock_timestamp()
    AND entitlement.company_id = p_target_company
    AND entitlement.service_code = p_service_code
    AND entitlement.state = 'ACTIVE'
  RETURNING decision.* INTO decision_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_ACCESS_AUTHORIZE_FORBIDDEN';
  END IF;
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (
    p_actor, p_target_company, 'TENANT', 'service_access.authorized', 'ServiceAccessDecision', decision_row.id,
    jsonb_build_object('grantId', decision_row.grant_id, 'serviceCode', p_service_code, 'resourceContext', p_resource_context,
      'trustedScoCompanyId', decision_row.authorization_company_id),
    p_correlation_id, 'PUR-02', 'ALLOWED'
  );
  RETURN decision_row.id;
END
$$;

ALTER FUNCTION public.service_access_trusted_sco_context(UUID, TEXT) OWNER TO sco_service_access_gateway_owner;
ALTER FUNCTION public.internal_service_entitlement_set(UUID, UUID, TEXT, "ServiceEntitlementState") OWNER TO sco_service_access_gateway_owner;
ALTER FUNCTION public.internal_service_access_grant_create(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, UUID) OWNER TO sco_service_access_gateway_owner;
ALTER FUNCTION public.internal_service_access_grant_revoke(UUID, UUID, TEXT, UUID) OWNER TO sco_service_access_gateway_owner;
ALTER FUNCTION public.issue_service_access_decision(UUID, UUID, TEXT, TEXT) OWNER TO sco_service_access_gateway_owner;
ALTER FUNCTION public.consume_service_access_decision(UUID, UUID, UUID, TEXT, TEXT, INTEGER, BIGINT) OWNER TO sco_service_access_gateway_owner;
ALTER FUNCTION public.internal_service_access_authorize(UUID, UUID, TEXT, TEXT, UUID, UUID) OWNER TO sco_service_access_gateway_owner;

REVOKE ALL ON FUNCTION
  public.service_access_trusted_sco_context(UUID, TEXT),
  public.internal_service_entitlement_set(UUID, UUID, TEXT, "ServiceEntitlementState"),
  public.internal_service_access_grant_create(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, UUID),
  public.internal_service_access_grant_revoke(UUID, UUID, TEXT, UUID),
  public.issue_service_access_decision(UUID, UUID, TEXT, TEXT),
  public.consume_service_access_decision(UUID, UUID, UUID, TEXT, TEXT, INTEGER, BIGINT),
  public.internal_service_access_authorize(UUID, UUID, TEXT, TEXT, UUID, UUID)
FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;

GRANT EXECUTE ON FUNCTION
  public.internal_service_entitlement_set(UUID, UUID, TEXT, "ServiceEntitlementState"),
  public.internal_service_access_grant_create(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, UUID),
  public.internal_service_access_grant_revoke(UUID, UUID, TEXT, UUID),
  public.internal_service_access_authorize(UUID, UUID, TEXT, TEXT, UUID, UUID)
TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION
  public.issue_service_access_decision(UUID, UUID, TEXT, TEXT),
  public.consume_service_access_decision(UUID, UUID, UUID, TEXT, TEXT, INTEGER, BIGINT)
TO sco_purpose_authority;
