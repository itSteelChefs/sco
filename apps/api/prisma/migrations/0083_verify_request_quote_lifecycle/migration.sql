ALTER TABLE public.verify_requests
  ADD COLUMN current_submitted_revision_id UUID;

ALTER TABLE public.verify_quote_revisions
  ADD COLUMN predecessor_revision_id UUID REFERENCES public.verify_quote_revisions(id) ON DELETE RESTRICT,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED')),
  ADD COLUMN commercial_terms JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN idempotency_key TEXT,
  ADD COLUMN submitted_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  ADD COLUMN submitted_at TIMESTAMPTZ,
  ADD CONSTRAINT verify_quote_revisions_request_id_id_unique UNIQUE (id, verify_request_id),
  ADD CONSTRAINT verify_quote_revisions_request_idempotency_unique UNIQUE (verify_request_id, idempotency_key),
  ADD CONSTRAINT verify_quote_revisions_submission_fields_check CHECK (
    (status = 'DRAFT' AND submitted_by IS NULL AND submitted_at IS NULL)
    OR (status = 'SUBMITTED' AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL)
  ),
  ADD CONSTRAINT verify_quote_revisions_predecessor_check CHECK (predecessor_revision_id IS NULL OR predecessor_revision_id <> id);

ALTER TABLE public.verify_quote_lines
  ADD COLUMN item_description TEXT;

ALTER TABLE public.verify_requests
  ADD CONSTRAINT verify_requests_current_submitted_revision_same_request_fk
  FOREIGN KEY (current_submitted_revision_id, id)
  REFERENCES public.verify_quote_revisions(id, verify_request_id)
  ON DELETE RESTRICT,
  ADD CONSTRAINT verify_requests_pointer_status_check CHECK (
    (status <> 'DRAFT' OR current_submitted_revision_id IS NULL)
    AND (status <> 'SUBMITTED' OR current_submitted_revision_id IS NOT NULL)
  );

CREATE INDEX verify_requests_current_submitted_revision_idx
  ON public.verify_requests(current_submitted_revision_id)
  WHERE current_submitted_revision_id IS NOT NULL;

INSERT INTO public."Permission"(id, code, description)
VALUES (gen_random_uuid(), 'partner_verify.write', 'Create, revise, submit, cancel, and complete Partner Verify request input')
ON CONFLICT(code) DO NOTHING;

CREATE FUNCTION public.partner_verify_write_allowed(p_actor UUID, p_company UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public."User" user_record
      JOIN public."CompanyMembership" membership
        ON membership."userId" = user_record.id
       AND membership."companyId" = p_company
       AND membership.status = 'ACTIVE'
      JOIN public."Company" company
        ON company.id = membership."companyId"
       AND company.type = 'PARTNER'
       AND company.status = 'ACTIVE'
      JOIN public."MembershipRole" membership_role ON membership_role.membership_id = membership.id
      JOIN public."RolePermission" role_permission ON role_permission.role_id = membership_role.role_id
      JOIN public."Permission" permission ON permission.id = role_permission.permission_id
     WHERE user_record.id = p_actor
       AND user_record.status = 'ACTIVE'
       AND permission.code = 'partner_verify.write'
  )
$$;

CREATE FUNCTION public.verify_partner_lifecycle_authorized(p_actor UUID, p_company UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT current_setting('app.actor_id', true) = p_actor::TEXT
     AND current_setting('app.tenant_id', true) = p_company::TEXT
     AND public.partner_verify_write_allowed(p_actor, p_company)
$$;

-- Single source of truth for READY_FOR_VERIFICATION; presence semantics keep real zero-value lines eligible.
CREATE FUNCTION public.verify_quote_line_ready_eligible(p_line UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.verify_quote_lines line
     WHERE line.id = p_line
       AND line.is_price_bearing
       AND NOT line.is_informational
       AND (line.product_identity_id IS NOT NULL OR btrim(COALESCE(line.item_description, '')) <> '')
       AND line.quantity IS NOT NULL
       AND line.quantity > 0
       AND line.unit_price IS NOT NULL
       AND btrim(COALESCE(line.currency_code, '')) <> ''
       AND EXISTS (
         SELECT 1 FROM public.unit_definitions unit_record
          WHERE unit_record.id = line.unit_id AND unit_record.active
       )
  )
$$;

DROP TRIGGER verify_quote_revisions_immutable ON public.verify_quote_revisions;

CREATE FUNCTION public.verify_quote_revision_lifecycle_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.verify_request_id IS DISTINCT FROM OLD.verify_request_id
     OR NEW.predecessor_revision_id IS DISTINCT FROM OLD.predecessor_revision_id
     OR NEW.revision_number IS DISTINCT FROM OLD.revision_number
     OR NEW.submitted_currencies IS DISTINCT FROM OLD.submitted_currencies
     OR NEW.commercial_terms IS DISTINCT FROM OLD.commercial_terms
     OR NEW.raw_content_document_id IS DISTINCT FROM OLD.raw_content_document_id
     OR NEW.raw_content_version_id IS DISTINCT FROM OLD.raw_content_version_id
     OR NEW.input_fingerprint IS DISTINCT FROM OLD.input_fingerprint
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NOT (
       OLD.status = 'DRAFT'
       AND NEW.status = 'SUBMITTED'
       AND NEW.submitted_by IS NOT NULL
       AND NEW.submitted_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'VERIFY_QUOTE_REVISION_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER verify_quote_revisions_lifecycle_only
  BEFORE UPDATE OR DELETE ON public.verify_quote_revisions
  FOR EACH ROW EXECUTE FUNCTION public.verify_quote_revision_lifecycle_only();

CREATE FUNCTION public.verify_request_lifecycle_only()
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
       OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('SUBMITTED', 'CANCELLED'))
     ) THEN
    RAISE EXCEPTION 'VERIFY_REQUEST_IMMUTABLE';
  END IF;
  -- The pointer is lifecycle state, not a mutable revision reference: it may only advance,
  -- and only onto an already durably submitted revision of this same request.
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
     OR (NEW.status = 'DRAFT' AND NEW.current_submitted_revision_id IS NOT NULL) THEN
    RAISE EXCEPTION 'VERIFY_REQUEST_SUBMISSION_INVALID';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER verify_requests_lifecycle_only
  BEFORE UPDATE OR DELETE ON public.verify_requests
  FOR EACH ROW EXECUTE FUNCTION public.verify_request_lifecycle_only();

DROP TRIGGER verify_quote_lines_transition_only ON public.verify_quote_lines;

CREATE OR REPLACE FUNCTION public.verify_quote_line_transition_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.verify_quote_revision_id IS DISTINCT FROM OLD.verify_quote_revision_id
     OR NEW.line_number IS DISTINCT FROM OLD.line_number
     OR NEW.line_reference IS DISTINCT FROM OLD.line_reference
     OR NEW.item_description IS DISTINCT FROM OLD.item_description
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
     OR NOT ((OLD.readiness_state = 'NEEDS_COMPLETION' AND NEW.readiness_state IN ('READY_FOR_VERIFICATION', 'NOT_VERIFIABLE')) OR (OLD.readiness_state = 'READY_FOR_VERIFICATION' AND NEW.readiness_state = 'NOT_VERIFIABLE'))
     OR (NEW.readiness_state = 'NOT_VERIFIABLE' AND btrim(COALESCE(NEW.readiness_reason, '')) = '')
     OR EXISTS (
       SELECT 1
         FROM public.verify_runs run_record
         JOIN public.verify_results result_record ON result_record.verify_run_id = run_record.id
        WHERE run_record.verify_quote_revision_id = OLD.verify_quote_revision_id
          AND result_record.status IN ('FINAL', 'SUPERSEDED')
     ) THEN
    RAISE EXCEPTION 'VERIFY_QUOTE_LINE_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER verify_quote_lines_transition_only
  BEFORE UPDATE OR DELETE ON public.verify_quote_lines
  FOR EACH ROW EXECUTE FUNCTION public.verify_quote_line_transition_only();

CREATE FUNCTION public.partner_verify_request_create(p_actor UUID, p_company UUID, p_correlation TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE request_id UUID := gen_random_uuid();
BEGIN
  IF NOT public.verify_partner_lifecycle_authorized(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_FORBIDDEN';
  END IF;
  INSERT INTO public.verify_requests(id, company_id, requested_by)
  VALUES (request_id, p_company, p_actor);
  INSERT INTO public.audit_logs(company_id, actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_company, p_actor, 'TENANT', 'verify.request.created', 'VerifyRequest', request_id,
    jsonb_build_object('organizationId', p_company, 'status', 'DRAFT'), NULLIF(p_correlation, '')::UUID);
  RETURN request_id;
END
$$;

CREATE FUNCTION public.partner_verify_revision_create(
  p_actor UUID, p_company UUID, p_request UUID, p_expected_predecessor UUID,
  p_submitted_currencies TEXT[], p_commercial_terms JSONB, p_document UUID, p_document_version UUID,
  p_input_fingerprint TEXT, p_lines JSONB, p_idempotency_key TEXT, p_correlation TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE request_record RECORD; existing_record RECORD; revision_id UUID := gen_random_uuid(); revision_number INTEGER; line_record JSONB; line_count INTEGER := 0;
  idempotency TEXT := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
BEGIN
  IF NOT public.verify_partner_lifecycle_authorized(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_FORBIDDEN';
  END IF;
  IF idempotency IS NULL OR btrim(COALESCE(p_input_fingerprint, '')) = '' OR p_submitted_currencies IS NULL OR cardinality(p_submitted_currencies) = 0 OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'VERIFY_QUOTE_REVISION_INVALID';
  END IF;
  SELECT * INTO request_record FROM public.verify_requests WHERE id = p_request AND company_id = p_company FOR UPDATE;
  IF NOT FOUND OR request_record.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_NOT_AVAILABLE';
  END IF;
  SELECT * INTO existing_record FROM public.verify_quote_revisions WHERE verify_request_id = p_request AND idempotency_key = idempotency;
  IF FOUND THEN
    IF existing_record.predecessor_revision_id IS DISTINCT FROM p_expected_predecessor OR existing_record.input_fingerprint <> p_input_fingerprint OR existing_record.submitted_currencies IS DISTINCT FROM p_submitted_currencies THEN
      RAISE EXCEPTION 'VERIFY_QUOTE_REVISION_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN existing_record.id;
  END IF;
  SELECT revision.id, revision.revision_number INTO existing_record
    FROM public.verify_quote_revisions revision
   WHERE revision.verify_request_id = p_request
   ORDER BY revision.revision_number DESC
   LIMIT 1
   FOR UPDATE;
  IF (NOT FOUND AND p_expected_predecessor IS NOT NULL) OR (FOUND AND existing_record.id IS DISTINCT FROM p_expected_predecessor) THEN
    RAISE EXCEPTION 'VERIFY_QUOTE_REVISION_STALE_PREDECESSOR';
  END IF;
  revision_number := COALESCE(existing_record.revision_number, 0) + 1;
  INSERT INTO public.verify_quote_revisions(
    id, verify_request_id, predecessor_revision_id, revision_number, submitted_currencies, commercial_terms,
    raw_content_document_id, raw_content_version_id, input_fingerprint, idempotency_key, created_by
  ) VALUES (
    revision_id, p_request, p_expected_predecessor, revision_number, p_submitted_currencies, COALESCE(p_commercial_terms, '{}'::jsonb),
    p_document, p_document_version, p_input_fingerprint, idempotency, p_actor
  );
  FOR line_record IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.verify_quote_lines(
      verify_quote_revision_id, line_number, line_reference, item_description, product_identity_id, unit_id,
      quantity, currency_code, unit_price, is_price_bearing, is_informational, is_real_zero_value, readiness_state, suspected_duplicate
    ) VALUES (
      revision_id, (line_record->>'lineNumber')::INTEGER, NULLIF(btrim(line_record->>'lineReference'), ''),
      NULLIF(btrim(line_record->>'itemDescription'), ''), NULLIF(line_record->>'productIdentityId', '')::UUID,
      NULLIF(line_record->>'unitId', '')::UUID, NULLIF(line_record->>'quantity', '')::NUMERIC,
      NULLIF(btrim(line_record->>'currencyCode'), ''), NULLIF(line_record->>'unitPrice', '')::NUMERIC,
      COALESCE((line_record->>'isPriceBearing')::BOOLEAN, true), COALESCE((line_record->>'isInformational')::BOOLEAN, false),
      COALESCE((line_record->>'isRealZeroValue')::BOOLEAN, false), 'NEEDS_COMPLETION', COALESCE((line_record->>'suspectedDuplicate')::BOOLEAN, false)
    );
    line_count := line_count + 1;
  END LOOP;
  IF line_count <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'VERIFY_QUOTE_REVISION_INVALID';
  END IF;
  INSERT INTO public.audit_logs(company_id, actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_company, p_actor, 'TENANT', CASE WHEN p_expected_predecessor IS NULL THEN 'verify.quote_revision.created' ELSE 'verify.quote_revision.material_revision_created' END,
    'VerifyQuoteRevision', revision_id,
    jsonb_build_object('organizationId', p_company, 'requestId', p_request, 'predecessorRevisionId', p_expected_predecessor, 'revisionNumber', revision_number, 'idempotencyKey', idempotency),
    NULLIF(p_correlation, '')::UUID);
  RETURN revision_id;
END
$$;

CREATE FUNCTION public.partner_verify_line_readiness_set(p_actor UUID, p_company UUID, p_line UUID, p_next TEXT, p_reason TEXT, p_correlation TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE line_record RECORD; owning_request UUID; owning_revision UUID; request_status TEXT; revision_status TEXT;
  reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF NOT public.verify_partner_lifecycle_authorized(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_FORBIDDEN';
  END IF;
  SELECT revision.verify_request_id, revision.id
    INTO owning_request, owning_revision
    FROM public.verify_quote_lines line
    JOIN public.verify_quote_revisions revision ON revision.id = line.verify_quote_revision_id
   WHERE line.id = p_line;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_NOT_AVAILABLE';
  END IF;
  -- Lock request -> revision -> line so cancellation and readiness cannot interleave invalidly.
  SELECT request_record.status INTO request_status
    FROM public.verify_requests request_record
   WHERE request_record.id = owning_request AND request_record.company_id = p_company
   FOR UPDATE;
  IF NOT FOUND OR request_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_NOT_AVAILABLE';
  END IF;
  SELECT revision.status INTO revision_status
    FROM public.verify_quote_revisions revision
   WHERE revision.id = owning_revision AND revision.verify_request_id = owning_request
   FOR UPDATE;
  IF NOT FOUND OR revision_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_NOT_AVAILABLE';
  END IF;
  SELECT * INTO line_record FROM public.verify_quote_lines WHERE id = p_line FOR UPDATE;
  IF NOT FOUND OR line_record.verify_quote_revision_id <> owning_revision THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_NOT_AVAILABLE';
  END IF;
  IF line_record.readiness_state = p_next THEN
    RETURN;
  END IF;
  IF p_next = 'READY_FOR_VERIFICATION' AND NOT public.verify_quote_line_ready_eligible(p_line) THEN
    RAISE EXCEPTION 'VERIFY_QUOTE_LINE_NOT_READY';
  END IF;
  IF p_next = 'NOT_VERIFIABLE' AND reason IS NULL THEN
    RAISE EXCEPTION 'VERIFY_QUOTE_LINE_NOT_VERIFIABLE_REASON_REQUIRED';
  END IF;
  UPDATE public.verify_quote_lines
     SET readiness_state = p_next,
         readiness_reason = CASE WHEN p_next = 'NOT_VERIFIABLE' THEN reason ELSE NULL END
   WHERE id = p_line;
  INSERT INTO public.audit_logs(company_id, actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_company, p_actor, 'TENANT', 'verify.quote_line.readiness_changed', 'VerifyQuoteLine', p_line,
    jsonb_build_object('organizationId', p_company, 'requestId', owning_request, 'revisionId', owning_revision, 'fromState', line_record.readiness_state, 'toState', p_next, 'reason', reason),
    NULLIF(p_correlation, '')::UUID);
END
$$;

CREATE FUNCTION public.partner_verify_request_submit(p_actor UUID, p_company UUID, p_request UUID, p_revision UUID, p_correlation TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE request_record RECORD; revision_record RECORD;
BEGIN
  IF NOT public.verify_partner_lifecycle_authorized(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_FORBIDDEN';
  END IF;
  SELECT * INTO request_record FROM public.verify_requests WHERE id = p_request AND company_id = p_company FOR UPDATE;
  IF NOT FOUND OR request_record.status NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_NOT_SUBMITTABLE';
  END IF;
  SELECT * INTO revision_record FROM public.verify_quote_revisions WHERE id = p_revision AND verify_request_id = p_request FOR UPDATE;
  IF NOT FOUND OR revision_record.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_NOT_SUBMITTABLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.verify_quote_lines WHERE verify_quote_revision_id = p_revision)
     OR EXISTS (
       SELECT 1 FROM public.verify_quote_lines line
       WHERE line.verify_quote_revision_id = p_revision
         AND (
           (line.is_price_bearing AND (line.readiness_state <> 'READY_FOR_VERIFICATION' OR NOT public.verify_quote_line_ready_eligible(line.id)))
           OR (NOT line.is_price_bearing AND line.readiness_state = 'READY_FOR_VERIFICATION')
         )
     ) THEN
    RAISE EXCEPTION 'VERIFY_REQUEST_ENVELOPE_INCOMPLETE';
  END IF;
  UPDATE public.verify_quote_revisions
     SET status = 'SUBMITTED', submitted_by = p_actor, submitted_at = now()
   WHERE id = p_revision;
  UPDATE public.verify_requests
     SET status = 'SUBMITTED', current_submitted_revision_id = p_revision, updated_at = now()
   WHERE id = p_request;
  INSERT INTO public.audit_logs(company_id, actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_company, p_actor, 'TENANT', 'verify.request.submitted', 'VerifyRequest', p_request,
    jsonb_build_object('organizationId', p_company, 'revisionId', p_revision, 'fromState', request_record.status, 'toState', 'SUBMITTED',
      'previousSubmittedRevisionId', request_record.current_submitted_revision_id,
      'revisionNumber', revision_record.revision_number, 'idempotencyKey', revision_record.idempotency_key),
    NULLIF(p_correlation, '')::UUID);
END
$$;

CREATE FUNCTION public.partner_verify_request_cancel(p_actor UUID, p_company UUID, p_request UUID, p_correlation TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE request_record RECORD;
BEGIN
  IF NOT public.verify_partner_lifecycle_authorized(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_FORBIDDEN';
  END IF;
  SELECT * INTO request_record FROM public.verify_requests WHERE id = p_request AND company_id = p_company FOR UPDATE;
  IF NOT FOUND OR request_record.status NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_NOT_CANCELLABLE';
  END IF;
  UPDATE public.verify_requests SET status = 'CANCELLED', updated_at = now() WHERE id = p_request;
  INSERT INTO public.audit_logs(company_id, actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_company, p_actor, 'TENANT', 'verify.request.cancelled', 'VerifyRequest', p_request,
    jsonb_build_object('organizationId', p_company, 'fromState', request_record.status, 'toState', 'CANCELLED'),
    NULLIF(p_correlation, '')::UUID);
END
$$;

CREATE OR REPLACE FUNCTION public.internal_verify_quote_line_transition(p_actor UUID, p_line UUID, p_next TEXT, p_reason TEXT, p_correlation TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE previous_state TEXT; owning_company UUID; owning_request UUID; owning_revision UUID;
  reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF NULLIF(current_setting('app.actor_id', true), '') IS DISTINCT FROM p_actor::TEXT
     OR NOT public.internal_has_capability(p_actor, 'verify.analyst') THEN
    RAISE EXCEPTION 'VERIFY_ANALYST_FORBIDDEN';
  END IF;
  SELECT line.readiness_state, line.verify_quote_revision_id, revision.verify_request_id, request_record.company_id
    INTO previous_state, owning_revision, owning_request, owning_company
    FROM public.verify_quote_lines line
    JOIN public.verify_quote_revisions revision ON revision.id = line.verify_quote_revision_id
    JOIN public.verify_requests request_record ON request_record.id = revision.verify_request_id
   WHERE line.id = p_line
   FOR UPDATE OF line;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFY_QUOTE_LINE_NOT_AVAILABLE'; END IF;
  IF previous_state = p_next THEN RETURN; END IF;
  IF p_next = 'READY_FOR_VERIFICATION' AND NOT public.verify_quote_line_ready_eligible(p_line) THEN
    RAISE EXCEPTION 'VERIFY_QUOTE_LINE_NOT_READY';
  END IF;
  IF p_next = 'NOT_VERIFIABLE' AND reason IS NULL THEN
    RAISE EXCEPTION 'VERIFY_QUOTE_LINE_NOT_VERIFIABLE_REASON_REQUIRED';
  END IF;
  UPDATE public.verify_quote_lines
     SET readiness_state = p_next,
         readiness_reason = CASE WHEN p_next = 'NOT_VERIFIABLE' THEN reason ELSE NULL END
   WHERE id = p_line;
  INSERT INTO public.audit_logs(company_id, actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (owning_company, p_actor, 'SCO_INTERNAL', 'verify.quote_line.readiness_changed', 'VerifyQuoteLine', p_line,
    jsonb_build_object('organizationId', owning_company, 'requestId', owning_request, 'revisionId', owning_revision,
      'fromState', previous_state, 'toState', p_next, 'reason', reason, 'authorizationPath', 'verify.analyst'),
    NULLIF(p_correlation, '')::UUID);
END
$$;

REVOKE ALL ON FUNCTION
  public.partner_verify_write_allowed(UUID, UUID),
  public.verify_partner_lifecycle_authorized(UUID, UUID),
  public.verify_quote_line_ready_eligible(UUID),
  public.partner_verify_request_create(UUID, UUID, TEXT),
  public.partner_verify_revision_create(UUID, UUID, UUID, UUID, TEXT[], JSONB, UUID, UUID, TEXT, JSONB, TEXT, TEXT),
  public.partner_verify_line_readiness_set(UUID, UUID, UUID, TEXT, TEXT, TEXT),
  public.partner_verify_request_submit(UUID, UUID, UUID, UUID, TEXT),
  public.partner_verify_request_cancel(UUID, UUID, UUID, TEXT)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.partner_verify_request_create(UUID, UUID, TEXT),
  public.partner_verify_revision_create(UUID, UUID, UUID, UUID, TEXT[], JSONB, UUID, UUID, TEXT, JSONB, TEXT, TEXT),
  public.partner_verify_line_readiness_set(UUID, UUID, UUID, TEXT, TEXT, TEXT),
  public.partner_verify_request_submit(UUID, UUID, UUID, UUID, TEXT),
  public.partner_verify_request_cancel(UUID, UUID, UUID, TEXT)
TO sco_runtime;
