-- H2 security hardening.
--
-- SH-02: the application runtime role could INSERT into "Role", "RolePermission" and "MembershipRole" (granted in 0004
-- with a tenant-only ALL policy). Any runtime SQL path could therefore mint a role carrying any global permission and
-- attach it to the caller's own membership. Nothing in the application writes these tables at runtime (provisioning is
-- an owner/SCO-controlled operation), so the privilege is removed rather than constrained. The write-capable tenant
-- policies are replaced by read-only ones so that a future accidental GRANT still cannot open a write path.
--
-- SH-01A / SH-01B: procurement_needs.product_candidate_id and procurement_document_lines.product_candidate_id referenced
-- product_candidates without any company binding. Foreign-key checks bypass RLS, so a SECURITY DEFINER gateway
-- (internal_procurement_need_create) or any other writer could attach another company's (or a company-less SCO-internal)
-- candidate to a tenant-owned row. Dedicated triggers now bind the candidate to the owning company for every writer and
-- every path, and answer identically for foreign, company-less and non-existent candidates (no existence oracle).
-- One least-privilege, read-only helper role validates both tables.

-- SH-02 ---------------------------------------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public."Role", public."MembershipRole", public."RolePermission" FROM sco_runtime;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public."Role", public."MembershipRole", public."RolePermission" FROM PUBLIC;

DROP POLICY role_tenant ON public."Role";
DROP POLICY membership_role_tenant ON public."MembershipRole";
DROP POLICY role_permission_tenant ON public."RolePermission";

CREATE POLICY role_tenant_read ON public."Role" FOR SELECT TO sco_runtime
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY membership_role_tenant_read ON public."MembershipRole" FOR SELECT TO sco_runtime
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY role_permission_tenant_read ON public."RolePermission" FOR SELECT TO sco_runtime
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
DECLARE table_name TEXT; privilege TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Role', 'MembershipRole', 'RolePermission'] LOOP
    FOREACH privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      IF has_table_privilege('sco_runtime', format('public.%I', table_name), privilege) THEN
        RAISE EXCEPTION 'SH-02: sco_runtime must not hold % on %', privilege, table_name;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- SH-01 ---------------------------------------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_candidate_integrity_owner') THEN
    CREATE ROLE sco_candidate_integrity_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE sco_candidate_integrity_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE ALL ON SCHEMA public FROM sco_candidate_integrity_owner;
GRANT USAGE ON SCHEMA public TO sco_candidate_integrity_owner;
GRANT SELECT (id, company_id) ON public.product_candidates TO sco_candidate_integrity_owner;
CREATE POLICY product_candidates_integrity_read ON public.product_candidates
  FOR SELECT TO sco_candidate_integrity_owner USING (true);
-- Parent-document ownership, read only to cross-check a line's own company_id.
GRANT SELECT (id, company_id) ON public.procurement_documents TO sco_candidate_integrity_owner;
CREATE POLICY procurement_documents_candidate_integrity_read ON public.procurement_documents
  FOR SELECT TO sco_candidate_integrity_owner USING (true);

CREATE FUNCTION public.procurement_need_candidate_company_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- A foreign, SCO-internal (company-less) or non-existent candidate is indistinguishable by design.
  IF NEW.product_candidate_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_candidates candidate
     WHERE candidate.id = NEW.product_candidate_id AND candidate.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'PROCUREMENT_NEED_CANDIDATE_COMPANY_MISMATCH';
  END IF;
  RETURN NEW;
END
$$;

ALTER FUNCTION public.procurement_need_candidate_company_validate() OWNER TO sco_candidate_integrity_owner;
REVOKE ALL ON FUNCTION public.procurement_need_candidate_company_validate() FROM PUBLIC;

CREATE TRIGGER procurement_need_candidate_company_validate_trigger
BEFORE INSERT OR UPDATE OF product_candidate_id, company_id ON public.procurement_needs
FOR EACH ROW WHEN (NEW.product_candidate_id IS NOT NULL)
EXECUTE FUNCTION public.procurement_need_candidate_company_validate();

-- SH-01B. Ownership of a line is its own company_id (the tenant key enforced by RLS WITH CHECK). The parent document
-- must agree, so a line cannot straddle two companies while carrying a candidate.
CREATE FUNCTION public.procurement_document_line_candidate_company_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.product_candidate_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.product_candidates candidate
      JOIN public.procurement_documents document ON document.company_id = candidate.company_id
     WHERE candidate.id = NEW.product_candidate_id
       AND candidate.company_id = NEW.company_id
       AND document.id = NEW.document_id
  ) THEN
    RAISE EXCEPTION 'PROCUREMENT_DOCUMENT_LINE_CANDIDATE_COMPANY_MISMATCH';
  END IF;
  RETURN NEW;
END
$$;

ALTER FUNCTION public.procurement_document_line_candidate_company_validate() OWNER TO sco_candidate_integrity_owner;
REVOKE ALL ON FUNCTION public.procurement_document_line_candidate_company_validate() FROM PUBLIC;

CREATE TRIGGER procurement_document_line_candidate_company_validate_trigger
BEFORE INSERT OR UPDATE OF product_candidate_id, company_id, document_id ON public.procurement_document_lines
FOR EACH ROW WHEN (NEW.product_candidate_id IS NOT NULL)
EXECUTE FUNCTION public.procurement_document_line_candidate_company_validate();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE grantee = 'sco_candidate_integrity_owner' AND privilege_type <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'SH-01: sco_candidate_integrity_owner must be read-only';
  END IF;
END $$;
