CREATE TYPE "CandidateOrigin" AS ENUM ('PARTNER', 'SCO_INTERNAL');
CREATE TYPE "CandidateStatus" AS ENUM ('SUBMITTED', 'NORMALIZED', 'MATCH_REVIEW', 'LINKED', 'NEW_PRODUCT_PROPOSED', 'CLARIFICATION_REQUIRED', 'REJECTED');
CREATE TYPE "MatchAssessmentStatus" AS ENUM ('OPEN', 'DECIDED');
CREATE TYPE "MatchDecision" AS ENUM ('LINKED', 'NEW_PRODUCT_PROPOSED', 'CLARIFICATION_REQUIRED', 'REJECTED');

CREATE TABLE product_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID REFERENCES "Company"(id) ON DELETE RESTRICT,
  submitted_by UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT, origin "CandidateOrigin" NOT NULL,
  status "CandidateStatus" NOT NULL DEFAULT 'SUBMITTED', submitted_name TEXT NOT NULL, submitted_description TEXT,
  requested_category_id UUID REFERENCES product_categories(id) ON DELETE RESTRICT, brand TEXT, manufacturer TEXT, model_reference TEXT,
  submitted_specification JSONB, normalized_specification JSONB, unit_id UUID REFERENCES unit_definitions(id) ON DELETE RESTRICT,
  warranty_requirement TEXT, source_metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_candidates_company_status_idx ON product_candidates(company_id,status);
CREATE TABLE product_match_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), candidate_id UUID NOT NULL REFERENCES product_candidates(id) ON DELETE RESTRICT,
  product_identity_id UUID REFERENCES product_identities(id) ON DELETE RESTRICT, matched_attributes JSONB, differing_attributes JSONB,
  missing_attributes JSONB, explanation TEXT NOT NULL, status "MatchAssessmentStatus" NOT NULL DEFAULT 'OPEN', decision "MatchDecision",
  reviewed_by UUID REFERENCES "User"(id) ON DELETE RESTRICT, decided_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE product_candidate_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), candidate_id UUID NOT NULL REFERENCES product_candidates(id) ON DELETE RESTRICT,
  from_status "CandidateStatus", to_status "CandidateStatus" NOT NULL, actor_user_id UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_match_assessments_candidate_idx ON product_match_assessments(candidate_id);
CREATE INDEX product_candidate_history_candidate_idx ON product_candidate_history(candidate_id,created_at);

GRANT SELECT, INSERT, UPDATE ON product_candidates, product_match_assessments, product_candidate_history TO sco_runtime;
ALTER TABLE product_candidates ENABLE ROW LEVEL SECURITY; ALTER TABLE product_candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE product_match_assessments ENABLE ROW LEVEL SECURITY; ALTER TABLE product_match_assessments FORCE ROW LEVEL SECURITY;
ALTER TABLE product_candidate_history ENABLE ROW LEVEL SECURITY; ALTER TABLE product_candidate_history FORCE ROW LEVEL SECURITY;
CREATE POLICY product_candidate_scope ON product_candidates FOR ALL TO sco_runtime USING (current_setting('app.sco_internal',true)='true' OR company_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (current_setting('app.sco_internal',true)='true' OR company_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY match_assessment_scope ON product_match_assessments FOR ALL TO sco_runtime USING (current_setting('app.sco_internal',true)='true' OR EXISTS (SELECT 1 FROM product_candidates c WHERE c.id=candidate_id AND c.company_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)) WITH CHECK (current_setting('app.sco_internal',true)='true' OR EXISTS (SELECT 1 FROM product_candidates c WHERE c.id=candidate_id AND c.company_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid));
CREATE POLICY candidate_history_scope ON product_candidate_history FOR ALL TO sco_runtime USING (current_setting('app.sco_internal',true)='true' OR EXISTS (SELECT 1 FROM product_candidates c WHERE c.id=candidate_id AND c.company_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)) WITH CHECK (current_setting('app.sco_internal',true)='true' OR EXISTS (SELECT 1 FROM product_candidates c WHERE c.id=candidate_id AND c.company_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid));
