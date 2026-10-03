-- Stage 008-B controlled-reveal mechanics. This registry is deliberately empty:
-- only a future approved forward migration may register an exact operational case.

INSERT INTO public."Permission"(id, code, description)
VALUES (gen_random_uuid(), 'disclosure.reveal.request', 'Request a registered controlled disclosure reveal')
ON CONFLICT(code) DO NOTHING;

CREATE TYPE "DisclosureRevealOperation" AS ENUM ('PRESENT_REAL', 'PRESENT_MINIMIZED');
CREATE TYPE "DisclosureRevealLevel" AS ENUM ('REAL', 'MINIMIZED');

CREATE TABLE public.disclosure_reveal_cases (
  code TEXT PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  purpose_code TEXT NOT NULL CHECK (purpose_code ~ '^PUR-[0-9]{2}$'),
  flow_cpf_id TEXT NOT NULL CHECK (flow_cpf_id ~ '^CPF_[0-9]{2}$'),
  recipient_context "DisclosureRecipientContext" NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  identity_class "DisclosureIdentityClass" NOT NULL,
  operation "DisclosureRevealOperation" NOT NULL,
  disclosure_level "DisclosureRevealLevel" NOT NULL,
  required_permission TEXT NOT NULL REFERENCES public."Permission"(code) ON DELETE RESTRICT,
  max_duration_seconds INTEGER NOT NULL CHECK (max_duration_seconds BETWEEN 1 AND 60),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (operation = 'PRESENT_REAL' AND disclosure_level = 'REAL')
    OR (operation = 'PRESENT_MINIMIZED' AND disclosure_level = 'MINIMIZED')
  )
);

ALTER TABLE public.disclosure_reveal_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disclosure_reveal_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.disclosure_reveal_cases OWNER TO sco_disclosure_gateway_owner;
REVOKE ALL ON TABLE public.disclosure_reveal_cases FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;
CREATE POLICY disclosure_reveal_cases_gateway_owner ON public.disclosure_reveal_cases
  FOR ALL TO sco_disclosure_gateway_owner USING (true) WITH CHECK (true);

CREATE TABLE public.disclosure_reveal_authority_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  owner_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  recipient_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  recipient_context "DisclosureRecipientContext" NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  resource_id UUID NOT NULL,
  identity_class "DisclosureIdentityClass" NOT NULL,
  subject_reference UUID NOT NULL,
  purpose_code TEXT NOT NULL CHECK (purpose_code ~ '^PUR-[0-9]{2}$'),
  flow_cpf_id TEXT NOT NULL CHECK (flow_cpf_id ~ '^CPF_[0-9]{2}$'),
  operation "DisclosureRevealOperation" NOT NULL,
  disclosure_level "DisclosureRevealLevel" NOT NULL,
  required_permission TEXT NOT NULL REFERENCES public."Permission"(code) ON DELETE RESTRICT,
  disclosure_case_code TEXT NOT NULL REFERENCES public.disclosure_reveal_cases(code) ON DELETE RESTRICT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_backend_pid INTEGER,
  consumed_transaction_id BIGINT,
  CHECK (expires_at > issued_at AND expires_at <= issued_at + INTERVAL '60 seconds'),
  CHECK ((consumed_at IS NULL AND consumed_backend_pid IS NULL AND consumed_transaction_id IS NULL)
    OR (consumed_at IS NOT NULL AND consumed_backend_pid IS NOT NULL AND consumed_transaction_id IS NOT NULL))
);

CREATE INDEX disclosure_reveal_authority_scope_idx
  ON public.disclosure_reveal_authority_decisions (
    actor_user_id, owner_company_id, recipient_company_id, recipient_context,
    resource_type, resource_id, identity_class, subject_reference, purpose_code,
    flow_cpf_id, operation, disclosure_level, required_permission, disclosure_case_code
  );
ALTER TABLE public.disclosure_reveal_authority_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disclosure_reveal_authority_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.disclosure_reveal_authority_decisions OWNER TO sco_disclosure_gateway_owner;
REVOKE ALL ON TABLE public.disclosure_reveal_authority_decisions FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;
CREATE POLICY disclosure_reveal_authority_decisions_owner_scope ON public.disclosure_reveal_authority_decisions
  FOR ALL TO sco_disclosure_gateway_owner
  USING (recipient_company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID)
  WITH CHECK (recipient_company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);

CREATE TABLE public.disclosure_reveal_authority_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL REFERENCES public.disclosure_reveal_authority_decisions(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('ISSUED', 'CONSUMED')),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  authorization_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  recipient_context "DisclosureRecipientContext" NOT NULL,
  purpose_code TEXT NOT NULL CHECK (purpose_code ~ '^PUR-[0-9]{2}$'),
  flow_cpf_id TEXT NOT NULL CHECK (flow_cpf_id ~ '^CPF_[0-9]{2}$'),
  operation "DisclosureRevealOperation" NOT NULL,
  disclosure_level "DisclosureRevealLevel" NOT NULL,
  required_permission TEXT NOT NULL REFERENCES public."Permission"(code) ON DELETE RESTRICT,
  disclosure_case_code TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  resource_id UUID NOT NULL,
  identity_class "DisclosureIdentityClass" NOT NULL,
  subject_reference UUID NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.disclosure_reveal_authority_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disclosure_reveal_authority_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.disclosure_reveal_authority_events OWNER TO sco_disclosure_gateway_owner;
REVOKE ALL ON TABLE public.disclosure_reveal_authority_events FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;
CREATE POLICY disclosure_reveal_authority_events_owner_scope ON public.disclosure_reveal_authority_events
  FOR ALL TO sco_disclosure_gateway_owner
  USING (authorization_company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID)
  WITH CHECK (authorization_company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);

CREATE FUNCTION public.disclosure_reveal_request_allowed(p_actor UUID, p_company UUID, p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_company::TEXT, true);
  RETURN EXISTS (
    SELECT 1
    FROM public."CompanyMembership" cm
    JOIN public."User" u ON u.id = cm."userId" AND u.status = 'ACTIVE'
    JOIN public."Company" c ON c.id = cm."companyId" AND c.status = 'ACTIVE'
    JOIN public."MembershipRole" mr ON mr.membership_id = cm.id
    JOIN public."RolePermission" rp ON rp.role_id = mr.role_id
    JOIN public."Permission" permission ON permission.id = rp.permission_id
    WHERE cm."userId" = p_actor
      AND cm."companyId" = p_company
      AND cm.status = 'ACTIVE'
      AND permission.code = p_permission
  );
END
$$;

CREATE FUNCTION public.issue_disclosure_reveal_authority(
  p_actor UUID, p_owner_company UUID, p_recipient_company UUID,
  p_recipient_context "DisclosureRecipientContext", p_resource_type TEXT, p_resource UUID,
  p_identity_class "DisclosureIdentityClass", p_subject_reference UUID, p_purpose_code TEXT,
  p_flow_cpf_id TEXT, p_operation "DisclosureRevealOperation",
  p_disclosure_level "DisclosureRevealLevel", p_disclosure_case_code TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id UUID;
  v_max_duration_seconds INTEGER;
  v_required_permission TEXT;
BEGIN
  IF session_user <> 'sco_purpose_authority' THEN
    RAISE EXCEPTION 'DISCLOSURE_REVEAL_ISSUE_FORBIDDEN';
  END IF;
  PERFORM set_config('app.tenant_id', p_recipient_company::TEXT, true);
  IF NOT EXISTS (
    SELECT 1 FROM public."Company"
    WHERE id = p_owner_company AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_REVEAL_ISSUE_FORBIDDEN';
  END IF;
  SELECT max_duration_seconds, required_permission
    INTO v_max_duration_seconds, v_required_permission
  FROM public.disclosure_reveal_cases
  WHERE code = p_disclosure_case_code
    AND active
    AND purpose_code = p_purpose_code
    AND flow_cpf_id = p_flow_cpf_id
    AND recipient_context = p_recipient_context
    AND resource_type = p_resource_type
    AND identity_class = p_identity_class
    AND operation = p_operation
    AND disclosure_level = p_disclosure_level;
  IF v_max_duration_seconds IS NULL
    OR NOT public.disclosure_reveal_request_allowed(p_actor, p_recipient_company, v_required_permission) THEN
    RAISE EXCEPTION 'DISCLOSURE_REVEAL_ISSUE_FORBIDDEN';
  END IF;
  INSERT INTO public.disclosure_reveal_authority_decisions (
    actor_user_id, owner_company_id, recipient_company_id, recipient_context, resource_type,
    resource_id, identity_class, subject_reference, purpose_code, flow_cpf_id, operation,
    disclosure_level, required_permission, disclosure_case_code, expires_at
  ) VALUES (
    p_actor, p_owner_company, p_recipient_company, p_recipient_context, p_resource_type,
    p_resource, p_identity_class, p_subject_reference, p_purpose_code, p_flow_cpf_id, p_operation,
    p_disclosure_level, v_required_permission, p_disclosure_case_code,
    clock_timestamp() + make_interval(secs => v_max_duration_seconds)
  ) RETURNING id INTO v_id;
  INSERT INTO public.disclosure_reveal_authority_events (
    decision_id, event_type, actor_user_id, authorization_company_id, recipient_context,
    purpose_code, flow_cpf_id, operation, disclosure_level, required_permission,
    disclosure_case_code, resource_type, resource_id, identity_class, subject_reference
  ) VALUES (
    v_id, 'ISSUED', p_actor, p_recipient_company, p_recipient_context,
    p_purpose_code, p_flow_cpf_id, p_operation, p_disclosure_level, v_required_permission,
    p_disclosure_case_code, p_resource_type, p_resource, p_identity_class, p_subject_reference
  );
  RETURN v_id;
END
$$;

CREATE FUNCTION public.consume_disclosure_reveal_authority(
  p_decision UUID, p_actor UUID, p_owner_company UUID, p_recipient_company UUID,
  p_recipient_context "DisclosureRecipientContext", p_resource_type TEXT, p_resource UUID,
  p_identity_class "DisclosureIdentityClass", p_subject_reference UUID, p_purpose_code TEXT,
  p_flow_cpf_id TEXT, p_operation "DisclosureRevealOperation",
  p_disclosure_level "DisclosureRevealLevel", p_disclosure_case_code TEXT,
  p_backend_pid INTEGER, p_transaction_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_required_permission TEXT;
BEGIN
  IF session_user <> 'sco_purpose_authority' OR p_backend_pid <= 0 OR p_transaction_id <= 0 THEN
    RAISE EXCEPTION 'DISCLOSURE_REVEAL_CONSUME_FORBIDDEN';
  END IF;
  PERFORM set_config('app.tenant_id', p_recipient_company::TEXT, true);
  UPDATE public.disclosure_reveal_authority_decisions
     SET consumed_at = clock_timestamp(),
         consumed_backend_pid = p_backend_pid,
         consumed_transaction_id = p_transaction_id
   WHERE id = p_decision
     AND actor_user_id = p_actor
     AND owner_company_id = p_owner_company
     AND recipient_company_id = p_recipient_company
     AND recipient_context = p_recipient_context
     AND resource_type = p_resource_type
     AND resource_id = p_resource
     AND identity_class = p_identity_class
     AND subject_reference = p_subject_reference
     AND purpose_code = p_purpose_code
     AND flow_cpf_id = p_flow_cpf_id
     AND operation = p_operation
     AND disclosure_level = p_disclosure_level
     AND disclosure_case_code = p_disclosure_case_code
     AND consumed_at IS NULL
     AND expires_at > clock_timestamp()
   RETURNING required_permission INTO v_required_permission;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DISCLOSURE_REVEAL_CONSUME_FORBIDDEN';
  END IF;
  INSERT INTO public.disclosure_reveal_authority_events (
    decision_id, event_type, actor_user_id, authorization_company_id, recipient_context,
    purpose_code, flow_cpf_id, operation, disclosure_level, required_permission,
    disclosure_case_code, resource_type, resource_id, identity_class, subject_reference
  ) VALUES (
    p_decision, 'CONSUMED', p_actor, p_recipient_company, p_recipient_context,
    p_purpose_code, p_flow_cpf_id, p_operation, p_disclosure_level, v_required_permission,
    p_disclosure_case_code, p_resource_type, p_resource, p_identity_class, p_subject_reference
  );
END
$$;

CREATE FUNCTION public.disclosure_reveal_authorized(
  p_actor UUID, p_owner_company UUID, p_recipient_company UUID,
  p_recipient_context "DisclosureRecipientContext", p_resource_type TEXT, p_resource UUID,
  p_identity_class "DisclosureIdentityClass", p_subject_reference UUID, p_purpose_code TEXT,
  p_flow_cpf_id TEXT, p_operation "DisclosureRevealOperation",
  p_disclosure_level "DisclosureRevealLevel", p_disclosure_case_code TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_decision UUID;
BEGIN
  BEGIN
    v_decision := NULLIF(current_setting('app.disclosure_reveal_decision', true), '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN FALSE;
  END;
  RETURN v_decision IS NOT NULL
    AND current_setting('app.actor_id', true) = p_actor::TEXT
    AND current_setting('app.tenant_id', true) = p_recipient_company::TEXT
    AND EXISTS (
      SELECT 1
      FROM public.disclosure_reveal_authority_decisions decision
      JOIN public.disclosure_reveal_cases disclosure_case ON disclosure_case.code = decision.disclosure_case_code
      WHERE decision.id = v_decision
        AND decision.actor_user_id = p_actor
        AND decision.owner_company_id = p_owner_company
        AND decision.recipient_company_id = p_recipient_company
        AND decision.recipient_context = p_recipient_context
        AND decision.resource_type = p_resource_type
        AND decision.resource_id = p_resource
        AND decision.identity_class = p_identity_class
        AND decision.subject_reference = p_subject_reference
        AND decision.purpose_code = p_purpose_code
        AND decision.flow_cpf_id = p_flow_cpf_id
        AND decision.operation = p_operation
        AND decision.disclosure_level = p_disclosure_level
        AND decision.disclosure_case_code = p_disclosure_case_code
        AND decision.consumed_at IS NOT NULL
        AND decision.expires_at > clock_timestamp()
        AND decision.consumed_backend_pid = pg_backend_pid()
        AND decision.consumed_transaction_id = txid_current()
        AND disclosure_case.active
        AND disclosure_case.purpose_code = p_purpose_code
        AND disclosure_case.flow_cpf_id = p_flow_cpf_id
        AND disclosure_case.recipient_context = p_recipient_context
        AND disclosure_case.resource_type = p_resource_type
        AND disclosure_case.identity_class = p_identity_class
        AND disclosure_case.operation = p_operation
        AND disclosure_case.disclosure_level = p_disclosure_level
        AND disclosure_case.required_permission = decision.required_permission
    );
END
$$;

ALTER FUNCTION public.disclosure_reveal_request_allowed(UUID, UUID, TEXT) OWNER TO sco_disclosure_gateway_owner;
ALTER FUNCTION public.issue_disclosure_reveal_authority(UUID, UUID, UUID, "DisclosureRecipientContext", TEXT, UUID, "DisclosureIdentityClass", UUID, TEXT, TEXT, "DisclosureRevealOperation", "DisclosureRevealLevel", TEXT) OWNER TO sco_disclosure_gateway_owner;
ALTER FUNCTION public.consume_disclosure_reveal_authority(UUID, UUID, UUID, UUID, "DisclosureRecipientContext", TEXT, UUID, "DisclosureIdentityClass", UUID, TEXT, TEXT, "DisclosureRevealOperation", "DisclosureRevealLevel", TEXT, INTEGER, BIGINT) OWNER TO sco_disclosure_gateway_owner;
ALTER FUNCTION public.disclosure_reveal_authorized(UUID, UUID, UUID, "DisclosureRecipientContext", TEXT, UUID, "DisclosureIdentityClass", UUID, TEXT, TEXT, "DisclosureRevealOperation", "DisclosureRevealLevel", TEXT) OWNER TO sco_disclosure_gateway_owner;
REVOKE ALL ON FUNCTION
  public.disclosure_reveal_request_allowed(UUID, UUID, TEXT),
  public.issue_disclosure_reveal_authority(UUID, UUID, UUID, "DisclosureRecipientContext", TEXT, UUID, "DisclosureIdentityClass", UUID, TEXT, TEXT, "DisclosureRevealOperation", "DisclosureRevealLevel", TEXT),
  public.consume_disclosure_reveal_authority(UUID, UUID, UUID, UUID, "DisclosureRecipientContext", TEXT, UUID, "DisclosureIdentityClass", UUID, TEXT, TEXT, "DisclosureRevealOperation", "DisclosureRevealLevel", TEXT, INTEGER, BIGINT),
  public.disclosure_reveal_authorized(UUID, UUID, UUID, "DisclosureRecipientContext", TEXT, UUID, "DisclosureIdentityClass", UUID, TEXT, TEXT, "DisclosureRevealOperation", "DisclosureRevealLevel", TEXT)
FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;
GRANT EXECUTE ON FUNCTION
  public.issue_disclosure_reveal_authority(UUID, UUID, UUID, "DisclosureRecipientContext", TEXT, UUID, "DisclosureIdentityClass", UUID, TEXT, TEXT, "DisclosureRevealOperation", "DisclosureRevealLevel", TEXT),
  public.consume_disclosure_reveal_authority(UUID, UUID, UUID, UUID, "DisclosureRecipientContext", TEXT, UUID, "DisclosureIdentityClass", UUID, TEXT, TEXT, "DisclosureRevealOperation", "DisclosureRevealLevel", TEXT, INTEGER, BIGINT)
TO sco_purpose_authority;
GRANT EXECUTE ON FUNCTION
  public.disclosure_reveal_authorized(UUID, UUID, UUID, "DisclosureRecipientContext", TEXT, UUID, "DisclosureIdentityClass", UUID, TEXT, TEXT, "DisclosureRevealOperation", "DisclosureRevealLevel", TEXT)
TO sco_runtime;
