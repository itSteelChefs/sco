-- Batch 1-E: Partner-facing Verify Result exposure. Read-only projection of the already-authorized, already-final
-- Verify Result; no Verify methodology/lifecycle change. Mirrors the existing partner_verify_* (Batch 1-C, 0083)
-- two-tier authorization pattern exactly: a *_allowed() capability check plus a *_authorized() actor/tenant GUC
-- cross-check. Unlike the 0083 write-side functions (implicitly owned by the migration/database owner), all three
-- functions here are explicitly owned by a dedicated restricted read-gateway role, per the SR-01/SR-02
-- least-privilege ownership-separation standard (P1-01 remediation). Does not edit or rewrite 0001-0085 history.

INSERT INTO public."Permission"(id, code, description)
VALUES (gen_random_uuid(), 'partner_verify.read', 'Read authorized Partner-facing Verify result')
ON CONFLICT(code) DO NOTHING;

-- P1-01: dedicated restricted owner for the three SECURITY DEFINER functions below. NOLOGIN: nothing connects as
-- this role directly; it exists only to own these functions with the minimum SELECT privilege they require
-- (definer functions execute with the OWNER's privileges, not the caller's). Mirrors the sco_internal_gateway_owner
-- / sco_verify_gateway_owner pattern, but is its own role because reusing sco_verify_gateway_owner would grant
-- this read-only surface the INSERT/UPDATE privileges that role holds for the (unrelated) SYSTEM run/result
-- write path -- more privilege than these three read-only functions require.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_verify_partner_read_owner') THEN
    CREATE ROLE sco_verify_partner_read_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
-- Normalize unconditionally, whether the role is newly created or already existed in some other (possibly unsafe)
-- state: never rely on CREATE ROLE defaults or on an existing role's prior attributes.
ALTER ROLE sco_verify_partner_read_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

REVOKE ALL ON SCHEMA public FROM sco_verify_partner_read_owner;
GRANT USAGE ON SCHEMA public TO sco_verify_partner_read_owner;

-- Strip any pre-existing table-level privileges this role may already hold (e.g. from before this migration ever
-- ran, or from any other prior grant) before granting back only the exact SELECT privileges required below.
-- Scoped to this role only; does not touch any other role's grants.
DO $$
DECLARE grant_record RECORD;
BEGIN
  FOR grant_record IN
    SELECT table_schema, table_name
    FROM information_schema.role_table_grants
    WHERE grantee = 'sco_verify_partner_read_owner'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM sco_verify_partner_read_owner', grant_record.table_schema, grant_record.table_name);
  END LOOP;
END $$;

CREATE FUNCTION public.partner_verify_read_allowed(p_actor UUID, p_company UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public."User" user_record
      JOIN public."CompanyMembership" membership
        ON membership."userId" = user_record.id
       AND membership."companyId" = p_company
       AND membership.status = 'ACTIVE'
      JOIN public."Company" company
        ON company.id = membership."companyId"
       AND company.type = 'PARTNER'
       AND company.status = 'ACTIVE'
      JOIN public."MembershipRole" membership_role ON membership_role.membership_id = membership.id
      JOIN public."RolePermission" role_permission ON role_permission.role_id = membership_role.role_id
      JOIN public."Permission" permission ON permission.id = role_permission.permission_id
     WHERE user_record.id = p_actor
       AND user_record.status = 'ACTIVE'
       AND permission.code = 'partner_verify.read'
  )
$$;

CREATE FUNCTION public.verify_partner_read_authorized(p_actor UUID, p_company UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT current_setting('app.actor_id', true) = p_actor::TEXT
     AND current_setting('app.tenant_id', true) = p_company::TEXT
     AND public.partner_verify_read_allowed(p_actor, p_company)
$$;

-- Final/Authorized Result Rule (section 3): COMPLETED request, its current_submitted_revision_id, a COMPLETED run
-- on that revision, and that run's FINAL (never SUPERSEDED -- supersession flips the prior row's own status away
-- from FINAL) result. Coverage is rebuilt field-by-field from the already-approved per_currency_scopes contract
-- established in 0084 (P1 remediation); no confidence/variance/exclusions JSONB is read or returned. A foreign,
-- not-yet-completed, non-current, or superseded request returns zero rows -- identical response shape to a
-- nonexistent ID, so object-ID possession alone reveals nothing.
--
-- P1-02: the existing approved 1-D lifecycle permits more than one unsuperseded FINAL result to exist for the same
-- current submitted revision (independent retries, each finalized, with no explicit internal_verify_result_supersede
-- call yet reconciling them). "Latest finalised_at wins" would be an invented authorization rule, not an approved
-- one. This function therefore counts eligible candidates first: exactly one -> return it; zero OR more than one ->
-- return zero rows. The zero-row shape is identical in both cases, so ambiguity is never disclosed to the caller.
CREATE FUNCTION public.partner_verify_result_get(p_actor UUID, p_company UUID, p_request UUID)
RETURNS TABLE(
  request_id UUID,
  revision_id UUID,
  run_id UUID,
  result_id UUID,
  status TEXT,
  classification TEXT,
  finalized_at TIMESTAMPTZ,
  coverage JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE candidate_count INT;
BEGIN
  IF NOT public.verify_partner_read_authorized(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_READ_FORBIDDEN';
  END IF;

  SELECT count(*) INTO candidate_count
  FROM public.verify_requests request_record
  JOIN public.verify_quote_revisions revision_record
    ON revision_record.id = request_record.current_submitted_revision_id
   AND revision_record.verify_request_id = request_record.id
  JOIN public.verify_runs run_record
    ON run_record.verify_quote_revision_id = revision_record.id
   AND run_record.status = 'COMPLETED'
  JOIN public.verify_results result_record
    ON result_record.verify_run_id = run_record.id
   AND result_record.status = 'FINAL'
  WHERE request_record.id = p_request
    AND request_record.company_id = p_company
    AND request_record.status = 'COMPLETED';

  IF candidate_count <> 1 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    request_record.id,
    revision_record.id,
    run_record.id,
    result_record.id,
    result_record.status,
    result_record.classification,
    result_record.finalised_at,
    (SELECT jsonb_agg(jsonb_build_object(
        'currency', currency_entry.key,
        'totalLineCount', (currency_entry.value->>'totalLineCount')::int,
        'verifiedLineCount', (currency_entry.value->>'verifiedLineCount')::int,
        'excludedLineCount', (currency_entry.value->>'excludedLineCount')::int,
        'insufficientLineCount', (currency_entry.value->>'insufficientEvidenceLineCount')::int,
        'lineCoveragePercent', (currency_entry.value->>'lineCoveragePercent')::numeric,
        'valueCoveragePercent', (currency_entry.value->>'valueCoveragePercent')::numeric
      ) ORDER BY currency_entry.key)
       FROM jsonb_each(result_record.per_currency_scopes) AS currency_entry)
  FROM public.verify_requests request_record
  JOIN public.verify_quote_revisions revision_record
    ON revision_record.id = request_record.current_submitted_revision_id
   AND revision_record.verify_request_id = request_record.id
  JOIN public.verify_runs run_record
    ON run_record.verify_quote_revision_id = revision_record.id
   AND run_record.status = 'COMPLETED'
  JOIN public.verify_results result_record
    ON result_record.verify_run_id = run_record.id
   AND result_record.status = 'FINAL'
  WHERE request_record.id = p_request
    AND request_record.company_id = p_company
    AND request_record.status = 'COMPLETED';
END
$$;

ALTER FUNCTION public.partner_verify_read_allowed(UUID, UUID) OWNER TO sco_verify_partner_read_owner;
ALTER FUNCTION public.verify_partner_read_authorized(UUID, UUID) OWNER TO sco_verify_partner_read_owner;
ALTER FUNCTION public.partner_verify_result_get(UUID, UUID, UUID) OWNER TO sco_verify_partner_read_owner;

-- Minimum SELECT-only privileges the three functions above actually perform, and only those (re-granted here after
-- the unconditional strip above, so the final effective set is exactly this regardless of prior role state).
-- "User" and "Company" are system-scoped (no RLS, per docs/architecture/tenant-isolation.md); the remaining tables
-- are FORCE RLS and need narrow, tenant-scoped SELECT policies below -- not a blanket cross-tenant USING(true) grant.
GRANT SELECT ON public."User", public."Company", public."Permission" TO sco_verify_partner_read_owner;
GRANT SELECT ON public."CompanyMembership", public."MembershipRole", public."RolePermission" TO sco_verify_partner_read_owner;
GRANT SELECT ON public.verify_requests, public.verify_quote_revisions, public.verify_runs, public.verify_results TO sco_verify_partner_read_owner;

-- Tenant-scoped read policies, structurally identical to the existing sco_runtime tenant policies (0082) for the
-- same tables -- just FOR SELECT rather than FOR ALL, and targeting this role instead of sco_runtime. By the time
-- any of these tables are read, verify_partner_read_authorized has already confirmed app.tenant_id = p_company, so
-- scoping by that same GUC is precise tenant isolation, not a generic cross-tenant policy.
CREATE POLICY company_membership_partner_read_owner_read ON public."CompanyMembership" FOR SELECT TO sco_verify_partner_read_owner
  USING ("companyId" = NULLIF(current_setting('app.tenant_id', true), '')::UUID);
CREATE POLICY membership_role_partner_read_owner_read ON public."MembershipRole" FOR SELECT TO sco_verify_partner_read_owner
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);
CREATE POLICY role_permission_partner_read_owner_read ON public."RolePermission" FOR SELECT TO sco_verify_partner_read_owner
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);
CREATE POLICY verify_requests_partner_read_owner_read ON public.verify_requests FOR SELECT TO sco_verify_partner_read_owner
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);
CREATE POLICY verify_quote_revisions_partner_read_owner_read ON public.verify_quote_revisions FOR SELECT TO sco_verify_partner_read_owner
  USING (EXISTS (SELECT 1 FROM public.verify_requests r WHERE r.id = verify_request_id AND r.company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID));
CREATE POLICY verify_runs_partner_read_owner_read ON public.verify_runs FOR SELECT TO sco_verify_partner_read_owner
  USING (EXISTS (SELECT 1 FROM public.verify_quote_revisions q JOIN public.verify_requests r ON r.id = q.verify_request_id WHERE q.id = verify_quote_revision_id AND r.company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID));
CREATE POLICY verify_results_partner_read_owner_read ON public.verify_results FOR SELECT TO sco_verify_partner_read_owner
  USING (EXISTS (SELECT 1 FROM public.verify_runs run JOIN public.verify_quote_revisions q ON q.id = run.verify_quote_revision_id JOIN public.verify_requests r ON r.id = q.verify_request_id WHERE run.id = verify_run_id AND r.company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID));

REVOKE ALL ON FUNCTION
  public.partner_verify_read_allowed(UUID, UUID),
  public.verify_partner_read_authorized(UUID, UUID),
  public.partner_verify_result_get(UUID, UUID, UUID)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.partner_verify_result_get(UUID, UUID, UUID) TO sco_runtime;
