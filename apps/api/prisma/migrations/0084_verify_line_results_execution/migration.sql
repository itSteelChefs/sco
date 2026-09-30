-- Batch 1-D: Verify V0.1 line-result execution, aggregate result computation, and SYSTEM-executor security model.
-- Does not edit or rewrite 0082/0083 history; only adds new objects and CREATE OR REPLACE's mutable enforcement code.

CREATE TABLE public.verify_run_line_scope (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verify_run_id UUID NOT NULL REFERENCES public.verify_runs(id) ON DELETE RESTRICT,
  verify_quote_line_id UUID NOT NULL REFERENCES public.verify_quote_lines(id) ON DELETE RESTRICT,
  is_applicable BOOLEAN NOT NULL,
  captured_readiness_state TEXT NOT NULL CHECK (captured_readiness_state IN ('READY_FOR_VERIFICATION','NEEDS_COMPLETION','NOT_VERIFIABLE')),
  captured_readiness_reason TEXT,
  -- Immutable coverage/value inputs captured once at run creation (P1 remediation): later result preparation must never
  -- recompute from mutable verify_quote_lines/verify_quote_line_adjustments rows.
  captured_currency_code TEXT,
  captured_quantity NUMERIC(18,4),
  captured_unit_price NUMERIC(18,4),
  captured_is_real_zero_value BOOLEAN NOT NULL DEFAULT false,
  captured_attributable_value NUMERIC(18,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (verify_run_id, verify_quote_line_id)
);

CREATE TABLE public.verify_line_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verify_run_id UUID NOT NULL REFERENCES public.verify_runs(id) ON DELETE RESTRICT,
  verify_quote_line_id UUID NOT NULL REFERENCES public.verify_quote_lines(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('VERIFIED','INSUFFICIENT_EVIDENCE','EXCLUDED')),
  exclusion_reason TEXT,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (verify_run_id, verify_quote_line_id),
  CHECK ((outcome = 'EXCLUDED') = (btrim(COALESCE(exclusion_reason, '')) <> ''))
);

CREATE TABLE public.verify_line_result_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verify_line_result_id UUID NOT NULL REFERENCES public.verify_line_results(id) ON DELETE RESTRICT,
  verify_evidence_binding_id UUID NOT NULL REFERENCES public.verify_evidence_bindings(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (verify_line_result_id, verify_evidence_binding_id)
);

CREATE INDEX verify_run_line_scope_run_idx ON public.verify_run_line_scope(verify_run_id);
CREATE INDEX verify_line_results_run_idx ON public.verify_line_results(verify_run_id);
CREATE INDEX verify_line_result_evidence_result_idx ON public.verify_line_result_evidence(verify_line_result_id);

-- Database-level one-active-run-per-revision invariant (defense in depth alongside the gateway check).
CREATE UNIQUE INDEX verify_runs_one_active_per_revision ON public.verify_runs(verify_quote_revision_id) WHERE status IN ('QUEUED','RUNNING');

-- P1 remediation: exactly one VerifyResult per VerifyRun, enforced at the database level (not application convention).
-- Supersession never requires a second row for the same run: the replacement result belongs to a DIFFERENT run.
ALTER TABLE public.verify_results ADD CONSTRAINT verify_results_run_unique UNIQUE (verify_run_id);

-- P1 remediation: a single, non-spoofable SYSTEM identity. SYSTEM gateways below no longer accept a caller-supplied
-- p_actor parameter at all, so no caller (even one holding sco_verify_system_executor) can attribute actions to an
-- arbitrary user UUID; every SYSTEM-originated row/audit entry is attributed to this fixed account.
CREATE FUNCTION public.verify_system_actor_id() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-4000-9000-000000005357'::uuid $$;
INSERT INTO public."User"(id, email, "passwordHash", status)
VALUES (public.verify_system_actor_id(), 'verify-system@sco.internal', 'SYSTEM_ACCOUNT_NO_LOGIN_NOT_A_REAL_HASH', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['verify_run_line_scope','verify_line_results','verify_line_result_evidence'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, sco_runtime, sco_internal_executor', table_name);
  END LOOP;
END $$;

CREATE POLICY verify_run_line_scope_tenant ON public.verify_run_line_scope FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM public.verify_runs run JOIN public.verify_quote_revisions q ON q.id = run.verify_quote_revision_id JOIN public.verify_requests r ON r.id = q.verify_request_id WHERE run.id = verify_run_id AND r.company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID))
  WITH CHECK (EXISTS (SELECT 1 FROM public.verify_runs run JOIN public.verify_quote_revisions q ON q.id = run.verify_quote_revision_id JOIN public.verify_requests r ON r.id = q.verify_request_id WHERE run.id = verify_run_id AND r.company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID));

CREATE POLICY verify_line_results_tenant ON public.verify_line_results FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM public.verify_runs run JOIN public.verify_quote_revisions q ON q.id = run.verify_quote_revision_id JOIN public.verify_requests r ON r.id = q.verify_request_id WHERE run.id = verify_run_id AND r.company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID))
  WITH CHECK (EXISTS (SELECT 1 FROM public.verify_runs run JOIN public.verify_quote_revisions q ON q.id = run.verify_quote_revision_id JOIN public.verify_requests r ON r.id = q.verify_request_id WHERE run.id = verify_run_id AND r.company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID));

CREATE POLICY verify_line_result_evidence_tenant ON public.verify_line_result_evidence FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM public.verify_line_results lr JOIN public.verify_runs run ON run.id = lr.verify_run_id JOIN public.verify_quote_revisions q ON q.id = run.verify_quote_revision_id JOIN public.verify_requests r ON r.id = q.verify_request_id WHERE lr.id = verify_line_result_id AND r.company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID))
  WITH CHECK (EXISTS (SELECT 1 FROM public.verify_line_results lr JOIN public.verify_runs run ON run.id = lr.verify_run_id JOIN public.verify_quote_revisions q ON q.id = run.verify_quote_revision_id JOIN public.verify_requests r ON r.id = q.verify_request_id WHERE lr.id = verify_line_result_id AND r.company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID));

CREATE TRIGGER verify_run_line_scope_immutable BEFORE UPDATE OR DELETE ON public.verify_run_line_scope FOR EACH ROW EXECUTE FUNCTION public.prevent_verify_immutable_mutation();
CREATE TRIGGER verify_line_results_immutable BEFORE UPDATE OR DELETE ON public.verify_line_results FOR EACH ROW EXECUTE FUNCTION public.prevent_verify_immutable_mutation();
CREATE TRIGGER verify_line_result_evidence_immutable BEFORE UPDATE OR DELETE ON public.verify_line_result_evidence FOR EACH ROW EXECUTE FUNCTION public.prevent_verify_immutable_mutation();

-- Enforce section 1/2: READY-only VERIFIED/INSUFFICIENT_EVIDENCE, pre-run NEEDS_COMPLETION/NOT_VERIFIABLE-only EXCLUDED, applicable-only.
-- P1 remediation: a line result may only ever be recorded while its VerifyRun is RUNNING (rejects QUEUED/COMPLETED/FAILED/CANCELLED).
CREATE FUNCTION public.verify_line_result_insert_valid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE scope_record RECORD; run_status TEXT;
BEGIN
  SELECT status INTO run_status FROM public.verify_runs WHERE id = NEW.verify_run_id;
  IF NOT FOUND OR run_status <> 'RUNNING' THEN
    RAISE EXCEPTION 'VERIFY_LINE_RESULT_RUN_NOT_RUNNING';
  END IF;
  SELECT is_applicable, captured_readiness_state INTO scope_record
    FROM public.verify_run_line_scope
   WHERE verify_run_id = NEW.verify_run_id AND verify_quote_line_id = NEW.verify_quote_line_id;
  IF NOT FOUND OR NOT scope_record.is_applicable THEN
    RAISE EXCEPTION 'VERIFY_LINE_RESULT_NOT_APPLICABLE';
  END IF;
  IF NEW.outcome IN ('VERIFIED', 'INSUFFICIENT_EVIDENCE') AND scope_record.captured_readiness_state <> 'READY_FOR_VERIFICATION' THEN
    RAISE EXCEPTION 'VERIFY_LINE_RESULT_NOT_READY';
  END IF;
  IF NEW.outcome = 'EXCLUDED' AND scope_record.captured_readiness_state = 'READY_FOR_VERIFICATION' THEN
    RAISE EXCEPTION 'VERIFY_LINE_RESULT_EXCLUSION_INVALID';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER verify_line_result_insert_check BEFORE INSERT ON public.verify_line_results FOR EACH ROW EXECUTE FUNCTION public.verify_line_result_insert_valid();

-- P1 remediation: evidence bindings may only be created while the run is RUNNING (rejects QUEUED/COMPLETED/FAILED/CANCELLED);
-- historical evidence bindings themselves remain immutable via the existing prevent_verify_immutable_mutation trigger.
CREATE FUNCTION public.verify_evidence_binding_run_running_valid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE run_status TEXT;
BEGIN
  SELECT status INTO run_status FROM public.verify_runs WHERE id = NEW.verify_run_id;
  IF NOT FOUND OR run_status <> 'RUNNING' THEN
    RAISE EXCEPTION 'VERIFY_EVIDENCE_BIND_NOT_ALLOWED';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER verify_evidence_binding_run_running_check BEFORE INSERT ON public.verify_evidence_bindings FOR EACH ROW EXECUTE FUNCTION public.verify_evidence_binding_run_running_valid();

-- Enforce section 4: evidence links must belong to the same run as the line result they attach to.
CREATE FUNCTION public.verify_line_result_evidence_same_run_valid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.verify_line_results lr
    JOIN public.verify_evidence_bindings eb ON eb.id = NEW.verify_evidence_binding_id
    WHERE lr.id = NEW.verify_line_result_id AND lr.verify_run_id = eb.verify_run_id
  ) THEN
    RAISE EXCEPTION 'VERIFY_LINE_RESULT_EVIDENCE_RUN_MISMATCH';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER verify_line_result_evidence_same_run_check BEFORE INSERT ON public.verify_line_result_evidence FOR EACH ROW EXECUTE FUNCTION public.verify_line_result_evidence_same_run_valid();

-- Section 8/9/13: extend request lifecycle with SUBMITTED -> IN_REVIEW and IN_REVIEW -> COMPLETED.
-- Historical data facts are untouched; only the mutable trigger enforcement function is replaced.
DROP TRIGGER verify_requests_lifecycle_only ON public.verify_requests;

CREATE OR REPLACE FUNCTION public.verify_request_lifecycle_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE target_revision RECORD; previous_revision_number INTEGER;
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.human_review_consented_at IS DISTINCT FROM OLD.human_review_consented_at
     OR NEW.human_review_consented_by IS DISTINCT FROM OLD.human_review_consented_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('SUBMITTED', 'CANCELLED'))
       OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('SUBMITTED', 'CANCELLED', 'IN_REVIEW'))
       OR (OLD.status = 'IN_REVIEW' AND NEW.status = 'COMPLETED')
     ) THEN
    RAISE EXCEPTION 'VERIFY_REQUEST_IMMUTABLE';
  END IF;
  IF NEW.current_submitted_revision_id IS DISTINCT FROM OLD.current_submitted_revision_id THEN
    IF NEW.status <> 'SUBMITTED' OR NEW.current_submitted_revision_id IS NULL THEN
      RAISE EXCEPTION 'VERIFY_REQUEST_POINTER_INVALID';
    END IF;
    SELECT revision.verify_request_id, revision.revision_number, revision.status,
           revision.submitted_at, revision.submitted_by
      INTO target_revision
      FROM public.verify_quote_revisions revision
     WHERE revision.id = NEW.current_submitted_revision_id
     FOR UPDATE;
    IF NOT FOUND
       OR target_revision.verify_request_id IS DISTINCT FROM NEW.id
       OR target_revision.status <> 'SUBMITTED'
       OR target_revision.submitted_at IS NULL
       OR target_revision.submitted_by IS NULL THEN
      RAISE EXCEPTION 'VERIFY_REQUEST_POINTER_INVALID';
    END IF;
    IF OLD.current_submitted_revision_id IS NOT NULL THEN
      SELECT revision.revision_number INTO previous_revision_number
        FROM public.verify_quote_revisions revision
       WHERE revision.id = OLD.current_submitted_revision_id;
      IF previous_revision_number IS NULL
         OR target_revision.revision_number <= previous_revision_number THEN
        RAISE EXCEPTION 'VERIFY_REQUEST_POINTER_INVALID';
      END IF;
    END IF;
  END IF;
  IF (NEW.status = 'SUBMITTED' AND NEW.current_submitted_revision_id IS NULL)
     OR (NEW.status = 'DRAFT' AND NEW.current_submitted_revision_id IS NOT NULL)
     OR (NEW.status IN ('IN_REVIEW', 'COMPLETED') AND NEW.current_submitted_revision_id IS NULL) THEN
    RAISE EXCEPTION 'VERIFY_REQUEST_SUBMISSION_INVALID';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER verify_requests_lifecycle_only
  BEFORE UPDATE OR DELETE ON public.verify_requests
  FOR EACH ROW EXECUTE FUNCTION public.verify_request_lifecycle_only();

ALTER TABLE public.verify_requests DROP CONSTRAINT verify_requests_pointer_status_check;
ALTER TABLE public.verify_requests ADD CONSTRAINT verify_requests_pointer_status_check CHECK (
  (status <> 'DRAFT' OR current_submitted_revision_id IS NULL)
  AND (status NOT IN ('SUBMITTED', 'IN_REVIEW', 'COMPLETED') OR current_submitted_revision_id IS NOT NULL)
);

-- Section 13: QUEUED run cancels atomically with the request; a RUNNING run defers cancellation to IN_REVIEW instead.
CREATE OR REPLACE FUNCTION public.partner_verify_request_cancel(p_actor UUID, p_company UUID, p_request UUID, p_correlation TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE request_record RECORD; active_run_id UUID; active_run_status TEXT;
BEGIN
  IF NOT public.verify_partner_lifecycle_authorized(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_FORBIDDEN';
  END IF;
  SELECT * INTO request_record FROM public.verify_requests WHERE id = p_request AND company_id = p_company FOR UPDATE;
  IF NOT FOUND OR request_record.status NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_NOT_CANCELLABLE';
  END IF;

  IF request_record.current_submitted_revision_id IS NOT NULL THEN
    SELECT run.id, run.status INTO active_run_id, active_run_status
      FROM public.verify_runs run
     WHERE run.verify_quote_revision_id = request_record.current_submitted_revision_id
       AND run.status IN ('QUEUED', 'RUNNING')
     FOR UPDATE;
  END IF;

  IF active_run_id IS NOT NULL AND active_run_status = 'RUNNING' THEN
    UPDATE public.verify_requests SET status = 'IN_REVIEW', updated_at = now() WHERE id = p_request;
    INSERT INTO public.audit_logs(company_id, actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
    VALUES (p_company, p_actor, 'TENANT', 'verify.request.cancel_deferred_to_in_review', 'VerifyRequest', p_request,
      jsonb_build_object('organizationId', p_company, 'fromState', request_record.status, 'toState', 'IN_REVIEW', 'activeRunId', active_run_id),
      NULLIF(p_correlation, '')::UUID);
    RETURN;
  END IF;

  IF active_run_id IS NOT NULL AND active_run_status = 'QUEUED' THEN
    UPDATE public.verify_runs SET status = 'CANCELLED' WHERE id = active_run_id;
  END IF;

  UPDATE public.verify_requests SET status = 'CANCELLED', updated_at = now() WHERE id = p_request;
  INSERT INTO public.audit_logs(company_id, actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_company, p_actor, 'TENANT', 'verify.request.cancelled', 'VerifyRequest', p_request,
    jsonb_build_object('organizationId', p_company, 'fromState', request_record.status, 'toState', 'CANCELLED', 'cancelledRunId', active_run_id),
    NULLIF(p_correlation, '')::UUID);
END
$$;

-- Section 8/9: finalization on the CURRENT submitted revision completes an IN_REVIEW request; historical reruns never mutate request lifecycle.
CREATE OR REPLACE FUNCTION public.internal_verify_result_finalize(p_actor UUID, p_result UUID, p_correlation TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE run_id UUID; run_revision UUID; owning_request RECORD; request_completed BOOLEAN := false;
BEGIN
  IF NULLIF(current_setting('app.actor_id', true), '') IS DISTINCT FROM p_actor::TEXT OR NOT public.internal_has_capability(p_actor, 'verify.approver') THEN
    RAISE EXCEPTION 'VERIFY_APPROVER_FORBIDDEN';
  END IF;
  SELECT verify_run_id INTO run_id FROM public.verify_results WHERE id = p_result FOR UPDATE;
  UPDATE public.verify_results result SET status = 'FINAL', finalised_by = p_actor, finalised_at = now()
  WHERE result.id = p_result AND result.status = 'PREPARED'
    AND EXISTS (SELECT 1 FROM public.verify_runs run WHERE run.id = result.verify_run_id AND run.status = 'COMPLETED');
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFY_RESULT_NOT_FINALISABLE'; END IF;

  SELECT run.verify_quote_revision_id INTO run_revision FROM public.verify_runs run WHERE run.id = run_id;
  SELECT request_record.id, request_record.status, request_record.current_submitted_revision_id
    INTO owning_request
    FROM public.verify_requests request_record
    JOIN public.verify_quote_revisions revision ON revision.verify_request_id = request_record.id
   WHERE revision.id = run_revision
   FOR UPDATE OF request_record;

  IF owning_request.status = 'IN_REVIEW' AND owning_request.current_submitted_revision_id = run_revision THEN
    UPDATE public.verify_requests SET status = 'COMPLETED', updated_at = now() WHERE id = owning_request.id;
    request_completed := true;
  END IF;

  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, 'SCO_INTERNAL', 'verify.result.finalized', 'VerifyResult', p_result,
    jsonb_build_object('runId', run_id, 'outcome', 'FINAL', 'authorizationPath', 'verify.approver', 'requestCompleted', request_completed),
    NULLIF(p_correlation, '')::UUID);
END
$$;

-- Section 12/16: dedicated restricted-privilege roles for the new SYSTEM-executor Verify gateways.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_verify_gateway_owner') THEN
    CREATE ROLE sco_verify_gateway_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_verify_system_executor') THEN
    CREATE ROLE sco_verify_system_executor NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE sco_verify_gateway_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE sco_verify_system_executor NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

REVOKE ALL ON SCHEMA public FROM sco_verify_gateway_owner, sco_verify_system_executor;
GRANT USAGE ON SCHEMA public TO sco_verify_gateway_owner, sco_verify_system_executor;
GRANT CONNECT ON DATABASE sco_dev TO sco_verify_system_executor;

REVOKE ALL ON TABLE
  public.verify_requests, public.verify_quote_revisions, public.verify_quote_lines, public.verify_quote_line_adjustments,
  public.verify_quote_level_adjustments, public.verify_runs, public.verify_evidence_bindings, public.verify_results,
  public.verify_raw_review_grants, public.verify_raw_content_access_events, public.verify_run_line_scope,
  public.verify_line_results, public.verify_line_result_evidence, public.audit_logs
FROM sco_verify_system_executor;

-- The gateway-owner role holds only the exact table privileges its SECURITY DEFINER function bodies require
-- (definer functions execute with the OWNER's privileges, not the caller's), and it owns no table/schema/DDL rights itself.
GRANT SELECT, INSERT, UPDATE ON public.verify_runs TO sco_verify_gateway_owner;
GRANT SELECT, UPDATE ON public.verify_requests TO sco_verify_gateway_owner;
-- UPDATE is required (not just SELECT) because run creation takes SELECT ... FOR UPDATE row locks on the revision.
GRANT SELECT, UPDATE ON public.verify_quote_revisions TO sco_verify_gateway_owner;
GRANT SELECT ON public.verify_quote_lines, public.verify_quote_line_adjustments, public.verify_quote_level_adjustments TO sco_verify_gateway_owner;
GRANT SELECT, INSERT ON public.verify_run_line_scope, public.verify_line_results, public.verify_line_result_evidence, public.verify_evidence_bindings TO sco_verify_gateway_owner;
GRANT INSERT ON public.audit_logs TO sco_verify_gateway_owner;

-- verify_* tables FORCE row-level security even for a non-owner, non-BYPASSRLS role such as sco_verify_gateway_owner.
-- SYSTEM run orchestration is legitimately cross-tenant by design; isolation for this role is enforced by the narrow
-- EXECUTE grants on its gateway functions (below), not by per-row tenant filtering, so grant it a system-wide policy.
CREATE POLICY verify_quote_revisions_system ON public.verify_quote_revisions FOR ALL TO sco_verify_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY verify_requests_system ON public.verify_requests FOR ALL TO sco_verify_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY verify_quote_lines_system ON public.verify_quote_lines FOR ALL TO sco_verify_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY verify_quote_line_adjustments_system ON public.verify_quote_line_adjustments FOR ALL TO sco_verify_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY verify_quote_level_adjustments_system ON public.verify_quote_level_adjustments FOR ALL TO sco_verify_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY verify_runs_system ON public.verify_runs FOR ALL TO sco_verify_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY verify_evidence_bindings_system ON public.verify_evidence_bindings FOR ALL TO sco_verify_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY verify_run_line_scope_system ON public.verify_run_line_scope FOR ALL TO sco_verify_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY verify_line_results_system ON public.verify_line_results FOR ALL TO sco_verify_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY verify_line_result_evidence_system ON public.verify_line_result_evidence FOR ALL TO sco_verify_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY verify_gateway_owner_audit_insert ON public.audit_logs FOR INSERT TO sco_verify_gateway_owner WITH CHECK (true);
CREATE POLICY company_membership_system_read ON public."CompanyMembership" FOR SELECT TO sco_verify_gateway_owner USING (true);
CREATE POLICY membership_role_system_read ON public."MembershipRole" FOR SELECT TO sco_verify_gateway_owner USING (true);
CREATE POLICY role_permission_system_read ON public."RolePermission" FOR SELECT TO sco_verify_gateway_owner USING (true);

-- internal_has_capability (Batch 1-B, SECURITY INVOKER) runs as whichever role is current_user; called from within our
-- SECURITY DEFINER wrapper that role is sco_verify_gateway_owner, so it needs read access to the RBAC tables it joins.
GRANT SELECT ON public."CompanyMembership", public."Company", public."MembershipRole", public."RolePermission", public."Permission" TO sco_verify_gateway_owner;
GRANT EXECUTE ON FUNCTION public.internal_has_capability(UUID, TEXT) TO sco_verify_gateway_owner;
GRANT EXECUTE ON FUNCTION public.internal_verify_result_prepare(UUID, UUID, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, UUID, TEXT) TO sco_verify_gateway_owner;

-- SYSTEM executor: run lifecycle (create/start/complete/fail/retry via retry_of_run_id), evidence binding, immutable line-result creation.
-- P1 remediation: no p_actor parameter — callers cannot attribute SYSTEM actions to an arbitrary user; every row/audit
-- entry created by these gateways is attributed to the fixed public.verify_system_actor_id() identity.
CREATE FUNCTION public.internal_verify_system_run_create(p_revision UUID, p_methodology_version TEXT, p_evidence_fingerprint TEXT, p_retry_of_run_id UUID, p_correlation TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE revision_record RECORD; run_id UUID := gen_random_uuid(); is_historical BOOLEAN; system_actor UUID := public.verify_system_actor_id();
BEGIN
  IF btrim(COALESCE(p_methodology_version, '')) = '' OR btrim(COALESCE(p_evidence_fingerprint, '')) = '' THEN
    RAISE EXCEPTION 'VERIFY_RUN_CREATE_INVALID';
  END IF;
  SELECT revision.id, revision.status, revision.verify_request_id INTO revision_record
    FROM public.verify_quote_revisions revision WHERE revision.id = p_revision FOR UPDATE;
  IF NOT FOUND OR revision_record.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'VERIFY_RUN_REVISION_NOT_SUBMITTED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.verify_runs existing WHERE existing.verify_quote_revision_id = p_revision AND existing.status IN ('QUEUED', 'RUNNING')) THEN
    RAISE EXCEPTION 'VERIFY_RUN_ALREADY_ACTIVE';
  END IF;

  INSERT INTO public.verify_runs(id, verify_quote_revision_id, retry_of_run_id, methodology_version, evidence_fingerprint, created_by)
  VALUES (run_id, p_revision, p_retry_of_run_id, p_methodology_version, p_evidence_fingerprint, system_actor);

  -- P1 remediation: capture every input later coverage/value computation needs (currency, quantity, unit price,
  -- zero-value state, attributable line-level adjustments) immutably now; result preparation must never read
  -- mutable verify_quote_lines/verify_quote_line_adjustments again. EXCLUDED results for non-ready lines are NOT
  -- created here (that would happen while the run is still QUEUED); they are created at run start, once RUNNING.
  INSERT INTO public.verify_run_line_scope(
    verify_run_id, verify_quote_line_id, is_applicable, captured_readiness_state, captured_readiness_reason,
    captured_currency_code, captured_quantity, captured_unit_price, captured_is_real_zero_value, captured_attributable_value
  )
  SELECT run_id, line.id, (line.is_price_bearing AND NOT line.is_informational), line.readiness_state, line.readiness_reason,
    line.currency_code, line.quantity, line.unit_price, line.is_real_zero_value,
    COALESCE(line.quantity * line.unit_price, 0)
      + COALESCE((SELECT sum(adjustment.amount) FROM public.verify_quote_line_adjustments adjustment WHERE adjustment.verify_quote_line_id = line.id), 0)
    FROM public.verify_quote_lines line WHERE line.verify_quote_revision_id = p_revision;

  SELECT (request_record.current_submitted_revision_id IS DISTINCT FROM p_revision) INTO is_historical
    FROM public.verify_requests request_record WHERE request_record.id = revision_record.verify_request_id;

  INSERT INTO public.audit_logs(company_id, actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  SELECT request_record.company_id, system_actor, 'SCO_INTERNAL', 'verify.run.created', 'VerifyRun', run_id,
    jsonb_build_object('revisionId', p_revision, 'methodologyVersion', p_methodology_version, 'retryOfRunId', p_retry_of_run_id, 'historicalRerun', is_historical),
    NULLIF(p_correlation, '')::UUID
    FROM public.verify_requests request_record WHERE request_record.id = revision_record.verify_request_id;

  RETURN run_id;
END
$$;

-- P2 remediation: consistent request-before-run lock ordering across every Verify lifecycle gateway (matches
-- partner_verify_request_cancel), so start/complete/fail/cancel can never deadlock against each other.
CREATE FUNCTION public.internal_verify_system_run_start(p_run UUID, p_correlation TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_revision UUID; owning_request RECORD; system_actor UUID := public.verify_system_actor_id();
BEGIN
  SELECT verify_quote_revision_id INTO v_revision FROM public.verify_runs WHERE id = p_run;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFY_RUN_NOT_AVAILABLE'; END IF;

  SELECT request_record.id, request_record.status, request_record.current_submitted_revision_id
    INTO owning_request
    FROM public.verify_requests request_record
    JOIN public.verify_quote_revisions revision ON revision.verify_request_id = request_record.id
   WHERE revision.id = v_revision
   FOR UPDATE OF request_record;

  UPDATE public.verify_runs SET status = 'RUNNING' WHERE id = p_run AND status = 'QUEUED';
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFY_RUN_NOT_STARTABLE'; END IF;

  -- P1 remediation: pre-run EXCLUDED results are created here (now that the run is RUNNING), not at QUEUED creation time.
  INSERT INTO public.verify_line_results(verify_run_id, verify_quote_line_id, outcome, exclusion_reason, created_by)
  SELECT p_run, scope.verify_quote_line_id, 'EXCLUDED', COALESCE(scope.captured_readiness_reason, 'NEEDS_COMPLETION_AT_RUN_CAPTURE'), system_actor
    FROM public.verify_run_line_scope scope
   WHERE scope.verify_run_id = p_run AND scope.is_applicable AND scope.captured_readiness_state IN ('NEEDS_COMPLETION', 'NOT_VERIFIABLE');

  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (system_actor, 'SCO_INTERNAL', 'verify.run.started', 'VerifyRun', p_run,
    jsonb_build_object('revisionId', v_revision), NULLIF(p_correlation, '')::UUID);
END
$$;

-- Section 8/9/13: a normal (non-cancelled) run reaching COMPLETED is what moves a SUBMITTED request into IN_REVIEW,
-- ready for VERIFY_APPROVER finalization; a historical rerun (not the request's current submitted revision) never mutates request lifecycle.
-- P2 remediation: request-before-run lock ordering (see run_start above).
CREATE FUNCTION public.internal_verify_system_run_complete(p_run UUID, p_correlation TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_revision UUID; incomplete_count INT; owning_request RECORD; moved_to_in_review BOOLEAN := false; system_actor UUID := public.verify_system_actor_id();
BEGIN
  SELECT verify_quote_revision_id INTO v_revision FROM public.verify_runs WHERE id = p_run;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFY_RUN_NOT_AVAILABLE'; END IF;

  SELECT request_record.id, request_record.status, request_record.current_submitted_revision_id
    INTO owning_request
    FROM public.verify_requests request_record
    JOIN public.verify_quote_revisions revision ON revision.verify_request_id = request_record.id
   WHERE revision.id = v_revision
   FOR UPDATE OF request_record;

  PERFORM 1 FROM public.verify_runs WHERE id = p_run FOR UPDATE;

  SELECT count(*) INTO incomplete_count
    FROM public.verify_run_line_scope scope
   WHERE scope.verify_run_id = p_run AND scope.is_applicable
     AND NOT EXISTS (SELECT 1 FROM public.verify_line_results lr WHERE lr.verify_run_id = scope.verify_run_id AND lr.verify_quote_line_id = scope.verify_quote_line_id);
  IF incomplete_count > 0 THEN
    RAISE EXCEPTION 'VERIFY_RUN_LINE_RESULTS_INCOMPLETE';
  END IF;
  UPDATE public.verify_runs SET status = 'COMPLETED' WHERE id = p_run AND status = 'RUNNING';
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFY_RUN_NOT_COMPLETABLE'; END IF;

  IF owning_request.status = 'SUBMITTED' AND owning_request.current_submitted_revision_id = v_revision THEN
    UPDATE public.verify_requests SET status = 'IN_REVIEW', updated_at = now() WHERE id = owning_request.id;
    moved_to_in_review := true;
  END IF;

  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (system_actor, 'SCO_INTERNAL', 'verify.run.completed', 'VerifyRun', p_run,
    jsonb_build_object('outcome', 'COMPLETED', 'requestMovedToInReview', moved_to_in_review), NULLIF(p_correlation, '')::UUID);
END
$$;

CREATE FUNCTION public.internal_verify_system_run_fail(p_run UUID, p_reason TEXT, p_correlation TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE system_actor UUID := public.verify_system_actor_id();
BEGIN
  UPDATE public.verify_runs SET status = 'FAILED' WHERE id = p_run AND status = 'RUNNING';
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFY_RUN_NOT_FAILABLE'; END IF;
  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (system_actor, 'SCO_INTERNAL', 'verify.run.failed', 'VerifyRun', p_run, jsonb_build_object('outcome', 'FAILED', 'reason', p_reason), NULLIF(p_correlation, '')::UUID);
END
$$;

CREATE FUNCTION public.internal_verify_system_evidence_bind(
  p_run UUID, p_evidence_type TEXT, p_source_identity TEXT, p_source_version_identity TEXT,
  p_document UUID, p_document_version UUID, p_effective_date DATE, p_observed_at TIMESTAMPTZ,
  p_freshness JSONB, p_approval_state TEXT, p_comparability JSONB, p_confidentiality_class TEXT,
  p_integrity_reference TEXT, p_correlation TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE binding_id UUID := gen_random_uuid(); run_status TEXT; system_actor UUID := public.verify_system_actor_id();
BEGIN
  -- P1 remediation: evidence may only be bound while the run is actively RUNNING (row-locked state verification).
  SELECT status INTO run_status FROM public.verify_runs WHERE id = p_run FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFY_RUN_NOT_AVAILABLE'; END IF;
  IF run_status <> 'RUNNING' THEN RAISE EXCEPTION 'VERIFY_EVIDENCE_BIND_NOT_ALLOWED'; END IF;
  INSERT INTO public.verify_evidence_bindings(
    id, verify_run_id, evidence_type, source_identity, source_version_identity, document_id, document_version_id,
    effective_date, observed_at, freshness_metadata, approval_state, comparability_metadata, confidentiality_class,
    integrity_version_reference, created_by
  ) VALUES (
    binding_id, p_run, p_evidence_type, p_source_identity, p_source_version_identity, p_document, p_document_version,
    p_effective_date, p_observed_at, COALESCE(p_freshness, '{}'::jsonb), p_approval_state, COALESCE(p_comparability, '{}'::jsonb),
    p_confidentiality_class, p_integrity_reference, system_actor
  );
  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (system_actor, 'SCO_INTERNAL', 'verify.evidence.bound', 'VerifyEvidenceBinding', binding_id,
    jsonb_build_object('runId', p_run, 'evidenceType', p_evidence_type), NULLIF(p_correlation, '')::UUID);
  RETURN binding_id;
END
$$;

CREATE FUNCTION public.internal_verify_system_line_result_record(
  p_run UUID, p_line UUID, p_outcome TEXT, p_reason TEXT, p_evidence_binding_ids UUID[], p_correlation TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE result_id UUID := gen_random_uuid(); evidence_id UUID; run_status TEXT; system_actor UUID := public.verify_system_actor_id();
BEGIN
  IF p_outcome NOT IN ('VERIFIED', 'INSUFFICIENT_EVIDENCE') THEN
    RAISE EXCEPTION 'VERIFY_LINE_RESULT_OUTCOME_INVALID';
  END IF;
  -- P1 remediation: a line result may only be recorded while the run is actively RUNNING (row-locked state verification).
  SELECT status INTO run_status FROM public.verify_runs WHERE id = p_run FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFY_RUN_NOT_AVAILABLE'; END IF;
  IF run_status <> 'RUNNING' THEN RAISE EXCEPTION 'VERIFY_LINE_RESULT_RUN_NOT_RUNNING'; END IF;
  INSERT INTO public.verify_line_results(id, verify_run_id, verify_quote_line_id, outcome, exclusion_reason, created_by)
  VALUES (result_id, p_run, p_line, p_outcome, NULL, system_actor);

  IF p_evidence_binding_ids IS NOT NULL THEN
    FOREACH evidence_id IN ARRAY p_evidence_binding_ids LOOP
      INSERT INTO public.verify_line_result_evidence(verify_line_result_id, verify_evidence_binding_id)
      VALUES (result_id, evidence_id);
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (system_actor, 'SCO_INTERNAL', 'verify.line_result.recorded', 'VerifyLineResult', result_id,
    jsonb_build_object('runId', p_run, 'lineId', p_line, 'outcome', p_outcome), NULLIF(p_correlation, '')::UUID);
  RETURN result_id;
END
$$;

-- Analyst-facing: computes deterministic coverage/classification from immutable line results and delegates
-- the actual insert to the existing (Batch 1-B) internal_verify_result_prepare gateway.
-- OWNER CONTRACT: classification is never based on positive monetary value; INSUFFICIENT_FOR_RESULT means
-- no applicable price-bearing line is VERIFIED, and an all-real-zero-value fully VERIFIED quote is FULL.
CREATE FUNCTION public.internal_verify_result_prepare_computed(p_actor UUID, p_run UUID, p_supersedes UUID, p_correlation TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  run_record RECORD;
  per_currency JSONB;
  total_verified INT;
  total_excluded_or_insufficient INT;
  classification TEXT;
  exclusions JSONB;
  result_id UUID;
BEGIN
  IF NULLIF(current_setting('app.actor_id', true), '') IS DISTINCT FROM p_actor::TEXT
     OR NOT public.internal_has_capability(p_actor, 'verify.analyst') THEN
    RAISE EXCEPTION 'VERIFY_ANALYST_FORBIDDEN';
  END IF;
  SELECT id, status INTO run_record FROM public.verify_runs WHERE id = p_run;
  IF NOT FOUND OR run_record.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'VERIFY_RESULT_NOT_PREPARABLE';
  END IF;

  -- P1 remediation: computed EXCLUSIVELY from immutable captured run-scope state (verify_run_line_scope /
  -- verify_line_results); never reads current/mutable verify_quote_lines or verify_quote_line_adjustments, so
  -- historical coverage cannot be altered by any later drift in the source quote rows.
  -- P2 remediation: a legitimately zero value/line denominator is represented deterministically as 0, not NULL.
  SELECT jsonb_object_agg(currency_rows.currency_code, currency_rows.currency_stats) INTO per_currency
    FROM (
      SELECT scope.captured_currency_code AS currency_code,
        jsonb_build_object(
          'totalLineCount', count(*),
          'verifiedLineCount', count(*) FILTER (WHERE lr.outcome = 'VERIFIED'),
          'excludedLineCount', count(*) FILTER (WHERE lr.outcome = 'EXCLUDED'),
          'insufficientEvidenceLineCount', count(*) FILTER (WHERE lr.outcome = 'INSUFFICIENT_EVIDENCE'),
          'lineCoveragePercent', CASE WHEN count(*) = 0 THEN 0 ELSE ROUND(100.0 * count(*) FILTER (WHERE lr.outcome = 'VERIFIED') / count(*), 4) END,
          'totalValue', COALESCE(sum(scope.captured_attributable_value), 0),
          'verifiedValue', COALESCE(sum(scope.captured_attributable_value) FILTER (WHERE lr.outcome = 'VERIFIED'), 0),
          'valueCoveragePercent', CASE WHEN COALESCE(sum(scope.captured_attributable_value), 0) = 0 THEN 0
            ELSE ROUND(100.0 * COALESCE(sum(scope.captured_attributable_value) FILTER (WHERE lr.outcome = 'VERIFIED'), 0) / sum(scope.captured_attributable_value), 4) END
        ) AS currency_stats
      FROM public.verify_run_line_scope scope
      JOIN public.verify_line_results lr ON lr.verify_run_id = scope.verify_run_id AND lr.verify_quote_line_id = scope.verify_quote_line_id
      WHERE scope.verify_run_id = p_run AND scope.is_applicable
      GROUP BY scope.captured_currency_code
    ) currency_rows;

  SELECT count(*) FILTER (WHERE lr.outcome = 'VERIFIED'),
         count(*) FILTER (WHERE lr.outcome IN ('EXCLUDED', 'INSUFFICIENT_EVIDENCE'))
    INTO total_verified, total_excluded_or_insufficient
    FROM public.verify_run_line_scope scope
    JOIN public.verify_line_results lr ON lr.verify_run_id = scope.verify_run_id AND lr.verify_quote_line_id = scope.verify_quote_line_id
   WHERE scope.verify_run_id = p_run AND scope.is_applicable;

  IF COALESCE(total_verified, 0) = 0 THEN
    classification := 'INSUFFICIENT_FOR_RESULT';
  ELSIF COALESCE(total_excluded_or_insufficient, 0) > 0 THEN
    classification := 'PARTIAL';
  ELSE
    classification := 'FULL';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('lineId', lr.verify_quote_line_id, 'outcome', lr.outcome, 'reason', lr.exclusion_reason))
    INTO exclusions
    FROM public.verify_line_results lr
   WHERE lr.verify_run_id = p_run AND lr.outcome IN ('EXCLUDED', 'INSUFFICIENT_EVIDENCE');

  result_id := public.internal_verify_result_prepare(
    p_actor, p_run, classification, '{}'::jsonb, COALESCE(per_currency, '{}'::jsonb), '{}'::jsonb, '{}'::jsonb,
    jsonb_build_object('exclusions', COALESCE(exclusions, '[]'::jsonb)), p_supersedes, p_correlation
  );
  RETURN result_id;
END
$$;

ALTER FUNCTION public.internal_verify_system_run_create(UUID, TEXT, TEXT, UUID, TEXT) OWNER TO sco_verify_gateway_owner;
ALTER FUNCTION public.internal_verify_system_run_start(UUID, TEXT) OWNER TO sco_verify_gateway_owner;
ALTER FUNCTION public.internal_verify_system_run_complete(UUID, TEXT) OWNER TO sco_verify_gateway_owner;
ALTER FUNCTION public.internal_verify_system_run_fail(UUID, TEXT, TEXT) OWNER TO sco_verify_gateway_owner;
ALTER FUNCTION public.internal_verify_system_evidence_bind(UUID, TEXT, TEXT, TEXT, UUID, UUID, DATE, TIMESTAMPTZ, JSONB, TEXT, JSONB, TEXT, TEXT, TEXT) OWNER TO sco_verify_gateway_owner;
ALTER FUNCTION public.internal_verify_system_line_result_record(UUID, UUID, TEXT, TEXT, UUID[], TEXT) OWNER TO sco_verify_gateway_owner;
ALTER FUNCTION public.internal_verify_result_prepare_computed(UUID, UUID, UUID, TEXT) OWNER TO sco_verify_gateway_owner;

REVOKE ALL ON FUNCTION
  public.internal_verify_system_run_create(UUID, TEXT, TEXT, UUID, TEXT),
  public.internal_verify_system_run_start(UUID, TEXT),
  public.internal_verify_system_run_complete(UUID, TEXT),
  public.internal_verify_system_run_fail(UUID, TEXT, TEXT),
  public.internal_verify_system_evidence_bind(UUID, TEXT, TEXT, TEXT, UUID, UUID, DATE, TIMESTAMPTZ, JSONB, TEXT, JSONB, TEXT, TEXT, TEXT),
  public.internal_verify_system_line_result_record(UUID, UUID, TEXT, TEXT, UUID[], TEXT),
  public.internal_verify_result_prepare_computed(UUID, UUID, UUID, TEXT)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.internal_verify_system_run_create(UUID, TEXT, TEXT, UUID, TEXT),
  public.internal_verify_system_run_start(UUID, TEXT),
  public.internal_verify_system_run_complete(UUID, TEXT),
  public.internal_verify_system_run_fail(UUID, TEXT, TEXT),
  public.internal_verify_system_evidence_bind(UUID, TEXT, TEXT, TEXT, UUID, UUID, DATE, TIMESTAMPTZ, JSONB, TEXT, JSONB, TEXT, TEXT, TEXT),
  public.internal_verify_system_line_result_record(UUID, UUID, TEXT, TEXT, UUID[], TEXT)
TO sco_verify_system_executor;

GRANT EXECUTE ON FUNCTION public.internal_verify_result_prepare_computed(UUID, UUID, UUID, TEXT) TO sco_internal_executor;
