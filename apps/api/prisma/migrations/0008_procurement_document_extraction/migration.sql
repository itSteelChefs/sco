CREATE TYPE "ProcurementDocumentType" AS ENUM ('BOQ', 'MATERIAL_SCHEDULE', 'PROCUREMENT_LIST', 'OTHER');
CREATE TYPE "ProcurementDocumentStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'EXTRACTED', 'REVIEW_REQUIRED', 'READY_FOR_REVIEW', 'FAILED');
CREATE TYPE "ProcurementLineStatus" AS ENUM ('EXTRACTED', 'REVIEW_REQUIRED', 'CANDIDATE_CREATED', 'REVIEWED');

CREATE TABLE procurement_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
  uploader_user_id UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT, document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE RESTRICT,
  filename TEXT NOT NULL, document_type "ProcurementDocumentType" NOT NULL, source_metadata JSONB,
  processing_status "ProcurementDocumentStatus" NOT NULL DEFAULT 'UPLOADED', extraction_status "ProcurementDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE procurement_document_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL REFERENCES procurement_documents(id) ON DELETE RESTRICT, line_number TEXT, page_reference TEXT, sheet_reference TEXT,
  raw_value JSONB NOT NULL, description TEXT, quantity NUMERIC, unit TEXT, brand TEXT, manufacturer TEXT, model_reference TEXT,
  technical_specification JSONB, extraction_metadata JSONB, normalized_value JSONB, processing_status "ProcurementLineStatus" NOT NULL DEFAULT 'EXTRACTED',
  product_candidate_id UUID REFERENCES product_candidates(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX procurement_documents_company_idx ON procurement_documents(company_id);
CREATE INDEX procurement_document_lines_document_idx ON procurement_document_lines(document_id);
CREATE INDEX procurement_document_lines_company_idx ON procurement_document_lines(company_id);
GRANT SELECT, INSERT, UPDATE ON procurement_documents, procurement_document_lines TO sco_runtime;
ALTER TABLE procurement_documents ENABLE ROW LEVEL SECURITY; ALTER TABLE procurement_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement_document_lines ENABLE ROW LEVEL SECURITY; ALTER TABLE procurement_document_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY procurement_document_tenant ON procurement_documents FOR ALL TO sco_runtime USING (company_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY procurement_line_tenant ON procurement_document_lines FOR ALL TO sco_runtime USING (company_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
