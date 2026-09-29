CREATE TABLE public.verify_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','IN_REVIEW','COMPLETED','CANCELLED')),
  human_review_consented_at TIMESTAMPTZ,
  human_review_consented_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.verify_quote_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verify_request_id UUID NOT NULL REFERENCES public.verify_requests(id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  submitted_currencies TEXT[] NOT NULL CHECK (cardinality(submitted_currencies) > 0),
  raw_content_document_id UUID REFERENCES public.documents(id) ON DELETE RESTRICT,
  raw_content_version_id UUID REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  input_fingerprint TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(verify_request_id, revision_number),
  CHECK ((raw_content_document_id IS NULL) = (raw_content_version_id IS NULL))
);

CREATE TABLE public.verify_quote_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verify_quote_revision_id UUID NOT NULL REFERENCES public.verify_quote_revisions(id) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  line_reference TEXT,
  product_identity_id UUID REFERENCES public.product_identities(id) ON DELETE RESTRICT,
  unit_id UUID REFERENCES public.unit_definitions(id) ON DELETE RESTRICT,
  quantity NUMERIC(18,4),
  currency_code TEXT,
  unit_price NUMERIC(18,4),
  is_price_bearing BOOLEAN NOT NULL DEFAULT true,
  is_informational BOOLEAN NOT NULL DEFAULT false,
  is_real_zero_value BOOLEAN NOT NULL DEFAULT false,
  readiness_state TEXT NOT NULL DEFAULT 'NEEDS_COMPLETION' CHECK (readiness_state IN ('READY_FOR_VERIFICATION','NEEDS_COMPLETION','NOT_VERIFIABLE')),
  readiness_reason TEXT,
  suspected_duplicate BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(verify_quote_revision_id, line_number),
  CHECK (NOT (is_price_bearing AND is_informational)),
  CHECK (NOT is_real_zero_value OR (is_price_bearing AND unit_price = 0))
);

CREATE TABLE public.verify_quote_line_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verify_quote_line_id UUID NOT NULL REFERENCES public.verify_quote_lines(id) ON DELETE RESTRICT,
  adjustment_type TEXT NOT NULL,
  amount NUMERIC(18,4) NOT NULL,
  currency_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.verify_quote_level_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verify_quote_revision_id UUID NOT NULL REFERENCES public.verify_quote_revisions(id) ON DELETE RESTRICT,
  adjustment_type TEXT NOT NULL,
  amount NUMERIC(18,4) NOT NULL,
  currency_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.verify_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verify_quote_revision_id UUID NOT NULL REFERENCES public.verify_quote_revisions(id) ON DELETE RESTRICT,
  retry_of_run_id UUID REFERENCES public.verify_runs(id) ON DELETE RESTRICT,
  methodology_version TEXT NOT NULL CHECK (btrim(methodology_version) <> ''),
  evidence_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (retry_of_run_id IS NULL OR retry_of_run_id <> id)
);

CREATE TABLE public.verify_evidence_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verify_run_id UUID NOT NULL REFERENCES public.verify_runs(id) ON DELETE RESTRICT,
  evidence_type TEXT NOT NULL,
  source_identity TEXT NOT NULL,
  source_version_identity TEXT NOT NULL,
  document_id UUID REFERENCES public.documents(id) ON DELETE RESTRICT,
  document_version_id UUID REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  effective_date DATE,
  observed_at TIMESTAMPTZ,
  freshness_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  approval_state TEXT NOT NULL,
  comparability_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidentiality_class TEXT NOT NULL,
  integrity_version_reference TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((document_id IS NULL) = (document_version_id IS NULL))
);

CREATE TABLE public.verify_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verify_run_id UUID NOT NULL REFERENCES public.verify_runs(id) ON DELETE RESTRICT,
  supersedes_result_id UUID REFERENCES public.verify_results(id) ON DELETE RESTRICT,
  methodology_version TEXT NOT NULL CHECK (btrim(methodology_version) <> ''),
  classification TEXT NOT NULL CHECK (classification IN ('FULL','PARTIAL','INSUFFICIENT_FOR_RESULT')),
  status TEXT NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED','FINAL','SUPERSEDED')),
  coverage JSONB NOT NULL DEFAULT '{}'::jsonb,
  per_currency_scopes JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  variance_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  exclusions_limitations JSONB NOT NULL DEFAULT '{}'::jsonb,
  prepared_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  finalised_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  finalised_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (supersedes_result_id IS NULL OR supersedes_result_id <> id),
  CHECK (status <> 'FINAL' OR (finalised_by IS NOT NULL AND finalised_at IS NOT NULL))
);

CREATE TABLE public.verify_raw_review_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  verify_request_id UUID NOT NULL REFERENCES public.verify_requests(id) ON DELETE RESTRICT,
  verify_quote_revision_id UUID REFERENCES public.verify_quote_revisions(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL,
  scope_description TEXT NOT NULL,
  reason TEXT NOT NULL,
  authorization_basis TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  authorized_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  audit_reference UUID REFERENCES public.audit_logs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > starts_at),
  CHECK (authorized_by <> actor_user_id)
);

CREATE TABLE public.verify_raw_content_access_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verify_raw_review_grant_id UUID NOT NULL REFERENCES public.verify_raw_review_grants(id) ON DELETE RESTRICT,
  verify_quote_revision_id UUID NOT NULL REFERENCES public.verify_quote_revisions(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  audit_log_id UUID REFERENCES public.audit_logs(id) ON DELETE SET NULL
);

CREATE INDEX verify_requests_company_idx ON public.verify_requests(company_id, created_at);
CREATE INDEX verify_quote_revisions_request_idx ON public.verify_quote_revisions(verify_request_id, created_at);
CREATE INDEX verify_runs_revision_idx ON public.verify_runs(verify_quote_revision_id, created_at);
CREATE INDEX verify_results_run_idx ON public.verify_results(verify_run_id, created_at);
CREATE INDEX verify_raw_review_grants_actor_idx ON public.verify_raw_review_grants(actor_user_id, expires_at);

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'verify.analyst', 'Prepare confidential Verify results without raw quote access'),
  (gen_random_uuid(), 'verify.approver', 'Finalize confidential Verify results without raw quote access'),
  (gen_random_uuid(), 'verify.raw_review_access', 'Use an authorized, consented Verify raw-review grant')
ON CONFLICT(code) DO NOTHING;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'verify_requests','verify_quote_revisions','verify_quote_lines','verify_quote_line_adjustments',
    'verify_quote_level_adjustments','verify_runs','verify_evidence_bindings','verify_results',
    'verify_raw_review_grants','verify_raw_content_access_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, sco_runtime, sco_internal_executor', table_name);
  END LOOP;
END $$;

CREATE POLICY verify_requests_tenant ON public.verify_requests FOR ALL TO sco_runtime
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID)
  WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);
CREATE POLICY verify_quote_revisions_tenant ON public.verify_quote_revisions FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM public.verify_requests r WHERE r.id = verify_request_id AND r.company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID))
  WITH CHECK (EXISTS (SELECT 1 FROM public.verify_requests r WHERE r.id = verify_request_id AND r.company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID));
CREATE POLICY verify_quote_lines_tenant ON public.verify_quote_lines FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM public.verify_quote_revisions q JOIN public.verify_requests r ON r.id=q.verify_request_id WHERE q.id=verify_quote_revision_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID))
  WITH CHECK (EXISTS (SELECT 1 FROM public.verify_quote_revisions q JOIN public.verify_requests r ON r.id=q.verify_request_id WHERE q.id=verify_quote_revision_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID));
CREATE POLICY verify_quote_line_adjustments_tenant ON public.verify_quote_line_adjustments FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM public.verify_quote_lines l JOIN public.verify_quote_revisions q ON q.id=l.verify_quote_revision_id JOIN public.verify_requests r ON r.id=q.verify_request_id WHERE l.id=verify_quote_line_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID))
  WITH CHECK (EXISTS (SELECT 1 FROM public.verify_quote_lines l JOIN public.verify_quote_revisions q ON q.id=l.verify_quote_revision_id JOIN public.verify_requests r ON r.id=q.verify_request_id WHERE l.id=verify_quote_line_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID));
CREATE POLICY verify_quote_level_adjustments_tenant ON public.verify_quote_level_adjustments FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM public.verify_quote_revisions q JOIN public.verify_requests r ON r.id=q.verify_request_id WHERE q.id=verify_quote_revision_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID))
  WITH CHECK (EXISTS (SELECT 1 FROM public.verify_quote_revisions q JOIN public.verify_requests r ON r.id=q.verify_request_id WHERE q.id=verify_quote_revision_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID));
CREATE POLICY verify_runs_tenant ON public.verify_runs FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM public.verify_quote_revisions q JOIN public.verify_requests r ON r.id=q.verify_request_id WHERE q.id=verify_quote_revision_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID))
  WITH CHECK (EXISTS (SELECT 1 FROM public.verify_quote_revisions q JOIN public.verify_requests r ON r.id=q.verify_request_id WHERE q.id=verify_quote_revision_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID));
CREATE POLICY verify_evidence_bindings_tenant ON public.verify_evidence_bindings FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM public.verify_runs run JOIN public.verify_quote_revisions q ON q.id=run.verify_quote_revision_id JOIN public.verify_requests r ON r.id=q.verify_request_id WHERE run.id=verify_run_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID))
  WITH CHECK (EXISTS (SELECT 1 FROM public.verify_runs run JOIN public.verify_quote_revisions q ON q.id=run.verify_quote_revision_id JOIN public.verify_requests r ON r.id=q.verify_request_id WHERE run.id=verify_run_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID));
CREATE POLICY verify_results_tenant ON public.verify_results FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM public.verify_runs run JOIN public.verify_quote_revisions q ON q.id=run.verify_quote_revision_id JOIN public.verify_requests r ON r.id=q.verify_request_id WHERE run.id=verify_run_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID))
  WITH CHECK (EXISTS (SELECT 1 FROM public.verify_runs run JOIN public.verify_quote_revisions q ON q.id=run.verify_quote_revision_id JOIN public.verify_requests r ON r.id=q.verify_request_id WHERE run.id=verify_run_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID));
CREATE POLICY verify_raw_review_grants_tenant ON public.verify_raw_review_grants FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM public.verify_requests r WHERE r.id=verify_request_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID))
  WITH CHECK (EXISTS (SELECT 1 FROM public.verify_requests r WHERE r.id=verify_request_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID));
CREATE POLICY verify_raw_content_access_events_tenant ON public.verify_raw_content_access_events FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM public.verify_quote_revisions q JOIN public.verify_requests r ON r.id=q.verify_request_id WHERE q.id=verify_quote_revision_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID))
  WITH CHECK (EXISTS (SELECT 1 FROM public.verify_quote_revisions q JOIN public.verify_requests r ON r.id=q.verify_request_id WHERE q.id=verify_quote_revision_id AND r.company_id=NULLIF(current_setting('app.tenant_id', true), '')::UUID));

CREATE FUNCTION public.prevent_verify_immutable_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'VERIFY_HISTORY_IMMUTABLE';
END $$;

CREATE TRIGGER verify_quote_revisions_immutable BEFORE UPDATE OR DELETE ON public.verify_quote_revisions FOR EACH ROW EXECUTE FUNCTION public.prevent_verify_immutable_mutation();
CREATE TRIGGER verify_quote_line_adjustments_immutable BEFORE UPDATE OR DELETE ON public.verify_quote_line_adjustments FOR EACH ROW EXECUTE FUNCTION public.prevent_verify_immutable_mutation();
CREATE TRIGGER verify_quote_level_adjustments_immutable BEFORE UPDATE OR DELETE ON public.verify_quote_level_adjustments FOR EACH ROW EXECUTE FUNCTION public.prevent_verify_immutable_mutation();
CREATE TRIGGER verify_evidence_bindings_immutable BEFORE UPDATE OR DELETE ON public.verify_evidence_bindings FOR EACH ROW EXECUTE FUNCTION public.prevent_verify_immutable_mutation();
CREATE TRIGGER verify_raw_content_access_events_immutable BEFORE UPDATE OR DELETE ON public.verify_raw_content_access_events FOR EACH ROW EXECUTE FUNCTION public.prevent_verify_immutable_mutation();

CREATE FUNCTION public.verify_quote_revision_document_valid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.raw_content_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.verify_requests request
    JOIN public.documents document ON document.id=NEW.raw_content_document_id AND document.company_id=request.company_id
    JOIN public.document_versions version ON version.id=NEW.raw_content_version_id AND version.document_id=document.id AND version.company_id=document.company_id
    WHERE request.id=NEW.verify_request_id
  ) THEN
    RAISE EXCEPTION 'VERIFY_QUOTE_DOCUMENT_INVALID';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verify_quote_revision_document_check BEFORE INSERT ON public.verify_quote_revisions FOR EACH ROW EXECUTE FUNCTION public.verify_quote_revision_document_valid();

CREATE FUNCTION public.verify_evidence_document_valid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.verify_runs run
    JOIN public.verify_quote_revisions revision ON revision.id=run.verify_quote_revision_id
    JOIN public.verify_requests request ON request.id=revision.verify_request_id
    JOIN public.documents document ON document.id=NEW.document_id AND document.company_id=request.company_id
    JOIN public.document_versions version ON version.id=NEW.document_version_id AND version.document_id=document.id AND version.company_id=document.company_id
    WHERE run.id=NEW.verify_run_id
  ) THEN
    RAISE EXCEPTION 'VERIFY_EVIDENCE_DOCUMENT_INVALID';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verify_evidence_document_check BEFORE INSERT ON public.verify_evidence_bindings FOR EACH ROW EXECUTE FUNCTION public.verify_evidence_document_valid();

CREATE FUNCTION public.verify_run_insert_valid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE predecessor RECORD;
BEGIN
  IF NEW.retry_of_run_id IS NOT NULL THEN
    SELECT id,verify_quote_revision_id,status INTO predecessor FROM public.verify_runs WHERE id=NEW.retry_of_run_id;
    IF NOT FOUND OR predecessor.id=NEW.id OR predecessor.verify_quote_revision_id<>NEW.verify_quote_revision_id OR predecessor.status<>'FAILED' THEN
      RAISE EXCEPTION 'VERIFY_RUN_RETRY_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verify_run_insert_check BEFORE INSERT ON public.verify_runs FOR EACH ROW EXECUTE FUNCTION public.verify_run_insert_valid();

CREATE FUNCTION public.verify_result_insert_valid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE run_record RECORD; prior_record RECORD;
BEGIN
  SELECT id,verify_quote_revision_id,methodology_version INTO run_record FROM public.verify_runs WHERE id=NEW.verify_run_id;
  IF NOT FOUND OR NEW.methodology_version<>run_record.methodology_version OR NEW.status<>'PREPARED' OR NEW.finalised_by IS NOT NULL OR NEW.finalised_at IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY_RESULT_INVALID';
  END IF;
  IF NEW.supersedes_result_id IS NOT NULL THEN
    SELECT result.id,run.verify_quote_revision_id INTO prior_record
    FROM public.verify_results result JOIN public.verify_runs run ON run.id=result.verify_run_id
    WHERE result.id=NEW.supersedes_result_id AND result.status='FINAL';
    IF NOT FOUND OR prior_record.id=NEW.id OR prior_record.verify_quote_revision_id<>run_record.verify_quote_revision_id THEN
      RAISE EXCEPTION 'VERIFY_RESULT_SUPERSESSION_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verify_result_insert_check BEFORE INSERT ON public.verify_results FOR EACH ROW EXECUTE FUNCTION public.verify_result_insert_valid();

CREATE FUNCTION public.verify_quote_line_transition_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.verify_quote_revision_id IS DISTINCT FROM OLD.verify_quote_revision_id
     OR NEW.line_number IS DISTINCT FROM OLD.line_number
     OR NEW.line_reference IS DISTINCT FROM OLD.line_reference
     OR NEW.product_identity_id IS DISTINCT FROM OLD.product_identity_id
     OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
     OR NEW.is_price_bearing IS DISTINCT FROM OLD.is_price_bearing
     OR NEW.is_informational IS DISTINCT FROM OLD.is_informational
     OR NEW.is_real_zero_value IS DISTINCT FROM OLD.is_real_zero_value
     OR NEW.suspected_duplicate IS DISTINCT FROM OLD.suspected_duplicate
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NOT ((OLD.readiness_state='NEEDS_COMPLETION' AND NEW.readiness_state IN ('READY_FOR_VERIFICATION','NOT_VERIFIABLE')) OR (OLD.readiness_state='READY_FOR_VERIFICATION' AND NEW.readiness_state='NOT_VERIFIABLE'))
     OR (NEW.readiness_state='NOT_VERIFIABLE' AND btrim(COALESCE(NEW.readiness_reason,''))='')
     OR EXISTS (SELECT 1 FROM public.verify_runs run JOIN public.verify_results result ON result.verify_run_id=run.id WHERE run.verify_quote_revision_id=OLD.verify_quote_revision_id AND result.status IN ('FINAL','SUPERSEDED')) THEN
    RAISE EXCEPTION 'VERIFY_QUOTE_LINE_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verify_quote_lines_transition_only BEFORE UPDATE OR DELETE ON public.verify_quote_lines FOR EACH ROW EXECUTE FUNCTION public.verify_quote_line_transition_only();

CREATE FUNCTION public.verify_run_transition_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.verify_quote_revision_id IS DISTINCT FROM OLD.verify_quote_revision_id
     OR NEW.retry_of_run_id IS DISTINCT FROM OLD.retry_of_run_id
     OR NEW.methodology_version IS DISTINCT FROM OLD.methodology_version
     OR NEW.evidence_fingerprint IS DISTINCT FROM OLD.evidence_fingerprint
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NOT ((OLD.status='QUEUED' AND NEW.status IN ('RUNNING','CANCELLED')) OR (OLD.status='RUNNING' AND NEW.status IN ('COMPLETED','FAILED','CANCELLED'))) THEN
    RAISE EXCEPTION 'VERIFY_RUN_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verify_runs_transition_only BEFORE UPDATE OR DELETE ON public.verify_runs FOR EACH ROW EXECUTE FUNCTION public.verify_run_transition_only();

CREATE FUNCTION public.verify_result_transition_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.verify_run_id IS DISTINCT FROM OLD.verify_run_id
     OR NEW.supersedes_result_id IS DISTINCT FROM OLD.supersedes_result_id
     OR NEW.methodology_version IS DISTINCT FROM OLD.methodology_version
     OR NEW.classification IS DISTINCT FROM OLD.classification
     OR NEW.coverage IS DISTINCT FROM OLD.coverage
     OR NEW.per_currency_scopes IS DISTINCT FROM OLD.per_currency_scopes
     OR NEW.confidence_context IS DISTINCT FROM OLD.confidence_context
     OR NEW.variance_data IS DISTINCT FROM OLD.variance_data
     OR NEW.exclusions_limitations IS DISTINCT FROM OLD.exclusions_limitations
     OR NEW.prepared_by IS DISTINCT FROM OLD.prepared_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NOT ((OLD.status='PREPARED' AND NEW.status='FINAL' AND NEW.finalised_by IS NOT NULL AND NEW.finalised_at IS NOT NULL) OR (OLD.status='FINAL' AND NEW.status='SUPERSEDED' AND NEW.finalised_by IS NOT DISTINCT FROM OLD.finalised_by AND NEW.finalised_at IS NOT DISTINCT FROM OLD.finalised_at)) THEN
    RAISE EXCEPTION 'VERIFY_RESULT_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verify_results_transition_only BEFORE UPDATE OR DELETE ON public.verify_results FOR EACH ROW EXECUTE FUNCTION public.verify_result_transition_only();

CREATE FUNCTION public.internal_verify_quote_line_transition(p_actor UUID,p_line UUID,p_next TEXT,p_reason TEXT,p_correlation TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE previous_state TEXT;
BEGIN
  IF NULLIF(current_setting('app.actor_id',true),'') IS DISTINCT FROM p_actor::TEXT OR NOT public.internal_has_capability(p_actor,'verify.analyst') THEN RAISE EXCEPTION 'VERIFY_ANALYST_FORBIDDEN'; END IF;
  SELECT readiness_state INTO previous_state FROM public.verify_quote_lines WHERE id=p_line FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFY_QUOTE_LINE_NOT_AVAILABLE'; END IF;
  UPDATE public.verify_quote_lines SET readiness_state=p_next,readiness_reason=NULLIF(btrim(COALESCE(p_reason,'')),'') WHERE id=p_line;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','verify.quote_line.readiness_changed','VerifyQuoteLine',p_line,jsonb_build_object('fromState',previous_state,'toState',p_next,'reason',p_reason),NULLIF(p_correlation,'')::UUID);
END $$;

CREATE FUNCTION public.internal_verify_run_transition(p_actor UUID,p_run UUID,p_next TEXT,p_correlation TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE previous_state TEXT;
BEGIN
  IF NULLIF(current_setting('app.actor_id',true),'') IS DISTINCT FROM p_actor::TEXT OR NOT public.internal_has_capability(p_actor,'verify.analyst') THEN RAISE EXCEPTION 'VERIFY_ANALYST_FORBIDDEN'; END IF;
  SELECT status INTO previous_state FROM public.verify_runs WHERE id=p_run FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFY_RUN_NOT_AVAILABLE'; END IF;
  UPDATE public.verify_runs SET status=p_next WHERE id=p_run;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','verify.run.transitioned','VerifyRun',p_run,jsonb_build_object('fromState',previous_state,'toState',p_next),NULLIF(p_correlation,'')::UUID);
END $$;

CREATE FUNCTION public.internal_verify_result_prepare(
  p_actor UUID,p_run UUID,p_classification TEXT,p_coverage JSONB,p_per_currency_scopes JSONB,
  p_confidence_context JSONB,p_variance_data JSONB,p_exclusions_limitations JSONB,
  p_supersedes_result UUID,p_correlation TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result_id UUID := gen_random_uuid(); run_record RECORD;
BEGIN
  IF NULLIF(current_setting('app.actor_id',true),'') IS DISTINCT FROM p_actor::TEXT OR NOT public.internal_has_capability(p_actor,'verify.analyst') THEN RAISE EXCEPTION 'VERIFY_ANALYST_FORBIDDEN'; END IF;
  SELECT id,methodology_version,status INTO run_record FROM public.verify_runs WHERE id=p_run FOR UPDATE;
  IF NOT FOUND OR run_record.status<>'COMPLETED' OR btrim(COALESCE(p_classification,''))='' THEN RAISE EXCEPTION 'VERIFY_RESULT_NOT_PREPARABLE'; END IF;
  INSERT INTO public.verify_results(
    id,verify_run_id,supersedes_result_id,methodology_version,classification,status,coverage,
    per_currency_scopes,confidence_context,variance_data,exclusions_limitations,prepared_by
  ) VALUES (
    result_id,p_run,p_supersedes_result,run_record.methodology_version,p_classification,'PREPARED',
    COALESCE(p_coverage,'{}'::JSONB),COALESCE(p_per_currency_scopes,'{}'::JSONB),
    COALESCE(p_confidence_context,'{}'::JSONB),COALESCE(p_variance_data,'{}'::JSONB),
    COALESCE(p_exclusions_limitations,'{}'::JSONB),p_actor
  );
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id)
  VALUES(p_actor,'SCO_INTERNAL','verify.result.prepared','VerifyResult',result_id,
    jsonb_build_object('runId',p_run,'outcome','PREPARED','authorizationPath','verify.analyst'),NULLIF(p_correlation,'')::UUID);
  RETURN result_id;
END $$;

CREATE FUNCTION public.internal_verify_result_finalize(p_actor UUID,p_result UUID,p_correlation TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE run_id UUID;
BEGIN
  IF NULLIF(current_setting('app.actor_id',true),'') IS DISTINCT FROM p_actor::TEXT OR NOT public.internal_has_capability(p_actor,'verify.approver') THEN RAISE EXCEPTION 'VERIFY_APPROVER_FORBIDDEN'; END IF;
  SELECT verify_run_id INTO run_id FROM public.verify_results WHERE id=p_result FOR UPDATE;
  UPDATE public.verify_results result SET status='FINAL',finalised_by=p_actor,finalised_at=now()
  WHERE result.id=p_result AND result.status='PREPARED'
    AND EXISTS (SELECT 1 FROM public.verify_runs run WHERE run.id=result.verify_run_id AND run.status='COMPLETED');
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFY_RESULT_NOT_FINALISABLE'; END IF;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','verify.result.finalized','VerifyResult',p_result,jsonb_build_object('runId',run_id,'outcome','FINAL','authorizationPath','verify.approver'),NULLIF(p_correlation,'')::UUID);
END $$;

CREATE FUNCTION public.internal_verify_result_supersede(p_actor UUID,p_result UUID,p_replacement UUID,p_correlation TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NULLIF(current_setting('app.actor_id',true),'') IS DISTINCT FROM p_actor::TEXT OR NOT public.internal_has_capability(p_actor,'verify.approver') THEN RAISE EXCEPTION 'VERIFY_APPROVER_FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.verify_results replacement JOIN public.verify_runs replacement_run ON replacement_run.id=replacement.verify_run_id JOIN public.verify_results prior ON prior.id=p_result JOIN public.verify_runs prior_run ON prior_run.id=prior.verify_run_id WHERE replacement.id=p_replacement AND replacement.status='FINAL' AND replacement.supersedes_result_id=prior.id AND prior.status='FINAL' AND replacement_run.verify_quote_revision_id=prior_run.verify_quote_revision_id) THEN RAISE EXCEPTION 'VERIFY_RESULT_SUPERSESSION_INVALID'; END IF;
  UPDATE public.verify_results SET status='SUPERSEDED' WHERE id=p_result;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','verify.result.superseded','VerifyResult',p_result,jsonb_build_object('replacementResultId',p_replacement),NULLIF(p_correlation,'')::UUID);
END $$;

CREATE FUNCTION public.internal_verify_raw_review_authorization_check(p_actor UUID,p_company UUID,p_revision UUID,p_grant UUID,p_correlation TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NULLIF(current_setting('app.actor_id',true),'') IS DISTINCT FROM p_actor::TEXT
     OR NULLIF(current_setting('app.tenant_id',true),'') IS DISTINCT FROM p_company::TEXT
     OR NOT public.internal_has_capability(p_actor,'verify.raw_review_access')
     OR NOT EXISTS (SELECT 1 FROM public.verify_raw_review_grants grant_record JOIN public.verify_quote_revisions revision ON revision.verify_request_id=grant_record.verify_request_id JOIN public.verify_requests request ON request.id=revision.verify_request_id WHERE grant_record.id=p_grant AND grant_record.actor_user_id=p_actor AND grant_record.authorized_by<>grant_record.actor_user_id AND (grant_record.verify_quote_revision_id IS NULL OR grant_record.verify_quote_revision_id=p_revision) AND revision.id=p_revision AND request.company_id=p_company AND request.human_review_consented_at IS NOT NULL AND grant_record.starts_at<=now() AND grant_record.expires_at>now() AND grant_record.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'VERIFY_RAW_REVIEW_FORBIDDEN';
  END IF;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','verify.raw_review.authorization_intent_recorded','VerifyQuoteRevision',p_revision,jsonb_build_object('grantId',p_grant,'companyId',p_company,'contentDeliveryEnabled',false),NULLIF(p_correlation,'')::UUID);
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.internal_verify_quote_line_transition(UUID,UUID,TEXT,TEXT,TEXT),public.internal_verify_run_transition(UUID,UUID,TEXT,TEXT),public.internal_verify_result_prepare(UUID,UUID,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,UUID,TEXT),public.internal_verify_result_finalize(UUID,UUID,TEXT),public.internal_verify_result_supersede(UUID,UUID,UUID,TEXT),public.internal_verify_raw_review_authorization_check(UUID,UUID,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_verify_quote_line_transition(UUID,UUID,TEXT,TEXT,TEXT),public.internal_verify_run_transition(UUID,UUID,TEXT,TEXT),public.internal_verify_result_prepare(UUID,UUID,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,UUID,TEXT),public.internal_verify_result_finalize(UUID,UUID,TEXT),public.internal_verify_result_supersede(UUID,UUID,UUID,TEXT),public.internal_verify_raw_review_authorization_check(UUID,UUID,UUID,UUID,TEXT) TO sco_internal_executor;