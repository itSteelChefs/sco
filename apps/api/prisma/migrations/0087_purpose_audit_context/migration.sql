-- Stage 007 Purpose Foundation: additive evidence fields only. Historical audit
-- records intentionally remain unattributed rather than receiving fabricated purpose data.
ALTER TABLE audit_logs
  ADD COLUMN purpose_code TEXT,
  ADD COLUMN flow_source TEXT,
  ADD COLUMN flow_target TEXT,
  ADD COLUMN authorization_decision TEXT;

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_purpose_code_valid
    CHECK (purpose_code IS NULL OR purpose_code ~ '^PUR-(0[1-9]|1[0-8])$'),
  ADD CONSTRAINT audit_logs_flow_source_valid
    CHECK (flow_source IS NULL OR flow_source ~ '^PUR-(0[1-9]|1[0-8])$'),
  ADD CONSTRAINT audit_logs_flow_target_valid
    CHECK (flow_target IS NULL OR flow_target ~ '^PUR-(0[1-9]|1[0-8])$'),
  ADD CONSTRAINT audit_logs_authorization_decision_valid
    CHECK (authorization_decision IS NULL OR authorization_decision IN ('ALLOWED', 'DENIED'));

CREATE INDEX audit_logs_company_purpose_created_at_idx
  ON audit_logs (company_id, purpose_code, created_at DESC)
  WHERE purpose_code IS NOT NULL;