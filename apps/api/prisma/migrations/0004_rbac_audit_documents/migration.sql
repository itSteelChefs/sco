CREATE TYPE "AuditScope" AS ENUM ('TENANT', 'SYSTEM', 'SCO_INTERNAL', 'PRE_TENANT');
CREATE TYPE "DocumentStatus" AS ENUM ('STAGED', 'AVAILABLE', 'REVOKED');

CREATE TABLE "Role" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES "Company"(id),
  code TEXT NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE TABLE "Permission" (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, description TEXT NOT NULL);
CREATE TABLE "MembershipRole" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES "Company"(id),
  membership_id UUID NOT NULL REFERENCES "CompanyMembership"(id), role_id UUID NOT NULL REFERENCES "Role"(id),
  UNIQUE (membership_id, role_id)
);
CREATE TABLE "RolePermission" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES "Company"(id),
  role_id UUID NOT NULL REFERENCES "Role"(id), permission_id UUID NOT NULL REFERENCES "Permission"(id),
  UNIQUE (role_id, permission_id)
);
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID REFERENCES "Company"(id), actor_user_id UUID REFERENCES "User"(id),
  scope "AuditScope" NOT NULL, action TEXT NOT NULL, entity_type TEXT, entity_id UUID, metadata JSONB NOT NULL DEFAULT '{}',
  correlation_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((scope = 'TENANT' AND company_id IS NOT NULL) OR scope <> 'TENANT')
);
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES "Company"(id), uploader_user_id UUID REFERENCES "User"(id),
  filename TEXT NOT NULL, detected_mime_type TEXT NOT NULL, byte_size BIGINT NOT NULL, storage_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL, status "DocumentStatus" NOT NULL DEFAULT 'STAGED', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES "Company"(id), document_id UUID NOT NULL REFERENCES documents(id),
  version INTEGER NOT NULL, storage_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(document_id, version)
);
CREATE INDEX audit_logs_company_id_idx ON audit_logs(company_id); CREATE INDEX documents_company_id_idx ON documents(company_id);

GRANT SELECT ON "Permission" TO sco_runtime;
GRANT SELECT, INSERT ON "Role", "MembershipRole", "RolePermission", audit_logs, documents, document_versions TO sco_runtime;

ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Role" FORCE ROW LEVEL SECURITY;
ALTER TABLE "MembershipRole" ENABLE ROW LEVEL SECURITY; ALTER TABLE "MembershipRole" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RolePermission" FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY; ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_tenant ON "Role" FOR ALL TO sco_runtime USING (company_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid);
CREATE POLICY membership_role_tenant ON "MembershipRole" FOR ALL TO sco_runtime USING (company_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid);
CREATE POLICY role_permission_tenant ON "RolePermission" FOR ALL TO sco_runtime USING (company_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid);
CREATE POLICY audit_tenant ON audit_logs FOR ALL TO sco_runtime USING (company_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid);
CREATE POLICY audit_system_insert ON audit_logs FOR INSERT TO sco_runtime WITH CHECK (scope <> 'TENANT' AND current_setting('app.audit_system', true) = 'true');
CREATE POLICY document_tenant ON documents FOR ALL TO sco_runtime USING (company_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid);
CREATE POLICY document_version_tenant ON document_versions FOR ALL TO sco_runtime USING (company_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid);
