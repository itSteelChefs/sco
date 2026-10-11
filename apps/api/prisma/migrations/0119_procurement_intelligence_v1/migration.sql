-- Capability G — Procurement Intelligence V1
-- Read-model facts from D/E/F. Never mutates source. Never ingests Verify.
-- G_METRIC_VERSION=1

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'procurement.intelligence.read', 'Internal read procurement intelligence aggregates'),
  (gen_random_uuid(), 'procurement.intelligence.refresh', 'Internal refresh/backfill procurement intelligence facts')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE public.g_intelligence_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('BACKFILL','REFRESH','DRY_RUN')),
  metric_version INT NOT NULL DEFAULT 1,
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ,
  facts_inserted INT NOT NULL DEFAULT 0,
  facts_updated INT NOT NULL DEFAULT 0,
  facts_skipped INT NOT NULL DEFAULT 0,
  error_text TEXT,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id UUID
);

CREATE TABLE public.g_procurement_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL,
  fact_kind TEXT NOT NULL CHECK (fact_kind IN (
    'QUOTE_OBSERVED','QUOTE_SELECTED','PURCHASE_ORDER_ISSUED','SUPPLIER_CONFIRMED',
    'SUPPLIER_CONFIRMATION_REVISED','PURCHASE_CANCELLED','PARTNER_ALLOCATION','ENGINEERING_DEMAND'
  )),
  source_domain TEXT NOT NULL CHECK (source_domain IN ('D','E','F')),
  source_entity_type TEXT NOT NULL,
  source_entity_id UUID NOT NULL,
  source_revision TEXT,
  effective_at TIMESTAMPTZ NOT NULL,
  partner_company_id UUID REFERENCES public."Company"(id) ON DELETE RESTRICT,
  supplier_company_id UUID REFERENCES public."Company"(id) ON DELETE RESTRICT,
  sector TEXT,
  comparable_key TEXT NOT NULL,
  description_norm TEXT NOT NULL,
  specification_norm TEXT,
  brand_norm TEXT,
  model_norm TEXT,
  unit_id UUID NOT NULL REFERENCES public.unit_definitions(id) ON DELETE RESTRICT,
  currency_code CHAR(3),
  unit_price NUMERIC(18,6),
  quantity NUMERIC(18,4),
  tax_state TEXT,
  value_state TEXT,
  commercial_basis TEXT,
  metric_version INT NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT g_procurement_facts_source_key_uniq UNIQUE (source_key)
);

CREATE INDEX g_procurement_facts_effective_idx ON public.g_procurement_facts(effective_at DESC);
CREATE INDEX g_procurement_facts_comparable_idx ON public.g_procurement_facts(comparable_key, currency_code, unit_id, fact_kind);
CREATE INDEX g_procurement_facts_supplier_idx ON public.g_procurement_facts(supplier_company_id, effective_at DESC);
CREATE INDEX g_procurement_facts_sector_idx ON public.g_procurement_facts(sector, effective_at DESC);
CREATE INDEX g_procurement_facts_partner_idx ON public.g_procurement_facts(partner_company_id, fact_kind);
CREATE INDEX g_procurement_facts_kind_idx ON public.g_procurement_facts(fact_kind, effective_at DESC);

ALTER TABLE public.g_procurement_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.g_procurement_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY g_procurement_facts_internal ON public.g_procurement_facts
  FOR ALL TO sco_runtime
  USING (current_setting('app.sco_internal', true) = 'true')
  WITH CHECK (current_setting('app.sco_internal', true) = 'true');

ALTER TABLE public.g_intelligence_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.g_intelligence_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY g_intelligence_runs_internal ON public.g_intelligence_runs
  FOR ALL TO sco_runtime
  USING (current_setting('app.sco_internal', true) = 'true')
  WITH CHECK (current_setting('app.sco_internal', true) = 'true');

GRANT SELECT, INSERT, UPDATE ON public.g_procurement_facts, public.g_intelligence_runs TO sco_runtime;

CREATE OR REPLACE FUNCTION public.g_intelligence_capability(p_actor UUID, p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.internal_has_capability(p_actor, p_code)
     OR public.internal_has_capability(p_actor, 'sco.internal.manage');
$$;

CREATE OR REPLACE FUNCTION public.g_norm_text(p TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(lower(regexp_replace(btrim(COALESCE(p,'')), '\s+', ' ', 'g')), '');
$$;

CREATE OR REPLACE FUNCTION public.g_comparable_key(
  p_sector TEXT, p_description TEXT, p_specification TEXT,
  p_brand TEXT, p_model TEXT, p_unit UUID
) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(
    sha256(
      convert_to(
        COALESCE(public.g_norm_text(p_sector),'') || '|' ||
        COALESCE(public.g_norm_text(p_description),'') || '|' ||
        COALESCE(public.g_norm_text(p_specification),'') || '|' ||
        COALESCE(public.g_norm_text(p_brand),'') || '|' ||
        COALESCE(public.g_norm_text(p_model),'') || '|' ||
        COALESCE(p_unit::text,''),
        'UTF8'
      )
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION public.g_numeric_median(p_values NUMERIC[])
RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  n INT;
  sorted NUMERIC[];
BEGIN
  IF p_values IS NULL OR array_length(p_values, 1) IS NULL THEN RETURN NULL; END IF;
  SELECT array_agg(v ORDER BY v) INTO sorted FROM unnest(p_values) AS v WHERE v IS NOT NULL;
  n := COALESCE(array_length(sorted, 1), 0);
  IF n = 0 THEN RETURN NULL; END IF;
  IF n % 2 = 1 THEN
    RETURN sorted[(n + 1) / 2];
  END IF;
  RETURN (sorted[n / 2] + sorted[(n / 2) + 1]) / 2;
END $$;

CREATE OR REPLACE FUNCTION public.g_fact_upsert(
  p_source_key TEXT, p_fact_kind TEXT, p_domain TEXT, p_entity_type TEXT, p_entity_id UUID,
  p_revision TEXT, p_effective TIMESTAMPTZ, p_partner UUID, p_supplier UUID, p_sector TEXT,
  p_desc TEXT, p_spec TEXT, p_brand TEXT, p_model TEXT, p_unit UUID,
  p_currency TEXT, p_price NUMERIC, p_qty NUMERIC, p_tax TEXT, p_value TEXT, p_payload JSONB
) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_key TEXT;
  v_basis TEXT;
  v_existing UUID;
BEGIN
  IF p_unit IS NULL OR COALESCE(btrim(p_desc),'') = '' THEN RETURN 'skip'; END IF;
  v_key := p_source_key;
  v_basis := COALESCE(p_tax,'UNKNOWN') || '|' || COALESCE(p_value,'UNKNOWN');
  SELECT id INTO v_existing FROM public.g_procurement_facts WHERE source_key = v_key;
  IF v_existing IS NOT NULL THEN
    UPDATE public.g_procurement_facts SET
      fact_kind = p_fact_kind, source_domain = p_domain, source_entity_type = p_entity_type,
      source_entity_id = p_entity_id, source_revision = p_revision, effective_at = p_effective,
      partner_company_id = p_partner, supplier_company_id = p_supplier, sector = p_sector,
      comparable_key = public.g_comparable_key(p_sector, p_desc, p_spec, p_brand, p_model, p_unit),
      description_norm = public.g_norm_text(p_desc),
      specification_norm = public.g_norm_text(p_spec),
      brand_norm = public.g_norm_text(p_brand),
      model_norm = public.g_norm_text(p_model),
      unit_id = p_unit, currency_code = NULLIF(upper(btrim(COALESCE(p_currency,''))), ''),
      unit_price = p_price, quantity = p_qty, tax_state = p_tax, value_state = p_value,
      commercial_basis = v_basis, payload = COALESCE(p_payload,'{}'::jsonb),
      updated_at = clock_timestamp()
    WHERE id = v_existing;
    RETURN 'update';
  END IF;
  INSERT INTO public.g_procurement_facts(
    source_key, fact_kind, source_domain, source_entity_type, source_entity_id, source_revision,
    effective_at, partner_company_id, supplier_company_id, sector, comparable_key,
    description_norm, specification_norm, brand_norm, model_norm, unit_id, currency_code,
    unit_price, quantity, tax_state, value_state, commercial_basis, metric_version, payload
  ) VALUES (
    v_key, p_fact_kind, p_domain, p_entity_type, p_entity_id, p_revision, p_effective,
    p_partner, p_supplier, p_sector,
    public.g_comparable_key(p_sector, p_desc, p_spec, p_brand, p_model, p_unit),
    public.g_norm_text(p_desc), public.g_norm_text(p_spec), public.g_norm_text(p_brand),
    public.g_norm_text(p_model), p_unit, NULLIF(upper(btrim(COALESCE(p_currency,''))), ''),
    p_price, p_qty, p_tax, p_value, v_basis, 1, COALESCE(p_payload,'{}'::jsonb)
  );
  RETURN 'insert';
END $$;

CREATE OR REPLACE FUNCTION public.internal_g_intelligence_backfill(
  p_actor UUID, p_dry_run BOOLEAN, p_correlation UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_run UUID := gen_random_uuid();
  v_ins INT := 0; v_upd INT := 0; v_skip INT := 0;
  r RECORD; v_res TEXT; v_locked BOOLEAN;
BEGIN
  IF NOT public.g_intelligence_capability(p_actor, 'procurement.intelligence.refresh') THEN
    RAISE EXCEPTION 'G_INTELLIGENCE_REFRESH_FORBIDDEN';
  END IF;
  v_locked := pg_try_advisory_xact_lock(87231419);
  IF NOT v_locked THEN
    RAISE EXCEPTION 'G_INTELLIGENCE_BACKFILL_IN_PROGRESS';
  END IF;

  INSERT INTO public.g_intelligence_runs(id, actor_user_id, mode, dry_run, correlation_id)
  VALUES (v_run, p_actor, CASE WHEN p_dry_run THEN 'DRY_RUN' ELSE 'BACKFILL' END, COALESCE(p_dry_run,false), p_correlation);

  IF COALESCE(p_dry_run, false) THEN
    SELECT COUNT(*)::int INTO v_ins FROM public.procurement_requirement_quote_lines ql
      JOIN public.procurement_requirement_quotes q ON q.id = ql.quote_id
     WHERE ql.unit_price IS NOT NULL AND ql.unit_id IS NOT NULL AND ql.value_state IN ('QUOTED','EXPLICIT_ZERO','INCLUDED');
    UPDATE public.g_intelligence_runs SET finished_at = clock_timestamp(), facts_skipped = v_ins,
      summary = jsonb_build_object('dryRun', true, 'wouldObserveQuotes', v_ins, 'metricVersion', 1)
     WHERE id = v_run;
    PERFORM set_config('app.audit_system','true',true);
    INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
    VALUES (p_actor, NULL, 'SCO_INTERNAL', 'g.intelligence.backfill.dry_run', 'GIntelligenceRun', v_run,
            jsonb_build_object('wouldObserveQuotes', v_ins), p_correlation);
    RETURN jsonb_build_object('runId', v_run, 'dryRun', true, 'wouldObserveQuotes', v_ins, 'metricVersion', 1);
  END IF;

  -- D QUOTE_OBSERVED
  FOR r IN
    SELECT ql.id AS line_id, q.id AS quote_id, q.partner_company_id, q.supplier_company_id, q.currency_code,
           q.received_at, pr.sector, rl.description, rl.specification, rl.brand_preference, rl.model_preference,
           COALESCE(ql.unit_id, rl.unit_id) AS unit_id, ql.unit_price, COALESCE(ql.offered_quantity, rl.quantity) AS qty,
           ql.tax_state, ql.value_state, COALESCE(ql.offered_description, rl.description) AS desc_use
      FROM public.procurement_requirement_quote_lines ql
      JOIN public.procurement_requirement_quotes q ON q.id = ql.quote_id
      JOIN public.procurement_requirements pr ON pr.id = q.requirement_id
      LEFT JOIN public.procurement_requirement_lines rl ON rl.id = ql.requirement_line_id
     WHERE ql.unit_price IS NOT NULL AND COALESCE(ql.unit_id, rl.unit_id) IS NOT NULL
       AND ql.value_state IN ('QUOTED','EXPLICIT_ZERO','INCLUDED')
  LOOP
    v_res := public.g_fact_upsert(
      'D:QUOTE_LINE:' || r.line_id::text || ':v1', 'QUOTE_OBSERVED', 'D', 'ProcurementRequirementQuoteLine', r.line_id,
      'v1', COALESCE(r.received_at, clock_timestamp()), r.partner_company_id, r.supplier_company_id, r.sector,
      r.desc_use, r.specification, r.brand_preference, r.model_preference, r.unit_id,
      r.currency_code, r.unit_price, r.qty, r.tax_state, r.value_state,
      jsonb_build_object('quoteId', r.quote_id)
    );
    IF v_res = 'insert' THEN v_ins := v_ins + 1; ELSIF v_res = 'update' THEN v_upd := v_upd + 1; ELSE v_skip := v_skip + 1; END IF;
  END LOOP;

  -- D QUOTE_SELECTED (selected quote's priced lines)
  FOR r IN
    SELECT ql.id AS line_id, sc.id AS selection_id, sc.selected_at, q.partner_company_id, q.supplier_company_id,
           q.currency_code, pr.sector, rl.description, rl.specification, rl.brand_preference, rl.model_preference,
           COALESCE(ql.unit_id, rl.unit_id) AS unit_id, ql.unit_price, COALESCE(ql.offered_quantity, rl.quantity) AS qty,
           ql.tax_state, ql.value_state, COALESCE(ql.offered_description, rl.description) AS desc_use, q.id AS quote_id
      FROM public.procurement_selection_candidates sc
      JOIN public.procurement_requirement_quotes q ON q.id = sc.quote_id
      JOIN public.procurement_requirements pr ON pr.id = sc.requirement_id
      JOIN public.procurement_requirement_quote_lines ql ON ql.quote_id = q.id
      LEFT JOIN public.procurement_requirement_lines rl ON rl.id = ql.requirement_line_id
     WHERE ql.unit_price IS NOT NULL AND COALESCE(ql.unit_id, rl.unit_id) IS NOT NULL
       AND ql.value_state IN ('QUOTED','EXPLICIT_ZERO','INCLUDED')
  LOOP
    v_res := public.g_fact_upsert(
      'D:SELECTION_LINE:' || r.selection_id::text || ':' || r.line_id::text, 'QUOTE_SELECTED', 'D',
      'ProcurementSelectionCandidate', r.selection_id, r.line_id::text, r.selected_at,
      r.partner_company_id, r.supplier_company_id, r.sector,
      r.desc_use, r.specification, r.brand_preference, r.model_preference, r.unit_id,
      r.currency_code, r.unit_price, r.qty, r.tax_state, r.value_state,
      jsonb_build_object('quoteId', r.quote_id, 'quoteLineId', r.line_id)
    );
    IF v_res = 'insert' THEN v_ins := v_ins + 1; ELSIF v_res = 'update' THEN v_upd := v_upd + 1; ELSE v_skip := v_skip + 1; END IF;
  END LOOP;

  -- E PURCHASE_ORDER_ISSUED / SUPPLIER_CONFIRMED / PURCHASE_CANCELLED
  FOR r IN
    SELECT ol.id AS line_id, o.id AS order_id, o.status, o.issued_at, o.confirmed_at, o.supplier_company_id,
           o.currency_code, ol.partner_company_id, ol.description, ol.specification, ol.unit_id,
           ol.purchase_unit_price, ol.ordered_quantity, ol.confirmed_quantity, ol.tax_state,
           pr.sector, rl.brand_preference, rl.model_preference
      FROM public.commercial_supplier_order_lines ol
      JOIN public.commercial_supplier_orders o ON o.id = ol.order_id
      LEFT JOIN public.procurement_requirement_lines rl ON rl.id = ol.requirement_line_id
      LEFT JOIN public.procurement_requirements pr ON pr.id = rl.requirement_id
     WHERE o.status IN ('ISSUED','PARTIALLY_CONFIRMED','CONFIRMED','CANCELLED')
       AND o.issued_at IS NOT NULL
  LOOP
    v_res := public.g_fact_upsert(
      'E:PO_LINE_ISSUED:' || r.line_id::text, 'PURCHASE_ORDER_ISSUED', 'E', 'CommercialSupplierOrderLine', r.line_id,
      'issued', r.issued_at, r.partner_company_id, r.supplier_company_id, r.sector,
      r.description, r.specification, r.brand_preference, r.model_preference, r.unit_id,
      r.currency_code, r.purchase_unit_price, r.ordered_quantity, r.tax_state, 'PURCHASE',
      jsonb_build_object('orderId', r.order_id, 'status', r.status)
    );
    IF v_res = 'insert' THEN v_ins := v_ins + 1; ELSIF v_res = 'update' THEN v_upd := v_upd + 1; ELSE v_skip := v_skip + 1; END IF;

    IF r.status IN ('CONFIRMED','PARTIALLY_CONFIRMED') AND r.confirmed_at IS NOT NULL THEN
      v_res := public.g_fact_upsert(
        'E:PO_LINE_CONFIRMED:' || r.line_id::text || ':' || COALESCE(r.confirmed_quantity::text,'null'),
        'SUPPLIER_CONFIRMED', 'E', 'CommercialSupplierOrderLine', r.line_id,
        'confirmed:' || COALESCE(r.confirmed_quantity::text,'null'), r.confirmed_at,
        r.partner_company_id, r.supplier_company_id, r.sector,
        r.description, r.specification, r.brand_preference, r.model_preference, r.unit_id,
        r.currency_code, r.purchase_unit_price, COALESCE(r.confirmed_quantity, r.ordered_quantity),
        r.tax_state, 'PURCHASE',
        jsonb_build_object('orderId', r.order_id, 'issuedAt', r.issued_at)
      );
      IF v_res = 'insert' THEN v_ins := v_ins + 1; ELSIF v_res = 'update' THEN v_upd := v_upd + 1; ELSE v_skip := v_skip + 1; END IF;
    END IF;

    IF r.status = 'CANCELLED' THEN
      v_res := public.g_fact_upsert(
        'E:PO_LINE_CANCELLED:' || r.line_id::text, 'PURCHASE_CANCELLED', 'E', 'CommercialSupplierOrderLine', r.line_id,
        'cancelled', COALESCE(o_updated(r.order_id), r.issued_at), r.partner_company_id, r.supplier_company_id, r.sector,
        r.description, r.specification, r.brand_preference, r.model_preference, r.unit_id,
        r.currency_code, r.purchase_unit_price, r.ordered_quantity, r.tax_state, 'PURCHASE',
        jsonb_build_object('orderId', r.order_id)
      );
      IF v_res = 'insert' THEN v_ins := v_ins + 1; ELSIF v_res = 'update' THEN v_upd := v_upd + 1; ELSE v_skip := v_skip + 1; END IF;
    END IF;
  END LOOP;

  -- confirmation revisions from audit
  FOR r IN
    SELECT a.id AS audit_id, a.created_at, a.entity_id AS order_id, a.metadata, ol.id AS line_id,
           ol.partner_company_id, o.supplier_company_id, o.currency_code, ol.description, ol.specification,
           ol.unit_id, ol.purchase_unit_price, ol.ordered_quantity, ol.tax_state, pr.sector,
           rl.brand_preference, rl.model_preference
      FROM public.audit_logs a
      JOIN public.commercial_supplier_orders o ON o.id = a.entity_id
      JOIN public.commercial_supplier_order_lines ol ON ol.order_id = o.id
        AND ol.id = NULLIF(a.metadata->>'lineId','')::uuid
      LEFT JOIN public.procurement_requirement_lines rl ON rl.id = ol.requirement_line_id
      LEFT JOIN public.procurement_requirements pr ON pr.id = rl.requirement_id
     WHERE a.action = 'commercial.supplier_order.confirmation_revised'
  LOOP
    v_res := public.g_fact_upsert(
      'E:CONFIRM_REV:' || r.audit_id::text, 'SUPPLIER_CONFIRMATION_REVISED', 'E', 'AuditLog', r.audit_id,
      'v1', r.created_at, r.partner_company_id, r.supplier_company_id, r.sector,
      r.description, r.specification, r.brand_preference, r.model_preference, r.unit_id,
      r.currency_code, r.purchase_unit_price, r.ordered_quantity, r.tax_state, 'PURCHASE',
      COALESCE(r.metadata,'{}'::jsonb)
    );
    IF v_res = 'insert' THEN v_ins := v_ins + 1; ELSIF v_res = 'update' THEN v_upd := v_upd + 1; ELSE v_skip := v_skip + 1; END IF;
  END LOOP;

  -- E PARTNER_ALLOCATION
  FOR r IN
    SELECT a.id, a.created_at, a.partner_company_id, a.allocated_quantity, a.purchase_unit_price,
           ol.description, ol.specification, ol.unit_id, ol.tax_state, o.supplier_company_id, o.currency_code,
           pr.sector, rl.brand_preference, rl.model_preference
      FROM public.commercial_partner_allocations a
      JOIN public.commercial_supplier_order_lines ol ON ol.id = a.supplier_order_line_id
      JOIN public.commercial_supplier_orders o ON o.id = a.supplier_order_id
      LEFT JOIN public.procurement_requirement_lines rl ON rl.id = a.requirement_line_id
      LEFT JOIN public.procurement_requirements pr ON pr.id = a.requirement_id
     WHERE a.status IN ('ACTIVE','CONSUMED')
  LOOP
    v_res := public.g_fact_upsert(
      'E:ALLOC:' || r.id::text, 'PARTNER_ALLOCATION', 'E', 'CommercialPartnerAllocation', r.id,
      'v1', r.created_at, r.partner_company_id, r.supplier_company_id, r.sector,
      r.description, r.specification, r.brand_preference, r.model_preference, r.unit_id,
      r.currency_code, r.purchase_unit_price, r.allocated_quantity, r.tax_state, 'PURCHASE',
      '{}'::jsonb
    );
    IF v_res = 'insert' THEN v_ins := v_ins + 1; ELSIF v_res = 'update' THEN v_upd := v_upd + 1; ELSE v_skip := v_skip + 1; END IF;
  END LOOP;

  -- F ENGINEERING_DEMAND from approved BOQ lines
  FOR r IN
    SELECT l.id AS line_id, v.id AS version_id, v.approved_at, v.version_number, er.company_id, er.sector,
           l.description, l.specification, l.brand_preference, l.model_preference, l.unit_id, l.quantity, l.discipline
      FROM public.engineering_boq_lines l
      JOIN public.engineering_boq_versions v ON v.id = l.boq_version_id
      JOIN public.engineering_requests er ON er.id = v.request_id
     WHERE v.status IN ('APPROVED','SUPERSEDED') AND v.approved_at IS NOT NULL
  LOOP
    v_res := public.g_fact_upsert(
      'F:BOQ_LINE:' || r.line_id::text || ':v' || r.version_number::text, 'ENGINEERING_DEMAND', 'F',
      'EngineeringBoqLine', r.line_id, 'v' || r.version_number::text, r.approved_at,
      r.company_id, NULL, r.sector,
      r.description, r.specification, r.brand_preference, r.model_preference, r.unit_id,
      NULL, NULL, r.quantity, NULL, 'DEMAND',
      jsonb_build_object('boqVersionId', r.version_id, 'discipline', r.discipline)
    );
    IF v_res = 'insert' THEN v_ins := v_ins + 1; ELSIF v_res = 'update' THEN v_upd := v_upd + 1; ELSE v_skip := v_skip + 1; END IF;
  END LOOP;

  UPDATE public.g_intelligence_runs SET
    finished_at = clock_timestamp(), facts_inserted = v_ins, facts_updated = v_upd, facts_skipped = v_skip,
    summary = jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip, 'metricVersion', 1,
      'verifyIngested', false)
   WHERE id = v_run;

  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'g.intelligence.backfill', 'GIntelligenceRun', v_run,
          jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip, 'metricVersion', 1), p_correlation);

  RETURN jsonb_build_object(
    'runId', v_run, 'dryRun', false, 'inserted', v_ins, 'updated', v_upd, 'skipped', v_skip,
    'metricVersion', 1, 'verifyIngested', false
  );
END $$;

-- helper for cancelled effective time
CREATE OR REPLACE FUNCTION public.o_updated(p_order UUID)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$
  SELECT updated_at FROM public.commercial_supplier_orders WHERE id = p_order;
$$;

CREATE OR REPLACE FUNCTION public.g_price_stats(p_prices NUMERIC[])
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  n INT; v_min NUMERIC; v_max NUMERIC; v_sum NUMERIC; v_mean NUMERIC; v_med NUMERIC;
BEGIN
  SELECT COUNT(*), MIN(v), MAX(v), SUM(v) INTO n, v_min, v_max, v_sum
  FROM unnest(p_prices) AS v WHERE v IS NOT NULL;
  IF n IS NULL OR n = 0 THEN
    RETURN jsonb_build_object('sampleCount', 0);
  END IF;
  v_mean := v_sum / n;
  v_med := public.g_numeric_median(p_prices);
  RETURN jsonb_build_object(
    'sampleCount', n, 'min', v_min, 'max', v_max, 'mean', v_mean, 'median', v_med
  );
END $$;

CREATE OR REPLACE FUNCTION public.internal_g_price_history(
  p_actor UUID, p_comparable TEXT, p_sector TEXT, p_supplier UUID,
  p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_currency TEXT, p_unit UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_quote NUMERIC[]; v_selected NUMERIC[]; v_purchase NUMERIC[];
  v_out JSONB; v_max TIMESTAMPTZ; v_first TIMESTAMPTZ; v_suppliers INT;
BEGIN
  IF NOT public.g_intelligence_capability(p_actor, 'procurement.intelligence.read') THEN
    RAISE EXCEPTION 'G_INTELLIGENCE_READ_FORBIDDEN';
  END IF;

  SELECT array_agg(unit_price ORDER BY effective_at), MIN(effective_at), MAX(effective_at)
    INTO v_quote, v_first, v_max
    FROM public.g_procurement_facts
   WHERE fact_kind = 'QUOTE_OBSERVED'
     AND (p_comparable IS NULL OR comparable_key = p_comparable)
     AND (p_sector IS NULL OR sector = p_sector)
     AND (p_supplier IS NULL OR supplier_company_id = p_supplier)
     AND (p_from IS NULL OR effective_at >= p_from)
     AND (p_to IS NULL OR effective_at <= p_to)
     AND (p_currency IS NULL OR currency_code = upper(p_currency))
     AND (p_unit IS NULL OR unit_id = p_unit)
     AND unit_price IS NOT NULL;

  SELECT array_agg(unit_price ORDER BY effective_at) INTO v_selected
    FROM public.g_procurement_facts
   WHERE fact_kind = 'QUOTE_SELECTED'
     AND (p_comparable IS NULL OR comparable_key = p_comparable)
     AND (p_sector IS NULL OR sector = p_sector)
     AND (p_supplier IS NULL OR supplier_company_id = p_supplier)
     AND (p_from IS NULL OR effective_at >= p_from)
     AND (p_to IS NULL OR effective_at <= p_to)
     AND (p_currency IS NULL OR currency_code = upper(p_currency))
     AND (p_unit IS NULL OR unit_id = p_unit)
     AND unit_price IS NOT NULL;

  SELECT array_agg(unit_price ORDER BY effective_at),
         COALESCE(MAX(effective_at), v_max),
         COALESCE(MIN(effective_at), v_first)
    INTO v_purchase, v_max, v_first
    FROM public.g_procurement_facts
   WHERE fact_kind = 'SUPPLIER_CONFIRMED'
     AND (p_comparable IS NULL OR comparable_key = p_comparable)
     AND (p_sector IS NULL OR sector = p_sector)
     AND (p_supplier IS NULL OR supplier_company_id = p_supplier)
     AND (p_from IS NULL OR effective_at >= p_from)
     AND (p_to IS NULL OR effective_at <= p_to)
     AND (p_currency IS NULL OR currency_code = upper(p_currency))
     AND (p_unit IS NULL OR unit_id = p_unit)
     AND unit_price IS NOT NULL;

  SELECT COUNT(DISTINCT supplier_company_id)::int INTO v_suppliers
    FROM public.g_procurement_facts
   WHERE fact_kind IN ('QUOTE_OBSERVED','QUOTE_SELECTED','SUPPLIER_CONFIRMED')
     AND (p_comparable IS NULL OR comparable_key = p_comparable)
     AND (p_sector IS NULL OR sector = p_sector)
     AND (p_from IS NULL OR effective_at >= p_from)
     AND (p_to IS NULL OR effective_at <= p_to)
     AND (p_currency IS NULL OR currency_code = upper(p_currency))
     AND (p_unit IS NULL OR unit_id = p_unit);

  v_out := jsonb_build_object(
    'calculatedAt', clock_timestamp(),
    'sourceMaxEffectiveAt', v_max,
    'firstObserved', v_first,
    'currencyCode', upper(NULLIF(p_currency,'')),
    'unitId', p_unit,
    'comparableKey', p_comparable,
    'sector', p_sector,
    'supplierCount', COALESCE(v_suppliers,0),
    'metricVersion', 1,
    'quotedHistory', public.g_price_stats(v_quote) || jsonb_build_object(
      'latest', (SELECT unit_price FROM public.g_procurement_facts
                  WHERE fact_kind='QUOTE_OBSERVED'
                    AND (p_comparable IS NULL OR comparable_key=p_comparable)
                    AND (p_sector IS NULL OR sector=p_sector)
                    AND (p_currency IS NULL OR currency_code=upper(p_currency))
                    AND (p_unit IS NULL OR unit_id=p_unit)
                    AND unit_price IS NOT NULL
                    AND (p_from IS NULL OR effective_at >= p_from)
                    AND (p_to IS NULL OR effective_at <= p_to)
                  ORDER BY effective_at DESC LIMIT 1)
    ),
    'selectedQuoteHistory', public.g_price_stats(v_selected) || jsonb_build_object(
      'latest', (SELECT unit_price FROM public.g_procurement_facts
                  WHERE fact_kind='QUOTE_SELECTED'
                    AND (p_comparable IS NULL OR comparable_key=p_comparable)
                    AND (p_sector IS NULL OR sector=p_sector)
                    AND (p_currency IS NULL OR currency_code=upper(p_currency))
                    AND (p_unit IS NULL OR unit_id=p_unit)
                    AND unit_price IS NOT NULL
                  ORDER BY effective_at DESC LIMIT 1)
    ),
    'confirmedPurchaseHistory', public.g_price_stats(v_purchase) || jsonb_build_object(
      'latest', (SELECT unit_price FROM public.g_procurement_facts
                  WHERE fact_kind='SUPPLIER_CONFIRMED'
                    AND (p_comparable IS NULL OR comparable_key=p_comparable)
                    AND (p_sector IS NULL OR sector=p_sector)
                    AND (p_currency IS NULL OR currency_code=upper(p_currency))
                    AND (p_unit IS NULL OR unit_id=p_unit)
                    AND unit_price IS NOT NULL
                  ORDER BY effective_at DESC LIMIT 1)
    )
  );
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.internal_g_quote_benchmark(
  p_actor UUID, p_quote_line UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  ql RECORD; q RECORD; rl RECORD; pr RECORD;
  v_key TEXT; v_prices NUMERIC[]; v_stats JSONB; v_signal TEXT;
  v_min NUMERIC; v_max NUMERIC; v_count INT; v_suppliers INT; v_max_at TIMESTAMPTZ;
  v_delta NUMERIC; v_pct NUMERIC;
BEGIN
  IF NOT public.g_intelligence_capability(p_actor, 'procurement.intelligence.read') THEN
    RAISE EXCEPTION 'G_INTELLIGENCE_READ_FORBIDDEN';
  END IF;
  SELECT * INTO ql FROM public.procurement_requirement_quote_lines WHERE id = p_quote_line;
  IF NOT FOUND THEN RAISE EXCEPTION 'G_QUOTE_LINE_NOT_FOUND'; END IF;
  SELECT * INTO q FROM public.procurement_requirement_quotes WHERE id = ql.quote_id;
  SELECT * INTO rl FROM public.procurement_requirement_lines WHERE id = ql.requirement_line_id;
  SELECT * INTO pr FROM public.procurement_requirements WHERE id = q.requirement_id;
  IF ql.unit_price IS NULL OR COALESCE(ql.unit_id, rl.unit_id) IS NULL THEN
    RETURN jsonb_build_object(
      'signal', 'INSUFFICIENT_EVIDENCE', 'reason', 'CURRENT_QUOTE_MISSING_PRICE_OR_UNIT',
      'calculatedAt', clock_timestamp(), 'metricVersion', 1
    );
  END IF;
  v_key := public.g_comparable_key(
    pr.sector, COALESCE(ql.offered_description, rl.description), rl.specification,
    rl.brand_preference, rl.model_preference, COALESCE(ql.unit_id, rl.unit_id)
  );

  SELECT array_agg(unit_price), MIN(unit_price), MAX(unit_price), COUNT(*)::int,
         COUNT(DISTINCT supplier_company_id)::int, MAX(effective_at)
    INTO v_prices, v_min, v_max, v_count, v_suppliers, v_max_at
    FROM public.g_procurement_facts
   WHERE comparable_key = v_key
     AND unit_id = COALESCE(ql.unit_id, rl.unit_id)
     AND currency_code = q.currency_code
     AND commercial_basis = (COALESCE(ql.tax_state,'UNKNOWN') || '|' || COALESCE(ql.value_state,'UNKNOWN'))
     AND fact_kind IN ('SUPPLIER_CONFIRMED','QUOTE_OBSERVED')
     AND unit_price IS NOT NULL
     AND source_entity_id IS DISTINCT FROM ql.id;

  IF v_count IS NULL OR v_count = 0 THEN
    -- fallback: ignore commercial_basis mismatch exclusion by requiring same tax_state only if samples exist
    SELECT array_agg(unit_price), MIN(unit_price), MAX(unit_price), COUNT(*)::int,
           COUNT(DISTINCT supplier_company_id)::int, MAX(effective_at)
      INTO v_prices, v_min, v_max, v_count, v_suppliers, v_max_at
      FROM public.g_procurement_facts
     WHERE comparable_key = v_key
       AND unit_id = COALESCE(ql.unit_id, rl.unit_id)
       AND currency_code = q.currency_code
       AND fact_kind IN ('SUPPLIER_CONFIRMED','QUOTE_OBSERVED')
       AND unit_price IS NOT NULL
       AND source_entity_id IS DISTINCT FROM ql.id;
  END IF;

  IF v_count IS NULL OR v_count = 0 THEN
    RETURN jsonb_build_object(
      'signal', 'INSUFFICIENT_EVIDENCE', 'currentQuoteValue', ql.unit_price,
      'comparableKey', v_key, 'currencyCode', q.currency_code,
      'unitId', COALESCE(ql.unit_id, rl.unit_id), 'sampleCount', 0,
      'calculatedAt', clock_timestamp(), 'metricVersion', 1
    );
  END IF;

  v_stats := public.g_price_stats(v_prices);
  v_delta := ql.unit_price - ((v_min + v_max) / 2);
  IF v_max = v_min THEN v_pct := CASE WHEN ql.unit_price = v_max THEN 0 ELSE NULL END;
  ELSE v_pct := round(((ql.unit_price - v_min) / NULLIF(v_max - v_min, 0)) * 100, 4); END IF;

  IF ql.unit_price > v_max THEN v_signal := 'ABOVE_HISTORICAL_RANGE';
  ELSIF ql.unit_price < v_min THEN v_signal := 'BELOW_HISTORICAL_RANGE';
  ELSE v_signal := 'WITHIN_HISTORICAL_RANGE'; END IF;

  RETURN jsonb_build_object(
    'signal', v_signal,
    'currentQuoteValue', ql.unit_price,
    'comparableConfirmedPurchaseStats', (
      SELECT public.g_price_stats(array_agg(unit_price)) FROM public.g_procurement_facts
       WHERE comparable_key=v_key AND unit_id=COALESCE(ql.unit_id,rl.unit_id)
         AND currency_code=q.currency_code AND fact_kind='SUPPLIER_CONFIRMED' AND unit_price IS NOT NULL
    ),
    'comparableQuoteStats', (
      SELECT public.g_price_stats(array_agg(unit_price)) FROM public.g_procurement_facts
       WHERE comparable_key=v_key AND unit_id=COALESCE(ql.unit_id,rl.unit_id)
         AND currency_code=q.currency_code AND fact_kind='QUOTE_OBSERVED' AND unit_price IS NOT NULL
         AND source_entity_id IS DISTINCT FROM ql.id
    ),
    'combinedStats', v_stats,
    'deltaAmount', ql.unit_price - COALESCE((v_stats->>'median')::numeric, (v_min+v_max)/2),
    'deltaPercentageVsRange', v_pct,
    'sampleCount', v_count,
    'supplierCount', v_suppliers,
    'sourceMaxEffectiveAt', v_max_at,
    'freshness', jsonb_build_object('calculatedAt', clock_timestamp(), 'sourceMaxEffectiveAt', v_max_at),
    'comparableKey', v_key,
    'currencyCode', q.currency_code,
    'unitId', COALESCE(ql.unit_id, rl.unit_id),
    'metricVersion', 1,
    'evidenceCoverage', jsonb_build_object(
      'purchaseSamples', (SELECT COUNT(*) FROM public.g_procurement_facts WHERE comparable_key=v_key AND fact_kind='SUPPLIER_CONFIRMED' AND currency_code=q.currency_code AND unit_id=COALESCE(ql.unit_id,rl.unit_id)),
      'quoteSamples', (SELECT COUNT(*) FROM public.g_procurement_facts WHERE comparable_key=v_key AND fact_kind='QUOTE_OBSERVED' AND currency_code=q.currency_code AND unit_id=COALESCE(ql.unit_id,rl.unit_id) AND source_entity_id IS DISTINCT FROM ql.id)
    )
  );
END $$;

CREATE OR REPLACE FUNCTION public.internal_g_supplier_performance(
  p_actor UUID, p_supplier UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_po INT; v_confirmed INT; v_cancelled INT; v_value NUMERIC; v_rev INT;
  v_latencies NUMERIC[]; v_avg_lat NUMERIC; v_categories INT; v_last TIMESTAMPTZ;
  v_denom INT;
BEGIN
  IF NOT public.g_intelligence_capability(p_actor, 'procurement.intelligence.read') THEN
    RAISE EXCEPTION 'G_INTELLIGENCE_READ_FORBIDDEN';
  END IF;
  IF p_supplier IS NULL THEN RAISE EXCEPTION 'G_SUPPLIER_REQUIRED'; END IF;

  SELECT COUNT(*)::int INTO v_po FROM public.commercial_supplier_orders
   WHERE supplier_company_id = p_supplier AND status IN ('ISSUED','PARTIALLY_CONFIRMED','CONFIRMED','CANCELLED') AND issued_at IS NOT NULL;

  SELECT COUNT(*)::int INTO v_confirmed FROM public.commercial_supplier_orders
   WHERE supplier_company_id = p_supplier AND status IN ('CONFIRMED','PARTIALLY_CONFIRMED') AND confirmed_at IS NOT NULL;

  SELECT COUNT(*)::int INTO v_cancelled FROM public.commercial_supplier_orders
   WHERE supplier_company_id = p_supplier AND status = 'CANCELLED' AND issued_at IS NOT NULL;

  -- Cancellation rate denominator = issued POs (including later cancelled). Formula v1.
  v_denom := v_po;

  SELECT COALESCE(SUM(purchase_total),0) INTO v_value FROM public.commercial_supplier_orders
   WHERE supplier_company_id = p_supplier AND status IN ('CONFIRMED','PARTIALLY_CONFIRMED');

  SELECT COUNT(*)::int INTO v_rev FROM public.g_procurement_facts
   WHERE fact_kind = 'SUPPLIER_CONFIRMATION_REVISED' AND supplier_company_id = p_supplier;

  SELECT array_agg(EXTRACT(EPOCH FROM (confirmed_at - issued_at))::numeric)
    INTO v_latencies
    FROM public.commercial_supplier_orders
   WHERE supplier_company_id = p_supplier
     AND issued_at IS NOT NULL AND confirmed_at IS NOT NULL
     AND status IN ('CONFIRMED','PARTIALLY_CONFIRMED')
     AND confirmed_at >= issued_at;

  IF v_latencies IS NOT NULL AND array_length(v_latencies,1) > 0 THEN
    SELECT AVG(v) INTO v_avg_lat FROM unnest(v_latencies) v;
  END IF;

  SELECT COUNT(DISTINCT sector)::int, MAX(effective_at) INTO v_categories, v_last
    FROM public.g_procurement_facts WHERE supplier_company_id = p_supplier AND sector IS NOT NULL;

  RETURN jsonb_build_object(
    'supplierCompanyId', p_supplier,
    'poCount', COALESCE(v_po,0),
    'confirmedPoCount', COALESCE(v_confirmed,0),
    'commercialPurchaseValue', v_value,
    'confirmationLatencySecondsMean', v_avg_lat,
    'confirmationLatencySampleCount', COALESCE(array_length(v_latencies,1),0),
    'confirmationRevisionCount', COALESCE(v_rev,0),
    'confirmationRevisionRate', CASE WHEN COALESCE(v_confirmed,0)=0 THEN NULL ELSE round(v_rev::numeric / v_confirmed, 6) END,
    'cancellationCount', COALESCE(v_cancelled,0),
    'cancellationRate', CASE WHEN COALESCE(v_denom,0)=0 THEN NULL ELSE round(v_cancelled::numeric / v_denom, 6) END,
    'cancellationRateFormulaVersion', 1,
    'cancellationRateDenominator', 'issued_po_count_including_cancelled',
    'categoryCount', COALESCE(v_categories,0),
    'lastActivityAt', v_last,
    'deliveryMetrics', NULL,
    'calculatedAt', clock_timestamp(),
    'metricVersion', 1
  );
END $$;

CREATE OR REPLACE FUNCTION public.internal_g_category_intelligence(
  p_actor UUID, p_sector TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT public.g_intelligence_capability(p_actor, 'procurement.intelligence.read') THEN
    RAISE EXCEPTION 'G_INTELLIGENCE_READ_FORBIDDEN';
  END IF;
  IF COALESCE(btrim(p_sector),'') = '' THEN RAISE EXCEPTION 'G_SECTOR_REQUIRED'; END IF;

  RETURN jsonb_build_object(
    'sector', p_sector,
    'quoteActivity', (SELECT COUNT(*) FROM public.g_procurement_facts WHERE sector=p_sector AND fact_kind='QUOTE_OBSERVED'),
    'purchaseActivity', (SELECT COUNT(*) FROM public.g_procurement_facts WHERE sector=p_sector AND fact_kind='SUPPLIER_CONFIRMED'),
    'commercialPurchaseValue', (
      SELECT COALESCE(SUM(unit_price * COALESCE(quantity,0)),0) FROM public.g_procurement_facts
       WHERE sector=p_sector AND fact_kind='SUPPLIER_CONFIRMED' AND unit_price IS NOT NULL
    ),
    'supplierCount', (SELECT COUNT(DISTINCT supplier_company_id) FROM public.g_procurement_facts WHERE sector=p_sector AND supplier_company_id IS NOT NULL),
    'partnerDemandCount', (SELECT COUNT(*) FROM public.g_procurement_facts WHERE sector=p_sector AND fact_kind IN ('ENGINEERING_DEMAND','PARTNER_ALLOCATION','QUOTE_OBSERVED')),
    'itemCount', (SELECT COUNT(DISTINCT comparable_key) FROM public.g_procurement_facts WHERE sector=p_sector),
    'priceCoverage', jsonb_build_object(
      'quotedItems', (SELECT COUNT(DISTINCT comparable_key) FROM public.g_procurement_facts WHERE sector=p_sector AND fact_kind='QUOTE_OBSERVED'),
      'purchasedItems', (SELECT COUNT(DISTINCT comparable_key) FROM public.g_procurement_facts WHERE sector=p_sector AND fact_kind='SUPPLIER_CONFIRMED')
    ),
    'demandActivity30d', (SELECT COUNT(*) FROM public.g_procurement_facts WHERE sector=p_sector AND fact_kind IN ('ENGINEERING_DEMAND','QUOTE_OBSERVED') AND effective_at >= v_now - interval '30 days'),
    'demandActivity90d', (SELECT COUNT(*) FROM public.g_procurement_facts WHERE sector=p_sector AND fact_kind IN ('ENGINEERING_DEMAND','QUOTE_OBSERVED') AND effective_at >= v_now - interval '90 days'),
    'recentActivityAt', (SELECT MAX(effective_at) FROM public.g_procurement_facts WHERE sector=p_sector),
    'calculatedAt', v_now,
    'metricVersion', 1
  );
END $$;

CREATE OR REPLACE FUNCTION public.internal_g_demand_signals(
  p_actor UUID, p_sector TEXT, p_window_days INT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_days INT := COALESCE(NULLIF(p_window_days,0), 90);
  v_from TIMESTAMPTZ := clock_timestamp() - make_interval(days => v_days);
BEGIN
  IF NOT public.g_intelligence_capability(p_actor, 'procurement.intelligence.read') THEN
    RAISE EXCEPTION 'G_INTELLIGENCE_READ_FORBIDDEN';
  END IF;

  RETURN jsonb_build_object(
    'windowDays', v_days,
    'sector', p_sector,
    'semantics', 'observed_operational_demand_only',
    'openDemand', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'requirementId', r.id, 'title', r.title, 'sector', r.sector, 'status', r.status,
        'lineCount', (SELECT COUNT(*) FROM public.procurement_requirement_lines l WHERE l.requirement_id=r.id),
        'submittedAt', r.submitted_at
      ) ORDER BY r.updated_at DESC), '[]'::jsonb)
      FROM public.procurement_requirements r
      WHERE r.status IN ('SUBMITTED','IN_REVIEW','SOURCING','QUOTES_RECEIVED','COMPARISON_READY','SELECTION_READY')
        AND (p_sector IS NULL OR r.sector = p_sector)
    ),
    'recentEngineeringDemand', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'factId', f.id, 'comparableKey', f.comparable_key, 'description', f.description_norm,
        'quantity', f.quantity, 'unitId', f.unit_id, 'effectiveAt', f.effective_at,
        'partnerCompanyId', f.partner_company_id, 'sourceEntityId', f.source_entity_id
      ) ORDER BY f.effective_at DESC), '[]'::jsonb)
      FROM (
        SELECT * FROM public.g_procurement_facts
         WHERE fact_kind='ENGINEERING_DEMAND'
           AND effective_at >= v_from
           AND (p_sector IS NULL OR sector = p_sector)
         ORDER BY effective_at DESC LIMIT 100
      ) f
    ),
    'historicalCommercialActivity', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'factId', f.id, 'factKind', f.fact_kind, 'comparableKey', f.comparable_key,
        'quantity', f.quantity, 'unitPrice', f.unit_price, 'currencyCode', f.currency_code,
        'effectiveAt', f.effective_at
      ) ORDER BY f.effective_at DESC), '[]'::jsonb)
      FROM (
        SELECT * FROM public.g_procurement_facts
         WHERE fact_kind IN ('SUPPLIER_CONFIRMED','PARTNER_ALLOCATION')
           AND effective_at >= v_from
           AND (p_sector IS NULL OR sector = p_sector)
         ORDER BY effective_at DESC LIMIT 100
      ) f
    ),
    'calculatedAt', clock_timestamp(),
    'sourceMaxEffectiveAt', (SELECT MAX(effective_at) FROM public.g_procurement_facts WHERE (p_sector IS NULL OR sector=p_sector)),
    'metricVersion', 1
  );
END $$;

CREATE OR REPLACE FUNCTION public.internal_g_decision_support(
  p_actor UUID, p_quote_line UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_bench JSONB; v_key TEXT; v_supplier UUID; v_sector TEXT; v_hist JSONB; v_sup JSONB; v_cat JSONB;
BEGIN
  IF NOT public.g_intelligence_capability(p_actor, 'procurement.intelligence.read') THEN
    RAISE EXCEPTION 'G_INTELLIGENCE_READ_FORBIDDEN';
  END IF;
  v_bench := public.internal_g_quote_benchmark(p_actor, p_quote_line);
  v_key := v_bench->>'comparableKey';
  SELECT q.supplier_company_id, pr.sector INTO v_supplier, v_sector
    FROM public.procurement_requirement_quote_lines ql
    JOIN public.procurement_requirement_quotes q ON q.id = ql.quote_id
    JOIN public.procurement_requirements pr ON pr.id = q.requirement_id
   WHERE ql.id = p_quote_line;
  v_hist := public.internal_g_price_history(p_actor, v_key, v_sector, NULL, NULL, NULL, v_bench->>'currencyCode', NULLIF(v_bench->>'unitId','')::uuid);
  IF v_supplier IS NOT NULL THEN
    v_sup := public.internal_g_supplier_performance(p_actor, v_supplier);
  END IF;
  IF v_sector IS NOT NULL THEN
    v_cat := public.internal_g_category_intelligence(p_actor, v_sector);
  END IF;
  RETURN jsonb_build_object(
    'benchmark', v_bench,
    'priceHistory', v_hist,
    'supplierPerformance', v_sup,
    'categorySignal', v_cat,
    'evidenceCounts', v_bench->'evidenceCoverage',
    'freshness', v_bench->'freshness',
    'actionExecution', false,
    'calculatedAt', clock_timestamp(),
    'metricVersion', 1
  );
END $$;

CREATE OR REPLACE FUNCTION public.internal_g_evidence_list(
  p_actor UUID, p_comparable TEXT, p_fact_kind TEXT, p_limit INT, p_offset INT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit,50),1),200);
  v_offset INT := GREATEST(COALESCE(p_offset,0),0);
  v_total INT;
BEGIN
  IF NOT public.g_intelligence_capability(p_actor, 'procurement.intelligence.read') THEN
    RAISE EXCEPTION 'G_INTELLIGENCE_READ_FORBIDDEN';
  END IF;
  SELECT COUNT(*)::int INTO v_total FROM public.g_procurement_facts
   WHERE (p_comparable IS NULL OR comparable_key = p_comparable)
     AND (p_fact_kind IS NULL OR fact_kind = p_fact_kind);
  RETURN jsonb_build_object(
    'total', v_total, 'limit', v_limit, 'offset', v_offset,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'factId', f.id,
        'factKind', f.fact_kind,
        'sourceDomain', f.source_domain,
        'sourceEntityType', f.source_entity_type,
        'sourceEntityId', f.source_entity_id,
        'effectiveAt', f.effective_at,
        'unitPrice', f.unit_price,
        'currencyCode', f.currency_code,
        'unitId', f.unit_id,
        'sector', f.sector,
        'supplierCompanyId', f.supplier_company_id,
        'comparableKey', f.comparable_key
      ) ORDER BY f.effective_at DESC)
      FROM (
        SELECT * FROM public.g_procurement_facts
         WHERE (p_comparable IS NULL OR comparable_key = p_comparable)
           AND (p_fact_kind IS NULL OR fact_kind = p_fact_kind)
         ORDER BY effective_at DESC
         LIMIT v_limit OFFSET v_offset
      ) f
    ), '[]'::jsonb),
    'calculatedAt', clock_timestamp(),
    'metricVersion', 1
  );
END $$;

-- Grants
REVOKE ALL ON FUNCTION public.g_intelligence_capability(UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.g_norm_text(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.g_comparable_key(TEXT,TEXT,TEXT,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.g_numeric_median(NUMERIC[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.g_price_stats(NUMERIC[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.g_fact_upsert(TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TIMESTAMPTZ,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.o_updated(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_g_intelligence_backfill(UUID,BOOLEAN,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_g_price_history(UUID,TEXT,TEXT,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_g_quote_benchmark(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_g_supplier_performance(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_g_category_intelligence(UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_g_demand_signals(UUID,TEXT,INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_g_decision_support(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_g_evidence_list(UUID,TEXT,TEXT,INT,INT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.g_intelligence_capability(UUID,TEXT) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.g_norm_text(TEXT) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.g_comparable_key(TEXT,TEXT,TEXT,TEXT,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.g_numeric_median(NUMERIC[]) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.g_price_stats(NUMERIC[]) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_g_intelligence_backfill(UUID,BOOLEAN,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_g_price_history(UUID,TEXT,TEXT,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_g_quote_benchmark(UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_g_supplier_performance(UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_g_category_intelligence(UUID,TEXT) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_g_demand_signals(UUID,TEXT,INT) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_g_decision_support(UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_g_evidence_list(UUID,TEXT,TEXT,INT,INT) TO sco_runtime;
