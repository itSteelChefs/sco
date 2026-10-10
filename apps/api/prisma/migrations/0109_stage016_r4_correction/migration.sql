-- Stage016 R4 correction: close FORCE RLS, tenant authority, status, and concurrency gaps.
CREATE POLICY partner_provision_membership_owner_read ON public."CompanyMembership"
  FOR SELECT TO sco_partner_provisioning_gateway_owner USING (true);
CREATE POLICY partner_provision_membership_owner_insert ON public."CompanyMembership"
  FOR INSERT TO sco_partner_provisioning_gateway_owner WITH CHECK (true);
CREATE POLICY partner_provision_membership_role_owner_read ON public."MembershipRole"
  FOR SELECT TO sco_partner_provisioning_gateway_owner USING (true);
CREATE POLICY partner_provision_role_permission_owner_read ON public."RolePermission"
  FOR SELECT TO sco_partner_provisioning_gateway_owner USING (true);
GRANT REFERENCES ON public."User", public."Company", public."CompanyMembership"
  TO sco_partner_provisioning_gateway_owner;

CREATE FUNCTION public.internal_partner_provision_authority(p_actor UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  authority_count INTEGER;
  authority_company UUID;
BEGIN
  IF session_user <> 'sco_internal_executor' THEN
    RAISE EXCEPTION 'PARTNER_PROVISION_FORBIDDEN';
  END IF;
  SELECT count(DISTINCT cm."companyId")::INTEGER, (array_agg(DISTINCT cm."companyId"))[1]
    INTO authority_count, authority_company
  FROM public."CompanyMembership" cm
  JOIN public."Company" c ON c.id = cm."companyId"
  JOIN public."MembershipRole" mr ON mr.membership_id = cm.id AND mr.company_id = cm."companyId"
  JOIN public."RolePermission" rp ON rp.role_id = mr.role_id AND rp.company_id = cm."companyId"
  JOIN public."Permission" p ON p.id = rp.permission_id
  JOIN public."User" u ON u.id = cm."userId"
  WHERE cm."userId" = p_actor AND cm.status = 'ACTIVE' AND u.status = 'ACTIVE'
    AND c.type = 'SCO' AND c.status = 'ACTIVE' AND p.code = 'partner.provision.manage';
  IF authority_count <> 1 THEN RAISE EXCEPTION 'PARTNER_PROVISION_AUTHORITY_FORBIDDEN'; END IF;
  RETURN authority_company;
END;
$$;
ALTER FUNCTION public.internal_partner_provision_authority(UUID) OWNER TO sco_partner_provisioning_gateway_owner;
REVOKE ALL ON FUNCTION public.internal_partner_provision_authority(UUID) FROM PUBLIC, sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_partner_provision_authority(UUID) TO sco_internal_executor;

DROP FUNCTION public.internal_partner_membership_provision(UUID, UUID, TEXT, UUID);

CREATE FUNCTION public.internal_partner_membership_provision(p_user UUID, p_company UUID, p_key TEXT)
RETURNS TABLE(operation_id UUID, membership_id UUID, user_id UUID, company_id UUID, membership_status TEXT, outcome TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor_id UUID; tenant_id UUID; authority_company UUID; membership UUID;
  membership_state TEXT; operation_outcome TEXT; fingerprint TEXT;
  operation_record RECORD; operation_result UUID;
BEGIN
  IF session_user <> 'sco_internal_executor' THEN RAISE EXCEPTION 'PARTNER_PROVISION_FORBIDDEN'; END IF;
  BEGIN
    actor_id := NULLIF(current_setting('app.actor_id', true), '')::UUID;
    tenant_id := NULLIF(current_setting('app.tenant_id', true), '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'PARTNER_PROVISION_FORBIDDEN'; END;
  IF actor_id IS NULL OR tenant_id IS NULL THEN RAISE EXCEPTION 'PARTNER_PROVISION_FORBIDDEN'; END IF;

  authority_company := public.internal_partner_provision_authority(actor_id);
  IF tenant_id <> authority_company THEN RAISE EXCEPTION 'PARTNER_PROVISION_FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."User" WHERE id = p_user AND status = 'ACTIVE')
    THEN RAISE EXCEPTION 'PARTNER_PROVISION_TARGET_USER_INVALID'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."Company" WHERE id = p_company AND status = 'ACTIVE' AND type = 'PARTNER')
    THEN RAISE EXCEPTION 'PARTNER_PROVISION_TARGET_COMPANY_INVALID'; END IF;
  IF length(btrim(p_key)) < 1 OR length(btrim(p_key)) > 128
    THEN RAISE EXCEPTION 'PARTNER_PROVISIONING_INPUT_INVALID'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(actor_id::TEXT || ':' || authority_company::TEXT || ':' || btrim(p_key), 0));
  fingerprint := md5(p_user::TEXT || '|' || p_company::TEXT);
  SELECT * INTO operation_record FROM public.partner_membership_provision_operations
  WHERE authority_company_id = authority_company AND actor_user_id = actor_id AND operation_key = btrim(p_key)
  FOR UPDATE;
  IF FOUND THEN
    IF operation_record.target_user_id <> p_user OR operation_record.target_company_id <> p_company
      OR operation_record.payload_fingerprint <> fingerprint
      THEN RAISE EXCEPTION 'PARTNER_PROVISION_IDEMPOTENCY_CONFLICT'; END IF;
    SELECT cm.status::TEXT INTO membership_state FROM public."CompanyMembership" cm
      WHERE cm.id = operation_record.membership_id;
    IF membership_state IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'PARTNER_PROVISION_MEMBERSHIP_INACTIVE'; END IF;
    RETURN QUERY SELECT operation_record.id, operation_record.membership_id, operation_record.target_user_id,
      operation_record.target_company_id, membership_state, 'REPLAYED'::TEXT;
    RETURN;
  END IF;

  SELECT cm.id, cm.status::TEXT INTO membership, membership_state FROM public."CompanyMembership" cm
    WHERE cm."userId" = p_user AND cm."companyId" = p_company;
  IF FOUND AND membership_state IS DISTINCT FROM 'ACTIVE'
    THEN RAISE EXCEPTION 'PARTNER_PROVISION_MEMBERSHIP_INACTIVE'; END IF;
  IF FOUND THEN
    operation_outcome := 'ALREADY_EXISTS';
  ELSE
    INSERT INTO public."CompanyMembership"("userId", "companyId", status)
      VALUES (p_user, p_company, 'ACTIVE')
      ON CONFLICT ("userId", "companyId") DO NOTHING RETURNING id INTO membership;
    IF membership IS NULL THEN
      SELECT cm.id, cm.status::TEXT INTO membership, membership_state FROM public."CompanyMembership" cm
        WHERE cm."userId" = p_user AND cm."companyId" = p_company;
      IF membership_state IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'PARTNER_PROVISION_MEMBERSHIP_INACTIVE'; END IF;
      operation_outcome := 'ALREADY_EXISTS';
    ELSE
      membership_state := 'ACTIVE'; operation_outcome := 'CREATED';
    END IF;
  END IF;

  INSERT INTO public.partner_membership_provision_operations(
    actor_user_id, authority_company_id, operation_key, target_user_id, target_company_id,
    payload_fingerprint, outcome, membership_id
  ) VALUES (actor_id, authority_company, btrim(p_key), p_user, p_company, fingerprint, operation_outcome, membership)
  RETURNING id INTO operation_result;
  RETURN QUERY SELECT operation_result, membership, p_user, p_company, membership_state, operation_outcome;
END;
$$;
ALTER FUNCTION public.internal_partner_membership_provision(UUID, UUID, TEXT) OWNER TO sco_partner_provisioning_gateway_owner;
REVOKE ALL ON FUNCTION public.internal_partner_membership_provision(UUID, UUID, TEXT) FROM PUBLIC, sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_partner_membership_provision(UUID, UUID, TEXT) TO sco_internal_executor;

-- operationKey is the sole public correlation/idempotency input; it is audited as metadata.
CREATE OR REPLACE FUNCTION public.partner_membership_provision_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata)
  VALUES (NEW.actor_user_id, 'SCO_INTERNAL', 'partner.membership.provisioned', 'CompanyMembership', NEW.membership_id,
    jsonb_build_object('authorityCompanyId', NEW.authority_company_id, 'targetUserId', NEW.target_user_id,
      'targetCompanyId', NEW.target_company_id, 'operationKey', NEW.operation_key, 'outcome', NEW.outcome));
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.partner_membership_provision_audit() OWNER TO sco_partner_provisioning_gateway_owner;
REVOKE EXECUTE ON FUNCTION public.partner_membership_provision_audit() FROM PUBLIC;
