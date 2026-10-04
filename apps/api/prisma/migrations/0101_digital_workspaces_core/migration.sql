DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_workspace_gateway_owner') THEN
    CREATE ROLE sco_workspace_gateway_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE sco_workspace_gateway_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE ALL ON SCHEMA public FROM sco_workspace_gateway_owner;
GRANT USAGE ON SCHEMA public TO sco_workspace_gateway_owner;

CREATE TABLE public.partner_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL CHECK (btrim(display_name) <> ''),
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'ARCHIVED')),
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (company_id)
);

CREATE TABLE public.partner_workspace_project_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.partner_workspaces(id) ON DELETE RESTRICT,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, project_id)
);

CREATE TABLE public.partner_workspace_document_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.partner_workspaces(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, document_id)
);

CREATE INDEX partner_workspace_project_links_company_idx ON public.partner_workspace_project_links(company_id);
CREATE INDEX partner_workspace_document_references_company_idx ON public.partner_workspace_document_references(company_id);

GRANT SELECT ON public."Company", public."CompanyMembership", public."MembershipRole", public."RolePermission", public."Permission",
  public.projects, public.documents, public.service_entitlements TO sco_workspace_gateway_owner;
CREATE POLICY workspace_gateway_company_read ON public."Company"
  FOR SELECT TO sco_workspace_gateway_owner USING (true);
CREATE POLICY workspace_gateway_membership_read ON public."CompanyMembership"
  FOR SELECT TO sco_workspace_gateway_owner USING (true);
CREATE POLICY workspace_gateway_membership_role_read ON public."MembershipRole"
  FOR SELECT TO sco_workspace_gateway_owner USING (true);
CREATE POLICY workspace_gateway_role_permission_read ON public."RolePermission"
  FOR SELECT TO sco_workspace_gateway_owner USING (true);
CREATE POLICY workspace_gateway_permission_read ON public."Permission"
  FOR SELECT TO sco_workspace_gateway_owner USING (true);
CREATE POLICY workspace_gateway_projects_read ON public.projects
  FOR SELECT TO sco_workspace_gateway_owner USING (true);
CREATE POLICY workspace_gateway_documents_read ON public.documents
  FOR SELECT TO sco_workspace_gateway_owner USING (true);
CREATE POLICY workspace_gateway_entitlements_read ON public.service_entitlements
  FOR SELECT TO sco_workspace_gateway_owner USING (true);

CREATE FUNCTION public.partner_workspace_validate_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."Company"
    WHERE id = NEW.company_id AND type = 'PARTNER' AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'PARTNER_WORKSPACE_COMPANY_FORBIDDEN';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.company_id <> OLD.company_id THEN
    RAISE EXCEPTION 'PARTNER_WORKSPACE_COMPANY_IMMUTABLE';
  END IF;
  NEW.updated_at := clock_timestamp();
  NEW.version := CASE WHEN TG_OP = 'UPDATE' THEN OLD.version + 1 ELSE NEW.version END;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.partner_workspace_project_link_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.partner_workspaces workspace
    JOIN public.projects project ON project.id = NEW.project_id
    WHERE workspace.id = NEW.workspace_id
      AND workspace.company_id = NEW.company_id
      AND project.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'PARTNER_WORKSPACE_PROJECT_COMPANY_MISMATCH';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.partner_workspace_document_reference_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.partner_workspaces workspace
    JOIN public.documents document ON document.id = NEW.document_id
    WHERE workspace.id = NEW.workspace_id
      AND workspace.company_id = NEW.company_id
      AND document.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'PARTNER_WORKSPACE_DOCUMENT_COMPANY_MISMATCH';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER partner_workspace_validate_company_trigger
BEFORE INSERT OR UPDATE ON public.partner_workspaces
FOR EACH ROW EXECUTE FUNCTION public.partner_workspace_validate_company();
CREATE TRIGGER partner_workspace_project_link_validate_trigger
BEFORE INSERT OR UPDATE ON public.partner_workspace_project_links
FOR EACH ROW EXECUTE FUNCTION public.partner_workspace_project_link_validate();
CREATE TRIGGER partner_workspace_document_reference_validate_trigger
BEFORE INSERT OR UPDATE ON public.partner_workspace_document_references
FOR EACH ROW EXECUTE FUNCTION public.partner_workspace_document_reference_validate();

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'partner_workspaces',
    'partner_workspace_project_links',
    'partner_workspace_document_references'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I OWNER TO sco_workspace_gateway_owner', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO sco_workspace_gateway_owner USING (true) WITH CHECK (true)',
      table_name || '_gateway_owner', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO sco_runtime USING (company_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (company_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name || '_tenant_runtime', table_name
    );
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.partner_workspaces, public.partner_workspace_project_links,
  public.partner_workspace_document_references FROM PUBLIC, sco_internal_executor, sco_purpose_authority;
GRANT SELECT, INSERT, UPDATE ON public.partner_workspaces TO sco_runtime;
GRANT SELECT ON public.partner_workspace_project_links, public.partner_workspace_document_references TO sco_runtime;

CREATE FUNCTION public.partner_workspace_capability_projection(p_actor UUID, p_company UUID)
RETURNS TABLE(service_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE tenant_setting TEXT;
DECLARE trusted_company UUID;
BEGIN
  IF session_user <> 'sco_runtime' THEN
    RAISE EXCEPTION 'PARTNER_WORKSPACE_CAPABILITY_FORBIDDEN';
  END IF;
  tenant_setting := NULLIF(current_setting('app.tenant_id', true), '');
  IF tenant_setting IS NULL THEN
    RAISE EXCEPTION 'PARTNER_WORKSPACE_CAPABILITY_FORBIDDEN';
  END IF;
  BEGIN
    trusted_company := tenant_setting::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'PARTNER_WORKSPACE_CAPABILITY_FORBIDDEN';
  END;
  IF p_company IS NULL OR p_company IS DISTINCT FROM trusted_company THEN
    RAISE EXCEPTION 'PARTNER_WORKSPACE_CAPABILITY_FORBIDDEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public."CompanyMembership" membership
    JOIN public."MembershipRole" membership_role
      ON membership_role.membership_id = membership.id
     AND membership_role.company_id = trusted_company
    JOIN public."RolePermission" role_permission
      ON role_permission.role_id = membership_role.role_id
     AND role_permission.company_id = trusted_company
    JOIN public."Permission" permission ON permission.id = role_permission.permission_id
    JOIN public."Company" company
      ON company.id = membership."companyId"
     AND company.id = trusted_company
    WHERE membership."userId" = p_actor
      AND membership."companyId" = trusted_company
      AND membership.status = 'ACTIVE'
      AND company.type = 'PARTNER'
      AND company.status = 'ACTIVE'
      AND permission.code = 'partner.portal.read'
  ) THEN
    RAISE EXCEPTION 'PARTNER_WORKSPACE_CAPABILITY_FORBIDDEN';
  END IF;
  RETURN QUERY
    SELECT entitlement.service_code
    FROM public.service_entitlements entitlement
    WHERE entitlement.company_id = trusted_company
      AND entitlement.state = 'ACTIVE'
    ORDER BY entitlement.service_code;
END
$$;

ALTER FUNCTION public.partner_workspace_validate_company() OWNER TO sco_workspace_gateway_owner;
ALTER FUNCTION public.partner_workspace_project_link_validate() OWNER TO sco_workspace_gateway_owner;
ALTER FUNCTION public.partner_workspace_document_reference_validate() OWNER TO sco_workspace_gateway_owner;
ALTER FUNCTION public.partner_workspace_capability_projection(UUID, UUID) OWNER TO sco_workspace_gateway_owner;
REVOKE ALL ON FUNCTION public.partner_workspace_validate_company(),
  public.partner_workspace_project_link_validate(),
  public.partner_workspace_document_reference_validate(),
  public.partner_workspace_capability_projection(UUID, UUID)
  FROM PUBLIC, sco_internal_executor, sco_purpose_authority;
GRANT EXECUTE ON FUNCTION public.partner_workspace_capability_projection(UUID, UUID) TO sco_runtime;

GRANT EXECUTE ON FUNCTION public.internal_service_access_authorize(UUID, UUID, TEXT, TEXT, UUID, UUID)
  TO sco_workspace_gateway_owner;
GRANT INSERT ON public.audit_logs TO sco_workspace_gateway_owner;
CREATE POLICY audit_logs_workspace_gateway_insert ON public.audit_logs
  FOR INSERT TO sco_workspace_gateway_owner WITH CHECK (true);

CREATE FUNCTION public.internal_partner_workspace_service_access_summary(
  p_actor UUID,
  p_company UUID,
  p_service_code TEXT,
  p_resource_context TEXT,
  p_decision UUID,
  p_correlation_id UUID
)
RETURNS TABLE(workspace_id UUID, display_name TEXT, state TEXT, version INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE authorization_id UUID;
DECLARE v_workspace public.partner_workspaces%ROWTYPE;
BEGIN
  IF session_user <> 'sco_internal_executor'
     OR p_resource_context <> 'partner-workspace:' || p_company::TEXT THEN
    RAISE EXCEPTION 'PARTNER_WORKSPACE_SERVICE_ACCESS_FORBIDDEN';
  END IF;
  authorization_id := public.internal_service_access_authorize(
    p_actor, p_company, p_service_code, p_resource_context, p_decision, p_correlation_id
  );
  SELECT * INTO v_workspace
  FROM public.partner_workspaces workspace
  WHERE workspace.company_id = p_company
    AND workspace.state = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARTNER_WORKSPACE_NOT_FOUND';
  END IF;
  INSERT INTO public.audit_logs (
    actor_user_id, company_id, scope, action, entity_type, entity_id, metadata,
    correlation_id, purpose_code, authorization_decision
  ) VALUES (
    p_actor, p_company, 'TENANT', 'partner_workspace.service_access_presented',
    'PartnerWorkspace', v_workspace.id, jsonb_build_object(
      'serviceCode', p_service_code,
      'resourceContext', p_resource_context,
      'authorizationId', authorization_id
    ), p_correlation_id, 'PUR-02', 'ALLOWED'
  );
  workspace_id := v_workspace.id;
  display_name := v_workspace.display_name;
  state := v_workspace.state;
  version := v_workspace.version;
  RETURN NEXT;
END
$$;

ALTER FUNCTION public.internal_partner_workspace_service_access_summary(UUID, UUID, TEXT, TEXT, UUID, UUID)
  OWNER TO sco_workspace_gateway_owner;
REVOKE ALL ON FUNCTION public.internal_partner_workspace_service_access_summary(UUID, UUID, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, sco_runtime, sco_purpose_authority;
GRANT EXECUTE ON FUNCTION public.internal_partner_workspace_service_access_summary(UUID, UUID, TEXT, TEXT, UUID, UUID)
  TO sco_internal_executor;
