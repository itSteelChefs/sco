-- Stage 007 correction: issuer capability validation must establish the same tenant scope used by the existing
-- RLS-protected partner_verify_read_allowed gateway. The setting is transaction-local and never caller supplied.
CREATE OR REPLACE FUNCTION public.issue_partner_verify_read_purpose_decision(p_actor UUID, p_company UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE decision_id UUID;
BEGIN
  IF session_user <> 'sco_purpose_authority' THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_PURPOSE_ISSUE_FORBIDDEN';
  END IF;

  PERFORM set_config('app.tenant_id', p_company::TEXT, true);
  IF NOT public.partner_verify_read_allowed(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_PURPOSE_ISSUE_FORBIDDEN';
  END IF;

  INSERT INTO public.partner_verify_purpose_decisions(actor_user_id, company_id, purpose_code, expires_at)
  VALUES (p_actor, p_company, 'PUR-14', clock_timestamp() + INTERVAL '30 seconds')
  RETURNING id INTO decision_id;
  RETURN decision_id;
END
$$;
ALTER FUNCTION public.issue_partner_verify_read_purpose_decision(UUID, UUID) OWNER TO sco_verify_partner_read_owner;
REVOKE ALL ON FUNCTION public.issue_partner_verify_read_purpose_decision(UUID, UUID) FROM PUBLIC, sco_runtime, sco_purpose_authority;
GRANT EXECUTE ON FUNCTION public.issue_partner_verify_read_purpose_decision(UUID, UUID) TO sco_purpose_authority;