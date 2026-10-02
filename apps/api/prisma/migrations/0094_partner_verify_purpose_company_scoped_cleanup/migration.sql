CREATE OR REPLACE FUNCTION public.cleanup_expired_partner_verify_purpose_decisions(p_company UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE deleted_count INTEGER;
BEGIN
  IF session_user <> 'sco_purpose_authority' THEN RAISE EXCEPTION 'PARTNER_VERIFY_PURPOSE_CLEANUP_FORBIDDEN'; END IF;
  PERFORM set_config('app.tenant_id', p_company::TEXT, true);
  WITH expired AS (
    SELECT id FROM public.partner_verify_purpose_decisions
    WHERE company_id = p_company AND expires_at <= clock_timestamp()
    ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.partner_verify_purpose_decisions decision
    USING expired WHERE decision.id = expired.id RETURNING 1
  ) SELECT count(*) INTO deleted_count FROM deleted;
  RETURN deleted_count;
END
$$;

CREATE OR REPLACE FUNCTION public.issue_partner_verify_read_purpose_decision(p_actor UUID, p_company UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE decision_id UUID;
BEGIN
  IF session_user <> 'sco_purpose_authority' THEN RAISE EXCEPTION 'PARTNER_VERIFY_PURPOSE_ISSUE_FORBIDDEN'; END IF;
  PERFORM set_config('app.tenant_id', p_company::TEXT, true);
  PERFORM public.cleanup_expired_partner_verify_purpose_decisions(p_company);
  IF NOT public.partner_verify_read_allowed(p_actor, p_company) THEN RAISE EXCEPTION 'PARTNER_VERIFY_PURPOSE_ISSUE_FORBIDDEN'; END IF;
  INSERT INTO public.partner_verify_purpose_decisions(actor_user_id, company_id, purpose_code, expires_at)
  VALUES (p_actor, p_company, 'PUR-14', clock_timestamp() + INTERVAL '30 seconds') RETURNING id INTO decision_id;
  RETURN decision_id;
END
$$;

CREATE OR REPLACE FUNCTION public.consume_partner_verify_read_purpose_decision(p_decision UUID, p_actor UUID, p_company UUID, p_backend_pid INTEGER, p_transaction_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF session_user <> 'sco_purpose_authority' OR p_backend_pid <= 0 OR p_transaction_id <= 0 THEN RAISE EXCEPTION 'PARTNER_VERIFY_PURPOSE_CONSUME_FORBIDDEN'; END IF;
  PERFORM set_config('app.tenant_id', p_company::TEXT, true);
  PERFORM public.cleanup_expired_partner_verify_purpose_decisions(p_company);
  UPDATE public.partner_verify_purpose_decisions
     SET consumed_at = clock_timestamp(), consumed_backend_pid = p_backend_pid, consumed_transaction_id = p_transaction_id
   WHERE id = p_decision AND actor_user_id = p_actor AND company_id = p_company AND purpose_code = 'PUR-14'
     AND consumed_at IS NULL AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'PARTNER_VERIFY_PURPOSE_CONSUME_FORBIDDEN'; END IF;
END
$$;

ALTER FUNCTION public.cleanup_expired_partner_verify_purpose_decisions(UUID) OWNER TO sco_verify_partner_read_owner;
ALTER FUNCTION public.issue_partner_verify_read_purpose_decision(UUID, UUID) OWNER TO sco_verify_partner_read_owner;
ALTER FUNCTION public.consume_partner_verify_read_purpose_decision(UUID, UUID, UUID, INTEGER, BIGINT) OWNER TO sco_verify_partner_read_owner;
REVOKE ALL ON FUNCTION public.cleanup_expired_partner_verify_purpose_decisions(UUID) FROM PUBLIC, sco_runtime, sco_purpose_authority;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_partner_verify_purpose_decisions(UUID) TO sco_purpose_authority;
REVOKE ALL ON FUNCTION public.cleanup_expired_partner_verify_purpose_decisions() FROM sco_purpose_authority;