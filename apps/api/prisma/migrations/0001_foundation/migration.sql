CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "CompanyType" AS ENUM ('SCO', 'PARTNER', 'SUPPLIER', 'OTHER');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "User" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Company" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "type" "CompanyType" NOT NULL,
  "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "CompanyMembership" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "companyId" UUID NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT,
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("userId", "companyId")
);
CREATE INDEX "CompanyMembership_companyId_idx" ON "CompanyMembership"("companyId");

CREATE TABLE tenant_probes (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tenant_probes_company_id_idx ON tenant_probes(company_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_runtime') THEN
    CREATE ROLE sco_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE sco_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM sco_runtime;
GRANT USAGE ON SCHEMA public TO sco_runtime;
GRANT CONNECT ON DATABASE sco_dev TO sco_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CompanyMembership", tenant_probes TO sco_runtime;

ALTER TABLE "CompanyMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyMembership" FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_probes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_probes FORCE ROW LEVEL SECURITY;

CREATE POLICY company_membership_tenant_isolation ON "CompanyMembership"
  FOR ALL TO sco_runtime
  USING ("companyId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_probe_isolation ON tenant_probes
  FOR ALL TO sco_runtime
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO tenant_probes (id, company_id, label) VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'company-a'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'company-b');
