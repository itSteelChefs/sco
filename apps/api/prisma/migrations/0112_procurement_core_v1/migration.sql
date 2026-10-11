-- Procurement Core V1 (Roadmap D). Does not modify Stage016/Wave2 frozen migrations.
-- Collision-safe: Codex1 occupies 0111_post_stage016_launch_core → this is 0112.
-- STOP before PO / supplier purchase / Partner resale (E).

-- Permissions (minimal)
INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'procurement.request.write', 'Partner create/update/submit own procurement requirements and BOQ draft'),
  (gen_random_uuid(), 'procurement.request.read', 'Partner read own procurement requirements'),
  (gen_random_uuid(), 'procurement.review', 'Internal SCO review, sourcing, quote intake, comparison, selection candidate')
ON CONFLICT (code) DO NOTHING;

-- Requirement header
CREATE TABLE public.procurement_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 240),
  reference_code TEXT,
  sector TEXT NOT NULL CHECK (sector IN ('HVAC','ELECTRICAL','PLUMBING','MULTI')),
  project_reference TEXT,
  delivery_location TEXT NOT NULL CHECK (btrim(delivery_location) <> '' AND char_length(delivery_location) <= 240),
  needed_by DATE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','SUBMITTED','IN_REVIEW','SOURCING','QUOTES_RECEIVED','COMPARISON_READY','SELECTION_READY'
  )),
  submitted_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX procurement_requirements_company_status_idx
  ON public.procurement_requirements(company_id, status, updated_at DESC);
CREATE INDEX procurement_requirements_status_idx
  ON public.procurement_requirements(status, updated_at DESC);

-- BOQ lines (stable identity — not row number)
CREATE TABLE public.procurement_requirement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID NOT NULL REFERENCES public.procurement_requirements(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  line_key TEXT NOT NULL CHECK (btrim(line_key) <> ''),
  description TEXT NOT NULL CHECK (btrim(description) <> '' AND char_length(description) <= 2000),
  specification TEXT,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  unit_id UUID NOT NULL REFERENCES public.unit_definitions(id) ON DELETE RESTRICT,
  brand_preference TEXT,
  model_preference TEXT,
  technical_notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (requirement_id, line_key)
);
CREATE INDEX procurement_requirement_lines_requirement_idx
  ON public.procurement_requirement_lines(requirement_id, sort_order);

CREATE TABLE public.procurement_requirement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID NOT NULL REFERENCES public.procurement_requirements(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  reason TEXT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Requirement-scoped supplier quotes (not RFQ/execution-bound; E bridges later)
CREATE TABLE public.procurement_requirement_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID NOT NULL REFERENCES public.procurement_requirements(id) ON DELETE RESTRICT,
  partner_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  supplier_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  quote_reference TEXT NOT NULL CHECK (btrim(quote_reference) <> ''),
  currency_code TEXT NOT NULL CHECK (char_length(currency_code) = 3),
  valid_until DATE,
  commercial_terms TEXT,
  document_id UUID REFERENCES public.documents(id) ON DELETE RESTRICT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  status TEXT NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED','SUPERSEDED','WITHDRAWN')),
  recorded_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX procurement_requirement_quotes_requirement_idx
  ON public.procurement_requirement_quotes(requirement_id, status);

CREATE TABLE public.procurement_requirement_quote_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.procurement_requirement_quotes(id) ON DELETE RESTRICT,
  requirement_id UUID NOT NULL REFERENCES public.procurement_requirements(id) ON DELETE RESTRICT,
  requirement_line_id UUID REFERENCES public.procurement_requirement_lines(id) ON DELETE RESTRICT,
  match_state TEXT NOT NULL CHECK (match_state IN ('MATCHED','UNMATCHED','ALTERNATIVE','EXCLUDED','NOT_QUOTED')),
  offered_description TEXT,
  offered_quantity NUMERIC(18,4),
  unit_id UUID REFERENCES public.unit_definitions(id) ON DELETE RESTRICT,
  unit_price NUMERIC(18,6),
  line_amount NUMERIC(18,6),
  tax_state TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (tax_state IN ('EXCL','INCL','ZERO','UNKNOWN','NOT_APPLICABLE')),
  value_state TEXT NOT NULL DEFAULT 'QUOTED' CHECK (value_state IN ('QUOTED','EXPLICIT_ZERO','NOT_QUOTED','INCLUDED','UNKNOWN')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (value_state = 'NOT_QUOTED' AND unit_price IS NULL AND line_amount IS NULL)
    OR (value_state = 'EXPLICIT_ZERO' AND unit_price = 0)
    OR (value_state IN ('QUOTED','INCLUDED','UNKNOWN'))
  )
);
CREATE INDEX procurement_requirement_quote_lines_quote_idx
  ON public.procurement_requirement_quote_lines(quote_id);
CREATE INDEX procurement_requirement_quote_lines_boq_idx
  ON public.procurement_requirement_quote_lines(requirement_line_id);

-- Comparison + alias (Partner-safe label stored; canonical supplier internal-only)
CREATE TABLE public.procurement_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID NOT NULL UNIQUE REFERENCES public.procurement_requirements(id) ON DELETE RESTRICT,
  partner_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED')),
  generated_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  commercial_notes TEXT,
  technical_notes TEXT,
  delivery_notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.procurement_comparison_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_id UUID NOT NULL REFERENCES public.procurement_comparisons(id) ON DELETE RESTRICT,
  quote_id UUID NOT NULL REFERENCES public.procurement_requirement_quotes(id) ON DELETE RESTRICT,
  supplier_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  alias_label TEXT NOT NULL CHECK (alias_label ~ '^SUPPLIER_[A-Z0-9]+$'),
  coverage_line_count INTEGER NOT NULL DEFAULT 0,
  requirement_line_count INTEGER NOT NULL DEFAULT 0,
  coverage_percent NUMERIC(7,2) NOT NULL DEFAULT 0,
  comparable_total NUMERIC(18,6),
  currency_code TEXT NOT NULL,
  UNIQUE (comparison_id, quote_id),
  UNIQUE (comparison_id, alias_label)
);

CREATE TABLE public.procurement_comparison_line_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_id UUID NOT NULL REFERENCES public.procurement_comparisons(id) ON DELETE RESTRICT,
  requirement_line_id UUID NOT NULL REFERENCES public.procurement_requirement_lines(id) ON DELETE RESTRICT,
  quote_id UUID NOT NULL REFERENCES public.procurement_requirement_quotes(id) ON DELETE RESTRICT,
  quote_line_id UUID REFERENCES public.procurement_requirement_quote_lines(id) ON DELETE RESTRICT,
  technical_state TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (technical_state IN ('PENDING','COMPLIANT','EQUIVALENT','NON_COMPLIANT','NOT_ASSESSED','NOT_QUOTED')),
  technical_notes TEXT,
  commercial_notes TEXT,
  unit_price NUMERIC(18,6),
  line_amount NUMERIC(18,6),
  value_state TEXT NOT NULL DEFAULT 'NOT_QUOTED'
    CHECK (value_state IN ('QUOTED','EXPLICIT_ZERO','NOT_QUOTED','INCLUDED','UNKNOWN')),
  assessed_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  assessed_at TIMESTAMPTZ,
  UNIQUE (comparison_id, requirement_line_id, quote_id)
);

CREATE TABLE public.procurement_selection_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID NOT NULL UNIQUE REFERENCES public.procurement_requirements(id) ON DELETE RESTRICT,
  comparison_id UUID NOT NULL REFERENCES public.procurement_comparisons(id) ON DELETE RESTRICT,
  quote_id UUID NOT NULL REFERENCES public.procurement_requirement_quotes(id) ON DELETE RESTRICT,
  alias_label TEXT NOT NULL,
  rationale TEXT NOT NULL CHECK (btrim(rationale) <> ''),
  selected_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- Explicit E handoff marker — no PO id here
  e_handoff_ready BOOLEAN NOT NULL DEFAULT TRUE
);

-- RLS: Partner tables company-scoped; quote/comparison tables internal-or-own-company via gateways
ALTER TABLE public.procurement_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY procurement_requirements_tenant ON public.procurement_requirements
  FOR ALL TO sco_runtime
  USING (
    company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.sco_internal', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.sco_internal', true) = 'true'
  );

ALTER TABLE public.procurement_requirement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_requirement_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY procurement_requirement_lines_tenant ON public.procurement_requirement_lines
  FOR ALL TO sco_runtime
  USING (
    company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.sco_internal', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.sco_internal', true) = 'true'
  );

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'procurement_requirement_events',
    'procurement_requirement_quotes',
    'procurement_requirement_quote_lines',
    'procurement_comparisons',
    'procurement_comparison_entries',
    'procurement_comparison_line_assessments',
    'procurement_selection_candidates'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_internal ON public.%I FOR ALL TO sco_runtime USING (current_setting(''app.sco_internal'',true)=''true'') WITH CHECK (current_setting(''app.sco_internal'',true)=''true'')',
      t, t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON
  public.procurement_requirements,
  public.procurement_requirement_lines,
  public.procurement_requirement_events,
  public.procurement_requirement_quotes,
  public.procurement_requirement_quote_lines,
  public.procurement_comparisons,
  public.procurement_comparison_entries,
  public.procurement_comparison_line_assessments,
  public.procurement_selection_candidates
TO sco_runtime;

-- Eligibility boundary: compose existing admission/Class D — do not duplicate
CREATE OR REPLACE FUNCTION public.partner_procurement_core_eligible(p_actor UUID, p_company UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.partner_procurement_access_allowed(p_actor, p_company)
     AND public.admission_actor_has_permission(p_actor, p_company, 'procurement.request.write');
$$;
ALTER FUNCTION public.partner_procurement_core_eligible(UUID,UUID) OWNER TO sco_partner_admission_gateway_owner;
REVOKE ALL ON FUNCTION public.partner_procurement_core_eligible(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_procurement_core_eligible(UUID,UUID) TO sco_runtime;

CREATE OR REPLACE FUNCTION public.partner_procurement_core_readable(p_actor UUID, p_company UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.partner_procurement_access_allowed(p_actor, p_company)
     AND (
       public.admission_actor_has_permission(p_actor, p_company, 'procurement.request.read')
       OR public.admission_actor_has_permission(p_actor, p_company, 'procurement.request.write')
     );
$$;
ALTER FUNCTION public.partner_procurement_core_readable(UUID,UUID) OWNER TO sco_partner_admission_gateway_owner;
REVOKE ALL ON FUNCTION public.partner_procurement_core_readable(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_procurement_core_readable(UUID,UUID) TO sco_runtime;

CREATE OR REPLACE FUNCTION public.internal_procurement_review_allowed(p_actor UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.internal_has_capability(p_actor, 'procurement.review');
$$;

-- Partner: create draft
CREATE OR REPLACE FUNCTION public.partner_procurement_requirement_create(
  p_actor UUID, p_company UUID,
  p_title TEXT, p_sector TEXT, p_delivery_location TEXT,
  p_reference_code TEXT, p_project_reference TEXT, p_needed_by DATE, p_notes TEXT,
  p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id UUID := gen_random_uuid();
BEGIN
  IF current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::text
     OR current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::text THEN
    RAISE EXCEPTION 'PARTNER_PROCUREMENT_FORBIDDEN';
  END IF;
  IF NOT public.partner_procurement_core_eligible(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_PROCUREMENT_INELIGIBLE';
  END IF;
  INSERT INTO public.procurement_requirements(
    id, company_id, created_by, title, reference_code, sector, project_reference,
    delivery_location, needed_by, notes, status
  ) VALUES (
    v_id, p_company, p_actor, btrim(p_title), NULLIF(btrim(COALESCE(p_reference_code,'')), ''),
    p_sector, NULLIF(btrim(COALESCE(p_project_reference,'')), ''),
    btrim(p_delivery_location), p_needed_by, NULLIF(btrim(COALESCE(p_notes,'')), ''), 'DRAFT'
  );
  INSERT INTO public.procurement_requirement_events(requirement_id, company_id, from_status, to_status, actor_user_id, correlation_id)
  VALUES (v_id, p_company, NULL, 'DRAFT', p_actor, p_correlation);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (p_actor, p_company, 'TENANT', 'procurement.requirement.created', 'ProcurementRequirement', v_id,
    jsonb_build_object('status','DRAFT','sector',p_sector), p_correlation, 'PUR-03', 'ALLOWED');
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.partner_procurement_requirement_update_draft(
  p_actor UUID, p_company UUID, p_id UUID,
  p_title TEXT, p_sector TEXT, p_delivery_location TEXT,
  p_reference_code TEXT, p_project_reference TEXT, p_needed_by DATE, p_notes TEXT,
  p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD;
BEGIN
  IF current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::text
     OR current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::text THEN
    RAISE EXCEPTION 'PARTNER_PROCUREMENT_FORBIDDEN';
  END IF;
  IF NOT public.partner_procurement_core_eligible(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_PROCUREMENT_INELIGIBLE';
  END IF;
  SELECT * INTO r FROM public.procurement_requirements WHERE id = p_id AND company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCUREMENT_REQUIREMENT_NOT_FOUND'; END IF;
  IF r.status <> 'DRAFT' THEN RAISE EXCEPTION 'PROCUREMENT_REQUIREMENT_NOT_DRAFT'; END IF;
  UPDATE public.procurement_requirements SET
    title = btrim(p_title), sector = p_sector, delivery_location = btrim(p_delivery_location),
    reference_code = NULLIF(btrim(COALESCE(p_reference_code,'')), ''),
    project_reference = NULLIF(btrim(COALESCE(p_project_reference,'')), ''),
    needed_by = p_needed_by, notes = NULLIF(btrim(COALESCE(p_notes,'')), ''),
    updated_at = clock_timestamp()
  WHERE id = p_id;
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION public.partner_procurement_requirement_submit(
  p_actor UUID, p_company UUID, p_id UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD;
BEGIN
  IF current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::text
     OR current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::text THEN
    RAISE EXCEPTION 'PARTNER_PROCUREMENT_FORBIDDEN';
  END IF;
  IF NOT public.partner_procurement_core_eligible(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_PROCUREMENT_INELIGIBLE';
  END IF;
  SELECT * INTO r FROM public.procurement_requirements WHERE id = p_id AND company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCUREMENT_REQUIREMENT_NOT_FOUND'; END IF;
  IF r.status = 'SUBMITTED' THEN RETURN p_id; END IF; -- idempotent
  IF r.status <> 'DRAFT' THEN RAISE EXCEPTION 'PROCUREMENT_REQUIREMENT_NOT_DRAFT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.procurement_requirement_lines WHERE requirement_id = p_id) THEN
    RAISE EXCEPTION 'PROCUREMENT_BOQ_REQUIRED';
  END IF;
  UPDATE public.procurement_requirements SET
    status = 'SUBMITTED', submitted_at = clock_timestamp(), submitted_by = p_actor, updated_at = clock_timestamp()
  WHERE id = p_id;
  INSERT INTO public.procurement_requirement_events(requirement_id, company_id, from_status, to_status, actor_user_id, correlation_id)
  VALUES (p_id, p_company, 'DRAFT', 'SUBMITTED', p_actor, p_correlation);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (p_actor, p_company, 'TENANT', 'procurement.requirement.submitted', 'ProcurementRequirement', p_id,
    jsonb_build_object('fromStatus','DRAFT','toStatus','SUBMITTED'), p_correlation, 'PUR-03', 'ALLOWED');
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION public.partner_procurement_line_upsert(
  p_actor UUID, p_company UUID, p_requirement UUID, p_line UUID,
  p_description TEXT, p_specification TEXT, p_quantity NUMERIC, p_unit UUID,
  p_brand TEXT, p_model TEXT, p_technical_notes TEXT, p_sort INTEGER, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD; v_id UUID; v_key TEXT;
BEGIN
  IF current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::text
     OR current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::text THEN
    RAISE EXCEPTION 'PARTNER_PROCUREMENT_FORBIDDEN';
  END IF;
  IF NOT public.partner_procurement_core_eligible(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_PROCUREMENT_INELIGIBLE';
  END IF;
  SELECT * INTO r FROM public.procurement_requirements WHERE id = p_requirement AND company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCUREMENT_REQUIREMENT_NOT_FOUND'; END IF;
  IF r.status <> 'DRAFT' THEN RAISE EXCEPTION 'PROCUREMENT_REQUIREMENT_NOT_DRAFT'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'VALIDATION_FAILED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.unit_definitions u WHERE u.id = p_unit AND u.active) THEN
    RAISE EXCEPTION 'VALIDATION_FAILED';
  END IF;
  IF p_line IS NULL THEN
    v_id := gen_random_uuid();
    v_key := 'L-' || replace(v_id::text, '-', '');
    INSERT INTO public.procurement_requirement_lines(
      id, requirement_id, company_id, line_key, description, specification, quantity, unit_id,
      brand_preference, model_preference, technical_notes, sort_order
    ) VALUES (
      v_id, p_requirement, p_company, v_key, btrim(p_description), NULLIF(btrim(COALESCE(p_specification,'')), ''),
      p_quantity, p_unit, NULLIF(btrim(COALESCE(p_brand,'')), ''), NULLIF(btrim(COALESCE(p_model,'')), ''),
      NULLIF(btrim(COALESCE(p_technical_notes,'')), ''), COALESCE(p_sort, 0)
    );
  ELSE
    UPDATE public.procurement_requirement_lines SET
      description = btrim(p_description),
      specification = NULLIF(btrim(COALESCE(p_specification,'')), ''),
      quantity = p_quantity, unit_id = p_unit,
      brand_preference = NULLIF(btrim(COALESCE(p_brand,'')), ''),
      model_preference = NULLIF(btrim(COALESCE(p_model,'')), ''),
      technical_notes = NULLIF(btrim(COALESCE(p_technical_notes,'')), ''),
      sort_order = COALESCE(p_sort, sort_order),
      updated_at = clock_timestamp()
    WHERE id = p_line AND requirement_id = p_requirement AND company_id = p_company
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'PROCUREMENT_LINE_NOT_FOUND'; END IF;
  END IF;
  UPDATE public.procurement_requirements SET updated_at = clock_timestamp() WHERE id = p_requirement;
  RETURN v_id;
END $$;

-- Internal review / sourcing
CREATE OR REPLACE FUNCTION public.internal_procurement_requirement_transition(
  p_actor UUID, p_id UUID, p_next TEXT, p_reason TEXT, p_correlation UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD; allowed BOOLEAN := false;
BEGIN
  IF NOT public.internal_procurement_review_allowed(p_actor) THEN
    RAISE EXCEPTION 'PROCUREMENT_REVIEW_FORBIDDEN';
  END IF;
  SELECT * INTO r FROM public.procurement_requirements WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCUREMENT_REQUIREMENT_NOT_FOUND'; END IF;
  IF r.status = p_next THEN RETURN; END IF;
  IF (r.status = 'SUBMITTED' AND p_next IN ('IN_REVIEW','SOURCING'))
     OR (r.status = 'IN_REVIEW' AND p_next = 'SOURCING')
     OR (r.status = 'SOURCING' AND p_next = 'QUOTES_RECEIVED')
     OR (r.status = 'QUOTES_RECEIVED' AND p_next = 'COMPARISON_READY')
     OR (r.status = 'COMPARISON_READY' AND p_next = 'SELECTION_READY') THEN
    allowed := true;
  END IF;
  IF NOT allowed THEN RAISE EXCEPTION 'PROCUREMENT_STATE_INVALID'; END IF;
  UPDATE public.procurement_requirements SET status = p_next, updated_at = clock_timestamp() WHERE id = p_id;
  INSERT INTO public.procurement_requirement_events(requirement_id, company_id, from_status, to_status, actor_user_id, reason, correlation_id)
  VALUES (p_id, r.company_id, r.status, p_next, p_actor, NULLIF(btrim(COALESCE(p_reason,'')), ''), p_correlation);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (p_actor, r.company_id, 'SCO_INTERNAL', 'procurement.requirement.transitioned', 'ProcurementRequirement', p_id,
    jsonb_build_object('fromStatus', r.status, 'toStatus', p_next, 'reason', p_reason), p_correlation, 'PUR-03', 'ALLOWED');
END $$;

-- Internal supplier directory read helper (Company SUPPLIER only)
CREATE OR REPLACE FUNCTION public.internal_procurement_supplier_list(p_actor UUID)
RETURNS TABLE(id UUID, name TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_procurement_review_allowed(p_actor) THEN
    RAISE EXCEPTION 'PROCUREMENT_REVIEW_FORBIDDEN';
  END IF;
  RETURN QUERY
    SELECT c.id, c.name, c.status::text
      FROM public."Company" c
     WHERE c.type = 'SUPPLIER' AND c.status = 'ACTIVE'
     ORDER BY c.name
     LIMIT 200;
END $$;

CREATE OR REPLACE FUNCTION public.internal_procurement_supplier_ensure(
  p_actor UUID, p_name TEXT, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.internal_procurement_review_allowed(p_actor) THEN
    RAISE EXCEPTION 'PROCUREMENT_REVIEW_FORBIDDEN';
  END IF;
  v_id := gen_random_uuid();
  INSERT INTO public."Company"(id, name, type, status)
  VALUES (v_id, btrim(p_name), 'SUPPLIER', 'ACTIVE');
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (p_actor, v_id, 'SCO_INTERNAL', 'procurement.supplier.created', 'Company', v_id,
    jsonb_build_object('type','SUPPLIER'), p_correlation, 'PUR-03', 'ALLOWED');
  RETURN v_id;
END $$;

-- Record quote
CREATE OR REPLACE FUNCTION public.internal_procurement_quote_record(
  p_actor UUID, p_requirement UUID, p_supplier UUID, p_reference TEXT, p_currency TEXT,
  p_valid_until DATE, p_commercial_terms TEXT, p_document UUID, p_lines JSONB, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD; v_id UUID := gen_random_uuid(); x JSONB; v_line UUID; v_match TEXT; v_value TEXT;
  v_price NUMERIC; v_qty NUMERIC; v_amount NUMERIC;
BEGIN
  IF NOT public.internal_procurement_review_allowed(p_actor) THEN
    RAISE EXCEPTION 'PROCUREMENT_REVIEW_FORBIDDEN';
  END IF;
  SELECT * INTO r FROM public.procurement_requirements WHERE id = p_requirement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCUREMENT_REQUIREMENT_NOT_FOUND'; END IF;
  IF r.status NOT IN ('SOURCING','QUOTES_RECEIVED','COMPARISON_READY') THEN
    RAISE EXCEPTION 'PROCUREMENT_STATE_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."Company" c WHERE c.id = p_supplier AND c.type = 'SUPPLIER' AND c.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'PROCUREMENT_SUPPLIER_INVALID';
  END IF;
  IF p_document IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.documents d WHERE d.id = p_document AND d.status = 'AVAILABLE'
  ) THEN
    RAISE EXCEPTION 'DOCUMENT_LINK_INVALID';
  END IF;
  INSERT INTO public.procurement_requirement_quotes(
    id, requirement_id, partner_company_id, supplier_company_id, quote_reference, currency_code,
    valid_until, commercial_terms, document_id, recorded_by
  ) VALUES (
    v_id, p_requirement, r.company_id, p_supplier, btrim(p_reference), upper(p_currency),
    p_valid_until, NULLIF(btrim(COALESCE(p_commercial_terms,'')), ''), p_document, p_actor
  );
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_match := COALESCE(x->>'matchState', 'NOT_QUOTED');
    v_value := COALESCE(x->>'valueState', CASE WHEN v_match = 'NOT_QUOTED' THEN 'NOT_QUOTED' ELSE 'QUOTED' END);
    v_line := NULLIF(x->>'requirementLineId', '')::uuid;
    IF v_line IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.procurement_requirement_lines l
       WHERE l.id = v_line AND l.requirement_id = p_requirement
    ) THEN
      RAISE EXCEPTION 'PROCUREMENT_LINE_FOREIGN';
    END IF;
    v_price := NULLIF(x->>'unitPrice', '')::numeric;
    v_qty := NULLIF(x->>'offeredQuantity', '')::numeric;
    v_amount := NULLIF(x->>'lineAmount', '')::numeric;
    IF v_value = 'EXPLICIT_ZERO' THEN v_price := 0; END IF;
    IF v_value = 'NOT_QUOTED' THEN v_price := NULL; v_amount := NULL; END IF;
    IF v_amount IS NULL AND v_price IS NOT NULL AND v_qty IS NOT NULL THEN
      v_amount := round(v_price * v_qty, 6);
    END IF;
    INSERT INTO public.procurement_requirement_quote_lines(
      quote_id, requirement_id, requirement_line_id, match_state, offered_description,
      offered_quantity, unit_id, unit_price, line_amount, tax_state, value_state, notes
    ) VALUES (
      v_id, p_requirement, v_line, v_match, NULLIF(x->>'offeredDescription',''),
      v_qty, NULLIF(x->>'unitId','')::uuid, v_price, v_amount,
      COALESCE(x->>'taxState', 'UNKNOWN'), v_value, NULLIF(x->>'notes','')
    );
  END LOOP;
  IF r.status = 'SOURCING' THEN
    UPDATE public.procurement_requirements SET status = 'QUOTES_RECEIVED', updated_at = clock_timestamp() WHERE id = p_requirement;
    INSERT INTO public.procurement_requirement_events(requirement_id, company_id, from_status, to_status, actor_user_id, correlation_id)
    VALUES (p_requirement, r.company_id, 'SOURCING', 'QUOTES_RECEIVED', p_actor, p_correlation);
  END IF;
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (p_actor, r.company_id, 'SCO_INTERNAL', 'procurement.quote.recorded', 'ProcurementRequirementQuote', v_id,
    jsonb_build_object('requirementId', p_requirement, 'supplierCompanyId', p_supplier), p_correlation, 'PUR-03', 'ALLOWED');
  RETURN v_id;
END $$;

-- Generate/refresh comparison with sequential aliases (no encoding of supplier id)
CREATE OR REPLACE FUNCTION public.internal_procurement_comparison_generate(
  p_actor UUID, p_requirement UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD; v_cmp UUID; q RECORD; n INT := 0; v_alias TEXT; v_req_lines INT; v_cov INT; v_total NUMERIC;
BEGIN
  IF NOT public.internal_procurement_review_allowed(p_actor) THEN
    RAISE EXCEPTION 'PROCUREMENT_REVIEW_FORBIDDEN';
  END IF;
  SELECT * INTO r FROM public.procurement_requirements WHERE id = p_requirement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCUREMENT_REQUIREMENT_NOT_FOUND'; END IF;
  IF r.status NOT IN ('QUOTES_RECEIVED','COMPARISON_READY','SELECTION_READY') THEN
    RAISE EXCEPTION 'PROCUREMENT_STATE_INVALID';
  END IF;
  SELECT id INTO v_cmp FROM public.procurement_comparisons WHERE requirement_id = p_requirement;
  IF v_cmp IS NULL THEN
    v_cmp := gen_random_uuid();
    INSERT INTO public.procurement_comparisons(id, requirement_id, partner_company_id, generated_by)
    VALUES (v_cmp, p_requirement, r.company_id, p_actor);
  ELSE
    DELETE FROM public.procurement_comparison_line_assessments WHERE comparison_id = v_cmp;
    DELETE FROM public.procurement_comparison_entries WHERE comparison_id = v_cmp;
    UPDATE public.procurement_comparisons SET generated_by = p_actor, generated_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = v_cmp;
  END IF;
  SELECT count(*)::int INTO v_req_lines FROM public.procurement_requirement_lines WHERE requirement_id = p_requirement;
  FOR q IN
    SELECT * FROM public.procurement_requirement_quotes
     WHERE requirement_id = p_requirement AND status = 'RECORDED'
     ORDER BY received_at, id
  LOOP
    n := n + 1;
    -- Sequential opaque labels SUPPLIER_A..SUPPLIER_Z then SUPPLIER_A2… — never encode UUID/name
    IF n <= 26 THEN
      v_alias := 'SUPPLIER_' || chr(64 + n);
    ELSE
      v_alias := 'SUPPLIER_' || chr(64 + ((n - 1) % 26) + 1) || ((n - 1) / 26)::text;
    END IF;
    SELECT count(*)::int INTO v_cov FROM public.procurement_requirement_quote_lines ql
     WHERE ql.quote_id = q.id AND ql.match_state IN ('MATCHED','ALTERNATIVE') AND ql.value_state IN ('QUOTED','EXPLICIT_ZERO','INCLUDED');
    SELECT COALESCE(sum(ql.line_amount), 0) INTO v_total FROM public.procurement_requirement_quote_lines ql
     WHERE ql.quote_id = q.id AND ql.value_state IN ('QUOTED','EXPLICIT_ZERO') AND ql.line_amount IS NOT NULL;
    INSERT INTO public.procurement_comparison_entries(
      comparison_id, quote_id, supplier_company_id, alias_label,
      coverage_line_count, requirement_line_count, coverage_percent, comparable_total, currency_code
    ) VALUES (
      v_cmp, q.id, q.supplier_company_id, v_alias,
      v_cov, v_req_lines,
      CASE WHEN v_req_lines = 0 THEN 0 ELSE round((v_cov::numeric / v_req_lines::numeric) * 100, 2) END,
      v_total, q.currency_code
    );
    INSERT INTO public.procurement_comparison_line_assessments(
      comparison_id, requirement_line_id, quote_id, quote_line_id, technical_state, unit_price, line_amount, value_state
    )
    SELECT v_cmp, l.id, q.id, ql.id,
           CASE WHEN ql.id IS NULL THEN 'NOT_QUOTED' ELSE 'PENDING' END,
           ql.unit_price, ql.line_amount, COALESCE(ql.value_state, 'NOT_QUOTED')
      FROM public.procurement_requirement_lines l
      LEFT JOIN public.procurement_requirement_quote_lines ql
        ON ql.requirement_line_id = l.id AND ql.quote_id = q.id
     WHERE l.requirement_id = p_requirement;
  END LOOP;
  IF r.status = 'QUOTES_RECEIVED' THEN
    UPDATE public.procurement_requirements SET status = 'COMPARISON_READY', updated_at = clock_timestamp() WHERE id = p_requirement;
    INSERT INTO public.procurement_requirement_events(requirement_id, company_id, from_status, to_status, actor_user_id, correlation_id)
    VALUES (p_requirement, r.company_id, 'QUOTES_RECEIVED', 'COMPARISON_READY', p_actor, p_correlation);
  END IF;
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (p_actor, r.company_id, 'SCO_INTERNAL', 'procurement.comparison.generated', 'ProcurementComparison', v_cmp,
    jsonb_build_object('requirementId', p_requirement, 'entryCount', n), p_correlation, 'PUR-03', 'ALLOWED');
  RETURN v_cmp;
END $$;

CREATE OR REPLACE FUNCTION public.internal_procurement_assessment_set(
  p_actor UUID, p_comparison UUID, p_requirement_line UUID, p_quote UUID,
  p_technical TEXT, p_technical_notes TEXT, p_commercial_notes TEXT, p_correlation UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE cmp RECORD;
BEGIN
  IF NOT public.internal_procurement_review_allowed(p_actor) THEN
    RAISE EXCEPTION 'PROCUREMENT_REVIEW_FORBIDDEN';
  END IF;
  SELECT * INTO cmp FROM public.procurement_comparisons WHERE id = p_comparison FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCUREMENT_COMPARISON_NOT_FOUND'; END IF;
  UPDATE public.procurement_comparison_line_assessments SET
    technical_state = p_technical,
    technical_notes = NULLIF(btrim(COALESCE(p_technical_notes,'')), ''),
    commercial_notes = NULLIF(btrim(COALESCE(p_commercial_notes,'')), ''),
    assessed_by = p_actor,
    assessed_at = clock_timestamp()
  WHERE comparison_id = p_comparison AND requirement_line_id = p_requirement_line AND quote_id = p_quote;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCUREMENT_ASSESSMENT_NOT_FOUND'; END IF;
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (p_actor, cmp.partner_company_id, 'SCO_INTERNAL', 'procurement.assessment.updated', 'ProcurementComparison', p_comparison,
    jsonb_build_object('requirementLineId', p_requirement_line, 'quoteId', p_quote, 'technicalState', p_technical),
    p_correlation, 'PUR-03', 'ALLOWED');
END $$;

CREATE OR REPLACE FUNCTION public.internal_procurement_selection_set(
  p_actor UUID, p_requirement UUID, p_quote UUID, p_rationale TEXT, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD; cmp RECORD; entry RECORD; v_id UUID;
BEGIN
  IF NOT public.internal_procurement_review_allowed(p_actor) THEN
    RAISE EXCEPTION 'PROCUREMENT_REVIEW_FORBIDDEN';
  END IF;
  SELECT * INTO r FROM public.procurement_requirements WHERE id = p_requirement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCUREMENT_REQUIREMENT_NOT_FOUND'; END IF;
  SELECT * INTO cmp FROM public.procurement_comparisons WHERE requirement_id = p_requirement;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCUREMENT_COMPARISON_NOT_FOUND'; END IF;
  SELECT * INTO entry FROM public.procurement_comparison_entries WHERE comparison_id = cmp.id AND quote_id = p_quote;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCUREMENT_QUOTE_NOT_IN_COMPARISON'; END IF;
  IF EXISTS (SELECT 1 FROM public.procurement_selection_candidates WHERE requirement_id = p_requirement) THEN
    UPDATE public.procurement_selection_candidates SET
      quote_id = p_quote, alias_label = entry.alias_label, rationale = btrim(p_rationale),
      selected_by = p_actor, selected_at = clock_timestamp(), comparison_id = cmp.id
    WHERE requirement_id = p_requirement
    RETURNING id INTO v_id;
  ELSE
    v_id := gen_random_uuid();
    INSERT INTO public.procurement_selection_candidates(
      id, requirement_id, comparison_id, quote_id, alias_label, rationale, selected_by
    ) VALUES (v_id, p_requirement, cmp.id, p_quote, entry.alias_label, btrim(p_rationale), p_actor);
  END IF;
  IF r.status <> 'SELECTION_READY' THEN
    UPDATE public.procurement_requirements SET status = 'SELECTION_READY', updated_at = clock_timestamp() WHERE id = p_requirement;
    INSERT INTO public.procurement_requirement_events(requirement_id, company_id, from_status, to_status, actor_user_id, correlation_id)
    VALUES (p_requirement, r.company_id, r.status, 'SELECTION_READY', p_actor, p_correlation);
  END IF;
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (p_actor, r.company_id, 'SCO_INTERNAL', 'procurement.selection.candidate', 'ProcurementSelectionCandidate', v_id,
    jsonb_build_object('requirementId', p_requirement, 'aliasLabel', entry.alias_label, 'quoteId', p_quote, 'poCreated', false),
    p_correlation, 'PUR-03', 'ALLOWED');
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.internal_procurement_review_allowed(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_procurement_requirement_create(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_procurement_requirement_update_draft(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_procurement_requirement_submit(UUID,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_procurement_line_upsert(UUID,UUID,UUID,UUID,TEXT,TEXT,NUMERIC,UUID,TEXT,TEXT,TEXT,INTEGER,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_procurement_requirement_transition(UUID,UUID,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_procurement_supplier_list(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_procurement_supplier_ensure(UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_procurement_quote_record(UUID,UUID,UUID,TEXT,TEXT,DATE,TEXT,UUID,JSONB,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_procurement_comparison_generate(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_procurement_assessment_set(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_procurement_selection_set(UUID,UUID,UUID,TEXT,UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.partner_procurement_requirement_create(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.partner_procurement_requirement_update_draft(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.partner_procurement_requirement_submit(UUID,UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.partner_procurement_line_upsert(UUID,UUID,UUID,UUID,TEXT,TEXT,NUMERIC,UUID,TEXT,TEXT,TEXT,INTEGER,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_procurement_review_allowed(UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_procurement_requirement_transition(UUID,UUID,TEXT,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_procurement_supplier_list(UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_procurement_supplier_ensure(UUID,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_procurement_quote_record(UUID,UUID,UUID,TEXT,TEXT,DATE,TEXT,UUID,JSONB,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_procurement_comparison_generate(UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_procurement_assessment_set(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_procurement_selection_set(UUID,UUID,UUID,TEXT,UUID) TO sco_runtime;

-- Partner-safe comparison projection (no supplier_company_id / legal name)
CREATE OR REPLACE FUNCTION public.partner_procurement_comparison_get(
  p_actor UUID, p_company UUID, p_requirement UUID
)
RETURNS TABLE(
  comparison_id UUID,
  requirement_id UUID,
  status TEXT,
  entries JSONB,
  line_assessments JSONB,
  selection JSONB
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::text
     OR current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::text THEN
    RAISE EXCEPTION 'PARTNER_PROCUREMENT_FORBIDDEN';
  END IF;
  IF NOT public.partner_procurement_core_readable(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_PROCUREMENT_INELIGIBLE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.procurement_requirements r
     WHERE r.id = p_requirement AND r.company_id = p_company
  ) THEN
    RAISE EXCEPTION 'PROCUREMENT_REQUIREMENT_NOT_FOUND';
  END IF;
  RETURN QUERY
  SELECT
    c.id,
    c.requirement_id,
    c.status,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'aliasLabel', e.alias_label,
        'coverageLineCount', e.coverage_line_count,
        'requirementLineCount', e.requirement_line_count,
        'coveragePercent', e.coverage_percent,
        'comparableTotal', e.comparable_total,
        'currencyCode', e.currency_code
      ) ORDER BY e.alias_label)
      FROM public.procurement_comparison_entries e WHERE e.comparison_id = c.id
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'requirementLineId', a.requirement_line_id,
        'aliasLabel', e.alias_label,
        'technicalState', a.technical_state,
        'technicalNotes', a.technical_notes,
        'commercialNotes', a.commercial_notes,
        'unitPrice', a.unit_price,
        'lineAmount', a.line_amount,
        'valueState', a.value_state
      ))
      FROM public.procurement_comparison_line_assessments a
      JOIN public.procurement_comparison_entries e
        ON e.comparison_id = a.comparison_id AND e.quote_id = a.quote_id
      WHERE a.comparison_id = c.id
    ), '[]'::jsonb),
    (
      SELECT jsonb_build_object(
        'aliasLabel', s.alias_label,
        'rationale', s.rationale,
        'selectedAt', s.selected_at
      )
      FROM public.procurement_selection_candidates s
      WHERE s.requirement_id = c.requirement_id
    )
  FROM public.procurement_comparisons c
  WHERE c.requirement_id = p_requirement AND c.partner_company_id = p_company;
END $$;
REVOKE ALL ON FUNCTION public.partner_procurement_comparison_get(UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_procurement_comparison_get(UUID,UUID,UUID) TO sco_runtime;
