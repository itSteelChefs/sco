-- H5: tighten the existing Partner agreement acceptance authority without
-- changing the historical 0102 schema or its public function signature.

CREATE OR REPLACE FUNCTION public.partner_agreement_accept(
  p_agreement_type TEXT, p_version_code TEXT, p_idempotency_key TEXT, p_correlation_id UUID
)
RETURNS TABLE(agreement_type TEXT, version_code TEXT, accepted_at TIMESTAMPTZ, acceptance_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor UUID := NULLIF(current_setting('app.actor_id', true), '');
        company UUID := NULLIF(current_setting('app.tenant_id', true), '');
        requested_policy public.partner_agreement_policy_versions%ROWTYPE;
        policy public.partner_agreement_policy_versions%ROWTYPE;
        acceptance public.partner_agreement_acceptances%ROWTYPE;
        v_membership_id UUID;
        fingerprint TEXT;
        permission_code TEXT;
        latest_status TEXT;
        authority_basis_snapshot JSONB;
        correlation UUID := COALESCE(p_correlation_id, gen_random_uuid());
BEGIN
  IF actor IS NULL OR company IS NULL THEN
    RAISE EXCEPTION 'PARTNER_AGREEMENT_ACCEPT_FORBIDDEN';
  END IF;
  IF btrim(COALESCE(p_agreement_type, '')) = ''
     OR btrim(COALESCE(p_version_code, '')) = ''
     OR btrim(COALESCE(p_idempotency_key, '')) = '' THEN
    RAISE EXCEPTION 'AGREEMENT_ACCEPTANCE_INPUT_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('partner_agreement_policy', 1202));
  PERFORM pg_advisory_xact_lock(hashtextextended(company::TEXT || ':' || actor::TEXT || ':' || p_idempotency_key, 1202));

  SELECT membership.id INTO v_membership_id
    FROM public."CompanyMembership" membership
    JOIN public."Company" company_row ON company_row.id = membership."companyId"
    JOIN public."User" actor_row ON actor_row.id = membership."userId"
   WHERE membership."userId" = actor
     AND membership."companyId" = company
     AND membership.status = 'ACTIVE'
     AND actor_row.status = 'ACTIVE'
     AND company_row.status = 'ACTIVE'
     AND company_row.type = 'PARTNER';
  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION 'PARTNER_AGREEMENT_ACCEPT_FORBIDDEN';
  END IF;

  IF NOT public.admission_actor_has_permission(actor, company, 'partner.agreement.accept') THEN
    RAISE EXCEPTION 'AGREEMENT_ACCEPTANCE_AUTHORITY_FORBIDDEN';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.company_partnerships partnership
      JOIN public.qualification_applications qualification
        ON qualification.id = partnership.qualification_application_id
     WHERE partnership.company_id = company
       AND partnership.type = 'BUYER_PARTNERSHIP'
       AND partnership.status IN ('UNDER_REVIEW', 'APPROVED', 'ACTIVE')
       AND qualification.company_id = company
       AND qualification.status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'AGREEMENT_ACCEPTANCE_AUTHORITY_FORBIDDEN';
  END IF;

  SELECT * INTO requested_policy
    FROM public.partner_agreement_policy_versions policy_row
   WHERE policy_row.agreement_type = p_agreement_type
     AND policy_row.version_code = p_version_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AGREEMENT_VERSION_NOT_CURRENT';
  END IF;
  fingerprint := encode(digest(convert_to(requested_policy.agreement_type || E'\n' || requested_policy.version_code || E'\n' || requested_policy.content_sha256, 'UTF8'), 'sha256'), 'hex');

  SELECT * INTO acceptance
    FROM public.partner_agreement_acceptances existing
   WHERE existing.company_id = company
     AND existing.actor_user_id = actor
     AND existing.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF acceptance.request_fingerprint <> fingerprint THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH';
    END IF;
    RETURN QUERY SELECT acceptance.agreement_type, acceptance.version_code, acceptance.accepted_at, 'ACCEPTED'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO policy
    FROM public.partner_agreement_policy_versions policy_row
   WHERE policy_row.agreement_type = p_agreement_type
     AND policy_row.version_code = p_version_code
     AND policy_row.required = true
     AND policy_row.state = 'PUBLISHED'
     AND policy_row.effective_at <= clock_timestamp()
     AND (policy_row.superseded_at IS NULL OR policy_row.superseded_at > clock_timestamp())
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AGREEMENT_VERSION_NOT_CURRENT';
  END IF;
  IF NOT public.admission_actor_has_permission(actor, company, policy.acceptance_permission_code) THEN
    RAISE EXCEPTION 'AGREEMENT_ACCEPTANCE_AUTHORITY_FORBIDDEN';
  END IF;

  SELECT existing.* INTO acceptance
    FROM public.partner_agreement_acceptances existing
    JOIN LATERAL (
      SELECT event.status
        FROM public.partner_agreement_acceptance_events event
       WHERE event.acceptance_id = existing.id
       ORDER BY event.created_at DESC, event.id DESC
       LIMIT 1
    ) event ON event.status IN ('ACCEPTED', 'SUPERSEDED', 'HISTORICALLY_RETAINED')
   WHERE existing.company_id = company
     AND existing.agreement_type = policy.agreement_type
     AND existing.policy_version_id = policy.id
   ORDER BY existing.accepted_at DESC, existing.id DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT acceptance.agreement_type, acceptance.version_code, acceptance.accepted_at, 'ACCEPTED'::TEXT;
    RETURN;
  END IF;

  SELECT jsonb_build_object(
    'membershipId', v_membership_id,
    'requiredPermissions', to_jsonb(ARRAY['partner.agreement.accept', policy.acceptance_permission_code]),
    'grantedRoles', COALESCE(jsonb_agg(DISTINCT jsonb_build_object('roleId', role.id, 'roleCode', role.code, 'roleName', role.name)), '[]'::jsonb)
  ) INTO authority_basis_snapshot
  FROM public."MembershipRole" membership_role
  JOIN public."Role" role ON role.id = membership_role.role_id AND role.company_id = company
  JOIN public."RolePermission" role_permission ON role_permission.role_id = role.id AND role_permission.company_id = company
  JOIN public."Permission" permission ON permission.id = role_permission.permission_id
  WHERE membership_role.membership_id = v_membership_id
    AND membership_role.company_id = company
    AND permission.code IN ('partner.agreement.accept', policy.acceptance_permission_code);

  INSERT INTO public.partner_agreement_acceptances (
    company_id, actor_user_id, membership_id, policy_version_id, agreement_type, version_code,
    accepted_content_sha256, authority_permission_code, authority_basis, purpose_code, idempotency_key,
    request_fingerprint, correlation_id
  ) VALUES (
    company, actor, v_membership_id, policy.id, policy.agreement_type, policy.version_code,
    policy.content_sha256, policy.acceptance_permission_code, authority_basis_snapshot, 'PUR-02', p_idempotency_key,
    fingerprint, correlation
  ) RETURNING * INTO acceptance;

  INSERT INTO public.partner_agreement_acceptance_events (
    acceptance_id, company_id, status, actor_user_id, reason, correlation_id
  ) VALUES (acceptance.id, company, 'ACCEPTED', actor, 'PARTNER_ACCEPTED_CURRENT_VERSION', correlation);
  INSERT INTO public.audit_logs (
    actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
  ) VALUES (
    actor, company, 'TENANT', 'agreement.accepted', 'PartnerAgreementAcceptance', acceptance.id,
    jsonb_build_object('agreementType', policy.agreement_type, 'versionCode', policy.version_code, 'contentSha256', policy.content_sha256),
    correlation, 'PUR-02', 'ALLOWED'
  );
  RETURN QUERY SELECT acceptance.agreement_type, acceptance.version_code, acceptance.accepted_at, 'ACCEPTED'::TEXT;
END $$;

ALTER FUNCTION public.partner_agreement_accept(TEXT, TEXT, TEXT, UUID) OWNER TO sco_partner_admission_gateway_owner;
REVOKE ALL ON FUNCTION public.partner_agreement_accept(TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_agreement_accept(TEXT, TEXT, TEXT, UUID) TO sco_runtime;
