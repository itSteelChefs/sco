-- Stage 007: a runtime connection cannot self-authorize a purpose by setting a GUC. A separate, least-privilege
-- authority role issues a short-lived, single-use decision; the read gateway consumes it while rechecking identity,
-- tenant and capability. This migration is additive and leaves 0001-0087 unchanged.

INSERT INTO public."Permission"(id, code, description)
VALUES (gen_random_uuid(), 'procurement_document.extract', 'Extract procurement document lines')
ON CONFLICT(code) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_purpose_authority') THEN
    CREATE ROLE sco_purpose_authority LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE sco_purpose_authority LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO sco_purpose_authority', current_database()); END $$;
GRANT USAGE ON SCHEMA public TO sco_purpose_authority;

CREATE TABLE public.partner_verify_purpose_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE CASCADE,
  purpose_code TEXT NOT NULL CHECK (purpose_code = 'PUR-14'),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > issued_at),
  CHECK (expires_at <= issued_at + INTERVAL '60 seconds')
);
ALTER TABLE public.partner_verify_purpose_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_verify_purpose_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_verify_purpose_decisions OWNER TO sco_verify_partner_read_owner;
REVOKE ALL ON TABLE public.partner_verify_purpose_decisions FROM PUBLIC, sco_runtime, sco_purpose_authority;

CREATE OR REPLACE FUNCTION public.issue_partner_verify_read_purpose_decision(p_actor UUID, p_company UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE decision_id UUID;
BEGIN
  IF session_user <> 'sco_purpose_authority' OR NOT public.partner_verify_read_allowed(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_PURPOSE_ISSUE_FORBIDDEN';
  END IF;

  INSERT INTO public.partner_verify_purpose_decisions(actor_user_id, company_id, purpose_code, expires_at)
  VALUES (p_actor, p_company, 'PUR-14', clock_timestamp() + INTERVAL '30 seconds')
  RETURNING id INTO decision_id;
  RETURN decision_id;
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
  BEGIN
    decision_id := NULLIF(current_setting('app.purpose_decision', true), '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN FALSE;
  END;

  IF decision_id IS NULL THEN RETURN FALSE; END IF;

  DELETE FROM public.partner_verify_purpose_decisions
   WHERE id = decision_id
     AND actor_user_id = p_actor
     AND company_id = p_company
     AND purpose_code = 'PUR-14'
     AND expires_at > clock_timestamp();
  RETURN FOUND;
END
$$;

CREATE OR REPLACE FUNCTION public.verify_partner_read_authorized(p_actor UUID, p_company UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN current_setting('app.actor_id', true) = p_actor::TEXT
     AND current_setting('app.tenant_id', true) = p_company::TEXT
     AND public.partner_verify_read_allowed(p_actor, p_company)
     AND public.verify_partner_read_purpose_authorized(p_actor, p_company);
END
$$;

ALTER FUNCTION public.issue_partner_verify_read_purpose_decision(UUID, UUID) OWNER TO sco_verify_partner_read_owner;
ALTER FUNCTION public.verify_partner_read_purpose_authorized(UUID, UUID) OWNER TO sco_verify_partner_read_owner;
ALTER FUNCTION public.verify_partner_read_authorized(UUID, UUID) OWNER TO sco_verify_partner_read_owner;

REVOKE ALL ON FUNCTION public.issue_partner_verify_read_purpose_decision(UUID, UUID), public.verify_partner_read_purpose_authorized(UUID, UUID), public.verify_partner_read_authorized(UUID, UUID) FROM PUBLIC, sco_runtime, sco_purpose_authority;
GRANT EXECUTE ON FUNCTION public.issue_partner_verify_read_purpose_decision(UUID, UUID) TO sco_purpose_authority;