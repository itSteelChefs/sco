-- A purpose decision is consumed by the authority in its own committed transaction before the runtime gateway
-- executes. Binding it to pg_backend_pid() and txid_current() prevents a runtime caller from replaying a known UUID
-- on another connection or transaction, including after the original business transaction rolls back.
ALTER TABLE public.partner_verify_purpose_decisions
  ADD COLUMN consumed_at TIMESTAMPTZ,
  ADD COLUMN consumed_backend_pid INTEGER,
  ADD COLUMN consumed_transaction_id BIGINT,
  ADD CONSTRAINT partner_verify_purpose_decision_consumption_shape CHECK (
    (consumed_at IS NULL AND consumed_backend_pid IS NULL AND consumed_transaction_id IS NULL)
    OR (consumed_at IS NOT NULL AND consumed_backend_pid IS NOT NULL AND consumed_transaction_id IS NOT NULL)
  );

CREATE INDEX partner_verify_purpose_decisions_expiry_idx
  ON public.partner_verify_purpose_decisions (expires_at)
  WHERE consumed_at IS NULL;

CREATE POLICY partner_verify_purpose_decision_owner_update
ON public.partner_verify_purpose_decisions
FOR UPDATE TO sco_verify_partner_read_owner
USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID)
WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);

DROP POLICY partner_verify_purpose_decision_owner_delete ON public.partner_verify_purpose_decisions;
CREATE POLICY partner_verify_purpose_decision_owner_delete_expired
ON public.partner_verify_purpose_decisions
FOR DELETE TO sco_verify_partner_read_owner
USING (
  expires_at <= clock_timestamp()
  OR company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
);

CREATE OR REPLACE FUNCTION public.cleanup_expired_partner_verify_purpose_decisions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE deleted_count INTEGER;
BEGIN
  IF session_user <> 'sco_purpose_authority' THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_PURPOSE_CLEANUP_FORBIDDEN';
  END IF;

  WITH expired AS (
    SELECT id
    FROM public.partner_verify_purpose_decisions
    WHERE expires_at <= clock_timestamp()
    ORDER BY expires_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.partner_verify_purpose_decisions decision
    USING expired
    WHERE decision.id = expired.id
    RETURNING 1
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
  PERFORM public.cleanup_expired_partner_verify_purpose_decisions();
  PERFORM set_config('app.tenant_id', p_company::TEXT, true);
  IF NOT public.partner_verify_read_allowed(p_actor, p_company) THEN RAISE EXCEPTION 'PARTNER_VERIFY_PURPOSE_ISSUE_FORBIDDEN'; END IF;
  INSERT INTO public.partner_verify_purpose_decisions(actor_user_id, company_id, purpose_code, expires_at)
  VALUES (p_actor, p_company, 'PUR-14', clock_timestamp() + INTERVAL '30 seconds')
  RETURNING id INTO decision_id;
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
  IF session_user <> 'sco_purpose_authority' OR p_backend_pid <= 0 OR p_transaction_id <= 0 THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_PURPOSE_CONSUME_FORBIDDEN';
  END IF;
  PERFORM public.cleanup_expired_partner_verify_purpose_decisions();
  PERFORM set_config('app.tenant_id', p_company::TEXT, true);
  UPDATE public.partner_verify_purpose_decisions
     SET consumed_at = clock_timestamp(), consumed_backend_pid = p_backend_pid, consumed_transaction_id = p_transaction_id
   WHERE id = p_decision
     AND actor_user_id = p_actor
     AND company_id = p_company
     AND purpose_code = 'PUR-14'
     AND consumed_at IS NULL
     AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'PARTNER_VERIFY_PURPOSE_CONSUME_FORBIDDEN'; END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.verify_partner_read_purpose_authorized(p_actor UUID, p_company UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE decision_id UUID;
BEGIN
  BEGIN decision_id := NULLIF(current_setting('app.purpose_decision', true), '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN RETURN FALSE;
  END;
  RETURN decision_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.partner_verify_purpose_decisions
    WHERE id = decision_id AND actor_user_id = p_actor AND company_id = p_company AND purpose_code = 'PUR-14'
      AND consumed_at IS NOT NULL AND expires_at > clock_timestamp()
      AND consumed_backend_pid = pg_backend_pid() AND consumed_transaction_id = txid_current()
  );
END
$$;

ALTER FUNCTION public.cleanup_expired_partner_verify_purpose_decisions() OWNER TO sco_verify_partner_read_owner;
ALTER FUNCTION public.issue_partner_verify_read_purpose_decision(UUID, UUID) OWNER TO sco_verify_partner_read_owner;
ALTER FUNCTION public.consume_partner_verify_read_purpose_decision(UUID, UUID, UUID, INTEGER, BIGINT) OWNER TO sco_verify_partner_read_owner;
ALTER FUNCTION public.verify_partner_read_purpose_authorized(UUID, UUID) OWNER TO sco_verify_partner_read_owner;
REVOKE ALL ON FUNCTION public.cleanup_expired_partner_verify_purpose_decisions(), public.issue_partner_verify_read_purpose_decision(UUID, UUID), public.consume_partner_verify_read_purpose_decision(UUID, UUID, UUID, INTEGER, BIGINT), public.verify_partner_read_purpose_authorized(UUID, UUID) FROM PUBLIC, sco_runtime, sco_purpose_authority;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_partner_verify_purpose_decisions(), public.issue_partner_verify_read_purpose_decision(UUID, UUID), public.consume_partner_verify_read_purpose_decision(UUID, UUID, UUID, INTEGER, BIGINT) TO sco_purpose_authority;