CREATE TYPE "QualificationStatus" AS ENUM ('APPLICATION', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "PartnershipType" AS ENUM ('BUYER_PARTNERSHIP', 'SUPPLIER_PARTNERSHIP');
CREATE TYPE "PartnershipStatus" AS ENUM ('UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED');

CREATE TABLE qualification_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  status "QualificationStatus" NOT NULL DEFAULT 'APPLICATION',
  submitted_by UUID,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE company_partnerships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT,
  type "PartnershipType" NOT NULL,
  status "PartnershipStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  active_from TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, type)
);
CREATE INDEX company_partnerships_company_status_idx ON company_partnerships(company_id, status);

ALTER TABLE qualification_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualification_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE company_partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_partnerships FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON qualification_applications, company_partnerships TO sco_runtime;

CREATE POLICY qualification_sco_internal_only ON qualification_applications
  FOR ALL TO sco_runtime
  USING (current_setting('app.sco_internal', true) = 'true')
  WITH CHECK (current_setting('app.sco_internal', true) = 'true');

CREATE POLICY partnership_sco_internal_or_active_tenant ON company_partnerships
  FOR ALL TO sco_runtime
  USING (current_setting('app.sco_internal', true) = 'true'
    OR company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (current_setting('app.sco_internal', true) = 'true'
    OR company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
