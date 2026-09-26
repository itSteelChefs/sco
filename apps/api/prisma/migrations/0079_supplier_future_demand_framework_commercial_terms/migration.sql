CREATE TYPE public."SupplierFutureDemandFrameworkPricingKind" AS ENUM ('FIXED', 'TIERED');
CREATE TYPE public."SupplierFutureDemandFrameworkSignalClass" AS ENUM ('QUALIFIED', 'COMMITTED');

CREATE TABLE public.supplier_future_demand_framework_commercial_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id UUID NOT NULL REFERENCES public.supplier_future_demand_framework_revisions(id) ON DELETE RESTRICT,
  product_identity_id UUID NOT NULL REFERENCES public.product_identities(id) ON DELETE RESTRICT,
  unit_id UUID NOT NULL REFERENCES public.unit_definitions(id) ON DELETE RESTRICT,
  pricing_kind public."SupplierFutureDemandFrameworkPricingKind" NOT NULL,
  fixed_unit_purchase_price NUMERIC(18,6),
  currency_code TEXT NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  tax_treatment TEXT NOT NULL CHECK (btrim(tax_treatment) <> ''),
  tax_reference TEXT,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_fingerprint TEXT NOT NULL CHECK (btrim(request_fingerprint) <> ''),
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supplier_future_demand_framework_commercial_term_grain_unique UNIQUE (revision_id, product_identity_id, unit_id),
  CONSTRAINT supplier_future_demand_framework_commercial_term_idempotency_unique UNIQUE (revision_id, idempotency_key),
  CONSTRAINT supplier_future_demand_framework_commercial_term_price_complete CHECK (
    (pricing_kind = 'FIXED' AND fixed_unit_purchase_price IS NOT NULL AND fixed_unit_purchase_price > 0)
    OR (pricing_kind = 'TIERED' AND fixed_unit_purchase_price IS NULL)
  )
);

CREATE TABLE public.supplier_future_demand_framework_price_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_term_id UUID NOT NULL REFERENCES public.supplier_future_demand_framework_commercial_terms(id) ON DELETE RESTRICT,
  lower_quantity NUMERIC(18,4) NOT NULL CHECK (lower_quantity > 0),
  upper_quantity NUMERIC(18,4),
  unit_purchase_price NUMERIC(18,6) NOT NULL CHECK (unit_purchase_price > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supplier_future_demand_framework_price_tier_bounds_valid CHECK (upper_quantity IS NULL OR upper_quantity >= lower_quantity),
  CONSTRAINT supplier_future_demand_framework_price_tier_bounds_unique UNIQUE (commercial_term_id, lower_quantity, upper_quantity)
);

CREATE TABLE public.supplier_future_demand_framework_capacity_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id UUID NOT NULL REFERENCES public.supplier_future_demand_framework_revisions(id) ON DELETE RESTRICT,
  product_identity_id UUID NOT NULL REFERENCES public.product_identities(id) ON DELETE RESTRICT,
  unit_id UUID NOT NULL REFERENCES public.unit_definitions(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  indicative_quantity NUMERIC(18,4) NOT NULL CHECK (indicative_quantity > 0),
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_fingerprint TEXT NOT NULL CHECK (btrim(request_fingerprint) <> ''),
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supplier_future_demand_framework_capacity_period_valid CHECK (period_end >= period_start),
  CONSTRAINT supplier_future_demand_framework_capacity_period_idempotency_unique UNIQUE (revision_id, idempotency_key),
  CONSTRAINT supplier_future_demand_framework_capacity_period_grain_unique UNIQUE (revision_id, product_identity_id, unit_id, period_start, period_end)
);

CREATE TABLE public.supplier_future_demand_framework_buying_power_provenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id UUID NOT NULL REFERENCES public.supplier_future_demand_framework_revisions(id) ON DELETE RESTRICT,
  buying_power_snapshot_id UUID NOT NULL REFERENCES public.buying_power_snapshots(id) ON DELETE RESTRICT,
  buying_power_snapshot_line_id UUID NOT NULL REFERENCES public.buying_power_snapshot_lines(id) ON DELETE RESTRICT,
  signal_class public."SupplierFutureDemandFrameworkSignalClass" NOT NULL,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_fingerprint TEXT NOT NULL CHECK (btrim(request_fingerprint) <> ''),
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supplier_future_demand_framework_provenance_idempotency_unique UNIQUE (revision_id, idempotency_key),
  CONSTRAINT supplier_future_demand_framework_provenance_grain_unique UNIQUE (revision_id, buying_power_snapshot_line_id, signal_class)
);

CREATE INDEX supplier_future_demand_framework_commercial_revision_idx
  ON public.supplier_future_demand_framework_commercial_terms(revision_id);
CREATE INDEX supplier_future_demand_framework_tier_term_idx
  ON public.supplier_future_demand_framework_price_tiers(commercial_term_id);
CREATE INDEX supplier_future_demand_framework_capacity_revision_idx
  ON public.supplier_future_demand_framework_capacity_periods(revision_id, product_identity_id, unit_id, period_start);
CREATE INDEX supplier_future_demand_framework_provenance_revision_idx
  ON public.supplier_future_demand_framework_buying_power_provenance(revision_id);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'supplier_future_demand_framework_commercial_terms',
    'supplier_future_demand_framework_price_tiers',
    'supplier_future_demand_framework_capacity_periods',
    'supplier_future_demand_framework_buying_power_provenance'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, sco_runtime, sco_internal_executor', table_name);
  END LOOP;
END $$;

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'supplier_future_demand_framework.commercial.write', 'Create Supplier Future-Demand Framework commercial terms internally'),
  (gen_random_uuid(), 'supplier_future_demand_framework.commercial.read_confidential', 'Read confidential Supplier Future-Demand Framework commercial terms internally')
ON CONFLICT (code) DO NOTHING;

CREATE FUNCTION public.prevent_supplier_future_demand_framework_commercial_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT'
     OR COALESCE(current_setting('app.supplier_future_demand_framework_commercial_gateway', true), '') <> 'true' THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_HISTORY_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER supplier_future_demand_framework_commercial_terms_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_future_demand_framework_commercial_terms
  FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_future_demand_framework_commercial_mutation();
CREATE TRIGGER supplier_future_demand_framework_price_tiers_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_future_demand_framework_price_tiers
  FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_future_demand_framework_commercial_mutation();
CREATE TRIGGER supplier_future_demand_framework_capacity_periods_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_future_demand_framework_capacity_periods
  FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_future_demand_framework_commercial_mutation();
CREATE TRIGGER supplier_future_demand_framework_provenance_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_future_demand_framework_buying_power_provenance
  FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_future_demand_framework_commercial_mutation();

CREATE FUNCTION public.internal_supplier_future_demand_framework_commercial_term_create(
  p_actor UUID,
  p_revision UUID,
  p_product_identity UUID,
  p_unit UUID,
  p_pricing_kind TEXT,
  p_fixed_unit_purchase_price NUMERIC,
  p_currency_code TEXT,
  p_tax_treatment TEXT,
  p_tax_reference TEXT,
  p_tiers JSONB,
  p_idempotency_key TEXT,
  p_correlation TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing_term RECORD;
  revision_record RECORD;
  term_id UUID := gen_random_uuid();
  normalized_idempotency_key TEXT := btrim(COALESCE(p_idempotency_key, ''));
  pricing_kind public."SupplierFutureDemandFrameworkPricingKind";
  currency_code TEXT := upper(btrim(COALESCE(p_currency_code, '')));
  tax_treatment TEXT := btrim(COALESCE(p_tax_treatment, ''));
  tax_reference TEXT := NULLIF(btrim(COALESCE(p_tax_reference, '')), '');
  fingerprint TEXT;
  tier_count INTEGER;
  has_invalid_tier BOOLEAN;
  has_overlapping_tiers BOOLEAN;
BEGIN
  IF NOT public.supplier_future_demand_framework_actor_allowed(p_actor, 'supplier_future_demand_framework.commercial.write') THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_FORBIDDEN';
  END IF;
  IF p_pricing_kind NOT IN ('FIXED', 'TIERED') OR normalized_idempotency_key = '' OR currency_code !~ '^[A-Z]{3}$' OR tax_treatment = '' THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_INVALID';
  END IF;
  pricing_kind := p_pricing_kind::public."SupplierFutureDemandFrameworkPricingKind";
  fingerprint := md5(concat_ws('|', p_revision::TEXT, p_product_identity::TEXT, p_unit::TEXT, pricing_kind::TEXT, p_fixed_unit_purchase_price::TEXT, currency_code, tax_treatment, COALESCE(tax_reference, ''), COALESCE(p_tiers::TEXT, '')));

  SELECT revision.*, framework.purchase_source_id, framework.supplier_company_id, framework.supplier_partnership_id
    INTO revision_record
    FROM public.supplier_future_demand_framework_revisions revision
    JOIN public.supplier_future_demand_frameworks framework ON framework.id = revision.framework_id
   WHERE revision.id = p_revision
   FOR UPDATE OF revision, framework;
  IF NOT FOUND
     OR revision_record.status <> 'DRAFT'
     OR revision_record.terminated_at IS NOT NULL
     OR NOT public.supplier_future_demand_framework_supplier_scope_valid(revision_record.supplier_company_id, revision_record.supplier_partnership_id, revision_record.purchase_source_id)
     OR NOT EXISTS (
       SELECT 1
         FROM public.supplier_future_demand_framework_scope_lines scope_line
        WHERE scope_line.revision_id = p_revision
          AND scope_line.product_identity_id = p_product_identity
          AND scope_line.unit_id = p_unit
     ) THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('supplier-future-demand-framework-commercial-term:' || p_revision::TEXT || ':' || p_product_identity::TEXT || ':' || p_unit::TEXT));
  SELECT * INTO existing_term
    FROM public.supplier_future_demand_framework_commercial_terms
   WHERE revision_id = p_revision AND idempotency_key = normalized_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF existing_term.request_fingerprint <> fingerprint THEN
      RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN existing_term.id;
  END IF;

  IF pricing_kind = 'FIXED' THEN
    IF p_fixed_unit_purchase_price IS NULL OR p_fixed_unit_purchase_price <= 0 OR p_tiers IS NOT NULL THEN
      RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_INVALID';
    END IF;
  ELSE
    IF p_fixed_unit_purchase_price IS NOT NULL
       OR jsonb_typeof(p_tiers) <> 'array'
       OR jsonb_array_length(p_tiers) = 0 THEN
      RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_INVALID';
    END IF;
    WITH tiers AS (
      SELECT ordinality, lower_quantity, upper_quantity, unit_purchase_price
        FROM jsonb_to_recordset(p_tiers) WITH ORDINALITY AS tier(lower_quantity NUMERIC, upper_quantity NUMERIC, unit_purchase_price NUMERIC, ordinality BIGINT)
    )
    SELECT count(*)::INTEGER,
           COALESCE(bool_or(lower_quantity IS NULL OR lower_quantity <= 0 OR unit_purchase_price IS NULL OR unit_purchase_price <= 0 OR (upper_quantity IS NOT NULL AND upper_quantity < lower_quantity)), true),
           EXISTS (
             SELECT 1
               FROM tiers first_tier
               JOIN tiers second_tier ON first_tier.ordinality < second_tier.ordinality
              WHERE numrange(first_tier.lower_quantity, first_tier.upper_quantity, '[]') && numrange(second_tier.lower_quantity, second_tier.upper_quantity, '[]')
           )
        INTO tier_count, has_invalid_tier, has_overlapping_tiers
      FROM tiers;
      IF tier_count = 0 OR has_invalid_tier OR has_overlapping_tiers THEN
      RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_TIER_INVALID';
    END IF;
  END IF;

  PERFORM set_config('app.supplier_future_demand_framework_commercial_gateway', 'true', true);
  INSERT INTO public.supplier_future_demand_framework_commercial_terms(
    id, revision_id, product_identity_id, unit_id, pricing_kind, fixed_unit_purchase_price,
    currency_code, tax_treatment, tax_reference, created_by, idempotency_key, request_fingerprint, correlation_id
  ) VALUES (
    term_id, p_revision, p_product_identity, p_unit, pricing_kind,
    CASE WHEN pricing_kind = 'FIXED' THEN p_fixed_unit_purchase_price ELSE NULL END,
    currency_code, tax_treatment, tax_reference, p_actor, normalized_idempotency_key, fingerprint, NULLIF(p_correlation, '')::UUID
  );
  IF pricing_kind = 'TIERED' THEN
    INSERT INTO public.supplier_future_demand_framework_price_tiers(commercial_term_id, lower_quantity, upper_quantity, unit_purchase_price)
    SELECT term_id, lower_quantity, upper_quantity, unit_purchase_price
      FROM jsonb_to_recordset(p_tiers) AS tier(lower_quantity NUMERIC, upper_quantity NUMERIC, unit_purchase_price NUMERIC);
  END IF;
  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (
    p_actor, 'SCO_INTERNAL', 'supplier_future_demand_framework.commercial_term_created',
    'SupplierFutureDemandFrameworkCommercialTerm', term_id,
    jsonb_build_object('frameworkRevisionId', p_revision, 'productIdentityId', p_product_identity, 'unitId', p_unit, 'purchaseSourceId', revision_record.purchase_source_id, 'pricingKind', pricing_kind, 'outcome', 'CREATED'),
    NULLIF(p_correlation, '')::UUID
  );
  RETURN term_id;
END
$$;

CREATE FUNCTION public.internal_supplier_future_demand_framework_capacity_period_create(
  p_actor UUID,
  p_revision UUID,
  p_product_identity UUID,
  p_unit UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_indicative_quantity NUMERIC,
  p_idempotency_key TEXT,
  p_correlation TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing_period RECORD;
  revision_record RECORD;
  period_id UUID := gen_random_uuid();
  normalized_idempotency_key TEXT := btrim(COALESCE(p_idempotency_key, ''));
  fingerprint TEXT := md5(concat_ws('|', p_revision::TEXT, p_product_identity::TEXT, p_unit::TEXT, p_period_start::TEXT, p_period_end::TEXT, p_indicative_quantity::TEXT));
BEGIN
  IF NOT public.supplier_future_demand_framework_actor_allowed(p_actor, 'supplier_future_demand_framework.commercial.write') THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_FORBIDDEN';
  END IF;
  IF normalized_idempotency_key = '' OR p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start OR p_indicative_quantity IS NULL OR p_indicative_quantity <= 0 THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_CAPACITY_INVALID';
  END IF;
  SELECT revision.*, framework.purchase_source_id, framework.supplier_company_id, framework.supplier_partnership_id
    INTO revision_record
    FROM public.supplier_future_demand_framework_revisions revision
    JOIN public.supplier_future_demand_frameworks framework ON framework.id = revision.framework_id
   WHERE revision.id = p_revision
   FOR UPDATE OF revision, framework;
  IF NOT FOUND
     OR revision_record.status <> 'DRAFT'
     OR revision_record.terminated_at IS NOT NULL
     OR NOT public.supplier_future_demand_framework_supplier_scope_valid(revision_record.supplier_company_id, revision_record.supplier_partnership_id, revision_record.purchase_source_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.supplier_future_demand_framework_scope_lines scope_line
        WHERE scope_line.revision_id = p_revision
          AND scope_line.product_identity_id = p_product_identity
          AND scope_line.unit_id = p_unit
     ) THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_CAPACITY_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('supplier-future-demand-framework-capacity:' || p_revision::TEXT || ':' || p_product_identity::TEXT || ':' || p_unit::TEXT));
  SELECT * INTO existing_period
    FROM public.supplier_future_demand_framework_capacity_periods
   WHERE revision_id = p_revision AND idempotency_key = normalized_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF existing_period.request_fingerprint <> fingerprint THEN
      RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_CAPACITY_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN existing_period.id;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.supplier_future_demand_framework_capacity_periods capacity_period
     WHERE capacity_period.revision_id = p_revision
       AND capacity_period.product_identity_id = p_product_identity
       AND capacity_period.unit_id = p_unit
       AND capacity_period.period_start <= p_period_end
       AND capacity_period.period_end >= p_period_start
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_CAPACITY_OVERLAP';
  END IF;
  PERFORM set_config('app.supplier_future_demand_framework_commercial_gateway', 'true', true);
  INSERT INTO public.supplier_future_demand_framework_capacity_periods(
    id, revision_id, product_identity_id, unit_id, period_start, period_end, indicative_quantity,
    created_by, idempotency_key, request_fingerprint, correlation_id
  ) VALUES (
    period_id, p_revision, p_product_identity, p_unit, p_period_start, p_period_end, p_indicative_quantity,
    p_actor, normalized_idempotency_key, fingerprint, NULLIF(p_correlation, '')::UUID
  );
  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (
    p_actor, 'SCO_INTERNAL', 'supplier_future_demand_framework.capacity_period_created',
    'SupplierFutureDemandFrameworkCapacityPeriod', period_id,
    jsonb_build_object('frameworkRevisionId', p_revision, 'productIdentityId', p_product_identity, 'unitId', p_unit, 'purchaseSourceId', revision_record.purchase_source_id, 'outcome', 'CREATED'),
    NULLIF(p_correlation, '')::UUID
  );
  RETURN period_id;
END
$$;

CREATE FUNCTION public.internal_supplier_future_demand_framework_buying_power_provenance_attach(
  p_actor UUID,
  p_revision UUID,
  p_snapshot UUID,
  p_snapshot_line UUID,
  p_signal_class TEXT,
  p_idempotency_key TEXT,
  p_correlation TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing_provenance RECORD;
  revision_record RECORD;
  provenance_id UUID := gen_random_uuid();
  normalized_idempotency_key TEXT := btrim(COALESCE(p_idempotency_key, ''));
  signal_class public."SupplierFutureDemandFrameworkSignalClass";
  fingerprint TEXT;
BEGIN
  IF NOT public.supplier_future_demand_framework_actor_allowed(p_actor, 'supplier_future_demand_framework.commercial.write') THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_FORBIDDEN';
  END IF;
  IF p_signal_class NOT IN ('QUALIFIED', 'COMMITTED') OR normalized_idempotency_key = '' THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_PROVENANCE_INVALID';
  END IF;
  signal_class := p_signal_class::public."SupplierFutureDemandFrameworkSignalClass";
  fingerprint := md5(concat_ws('|', p_revision::TEXT, p_snapshot::TEXT, p_snapshot_line::TEXT, signal_class::TEXT));
  SELECT revision.*, framework.purchase_source_id, framework.terminated_at
    INTO revision_record
    FROM public.supplier_future_demand_framework_revisions revision
    JOIN public.supplier_future_demand_frameworks framework ON framework.id = revision.framework_id
   WHERE revision.id = p_revision
   FOR UPDATE OF revision, framework;
  IF NOT FOUND OR revision_record.status <> 'DRAFT' OR revision_record.terminated_at IS NOT NULL THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_PROVENANCE_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('supplier-future-demand-framework-provenance:' || p_revision::TEXT || ':' || p_snapshot_line::TEXT || ':' || signal_class::TEXT));
  SELECT * INTO existing_provenance
    FROM public.supplier_future_demand_framework_buying_power_provenance
   WHERE revision_id = p_revision AND idempotency_key = normalized_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF existing_provenance.request_fingerprint <> fingerprint THEN
      RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_PROVENANCE_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN existing_provenance.id;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.buying_power_snapshots snapshot
      JOIN public.buying_power_aggregation_runs aggregation_run ON aggregation_run.id = snapshot.aggregation_run_id AND aggregation_run.status = 'PUBLISHED'
      JOIN public.buying_power_snapshot_lines snapshot_line ON snapshot_line.id = p_snapshot_line AND snapshot_line.snapshot_id = snapshot.id
      JOIN public.supplier_future_demand_framework_scope_lines scope_line ON scope_line.revision_id = p_revision AND scope_line.product_identity_id = snapshot_line.product_identity_id AND scope_line.unit_id = snapshot_line.unit_id
     WHERE snapshot.id = p_snapshot
       AND ((signal_class = 'QUALIFIED' AND COALESCE(snapshot_line.qualified_quantity, 0) > 0)
         OR (signal_class = 'COMMITTED' AND COALESCE(snapshot_line.committed_quantity, 0) > 0))
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_PROVENANCE_INVALID';
  END IF;
  PERFORM set_config('app.supplier_future_demand_framework_commercial_gateway', 'true', true);
  INSERT INTO public.supplier_future_demand_framework_buying_power_provenance(
    id, revision_id, buying_power_snapshot_id, buying_power_snapshot_line_id, signal_class,
    created_by, idempotency_key, request_fingerprint, correlation_id
  ) VALUES (
    provenance_id, p_revision, p_snapshot, p_snapshot_line, signal_class,
    p_actor, normalized_idempotency_key, fingerprint, NULLIF(p_correlation, '')::UUID
  );
  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (
    p_actor, 'SCO_INTERNAL', 'supplier_future_demand_framework.buying_power_provenance_attached',
    'SupplierFutureDemandFrameworkBuyingPowerProvenance', provenance_id,
    jsonb_build_object('frameworkRevisionId', p_revision, 'signalClass', signal_class, 'outcome', 'ATTACHED'),
    NULLIF(p_correlation, '')::UUID
  );
  RETURN provenance_id;
END
$$;

CREATE FUNCTION public.internal_supplier_future_demand_framework_commercial_terms_get(p_actor UUID, p_revision UUID)
RETURNS TABLE(
  commercial_term_id UUID,
  product_identity_id UUID,
  unit_id UUID,
  pricing_kind TEXT,
  fixed_unit_purchase_price NUMERIC,
  currency_code TEXT,
  tax_treatment TEXT,
  tax_reference TEXT,
  tiers JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT term.id, term.product_identity_id, term.unit_id, term.pricing_kind::TEXT,
         term.fixed_unit_purchase_price, term.currency_code, term.tax_treatment, term.tax_reference,
         COALESCE(
           jsonb_agg(
             jsonb_build_object('lowerQuantity', tier.lower_quantity, 'upperQuantity', tier.upper_quantity, 'unitPurchasePrice', tier.unit_purchase_price)
             ORDER BY tier.lower_quantity
           ) FILTER (WHERE tier.id IS NOT NULL),
           '[]'::JSONB
         )
    FROM public.supplier_future_demand_framework_commercial_terms term
    LEFT JOIN public.supplier_future_demand_framework_price_tiers tier ON tier.commercial_term_id = term.id
   WHERE term.revision_id = p_revision
     AND public.supplier_future_demand_framework_actor_allowed(p_actor, 'supplier_future_demand_framework.commercial.read_confidential')
   GROUP BY term.id
   ORDER BY term.id
$$;

CREATE FUNCTION public.internal_supplier_future_demand_framework_capacity_periods_get(p_actor UUID, p_revision UUID)
RETURNS TABLE(id UUID, product_identity_id UUID, unit_id UUID, period_start DATE, period_end DATE, indicative_quantity NUMERIC)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT capacity_period.id, capacity_period.product_identity_id, capacity_period.unit_id,
         capacity_period.period_start, capacity_period.period_end, capacity_period.indicative_quantity
    FROM public.supplier_future_demand_framework_capacity_periods capacity_period
   WHERE capacity_period.revision_id = p_revision
     AND public.supplier_future_demand_framework_actor_allowed(p_actor, 'supplier_future_demand_framework.commercial.read_confidential')
   ORDER BY capacity_period.product_identity_id, capacity_period.unit_id, capacity_period.period_start
$$;

CREATE FUNCTION public.internal_supplier_future_demand_framework_buying_power_provenance_get(p_actor UUID, p_revision UUID)
RETURNS TABLE(id UUID, buying_power_snapshot_id UUID, buying_power_snapshot_line_id UUID, signal_class TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT provenance.id, provenance.buying_power_snapshot_id, provenance.buying_power_snapshot_line_id, provenance.signal_class::TEXT
    FROM public.supplier_future_demand_framework_buying_power_provenance provenance
   WHERE provenance.revision_id = p_revision
     AND public.supplier_future_demand_framework_actor_allowed(p_actor, 'supplier_future_demand_framework.commercial.read_confidential')
   ORDER BY provenance.id
$$;

REVOKE ALL ON FUNCTION public.prevent_supplier_future_demand_framework_commercial_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_supplier_future_demand_framework_commercial_term_create(UUID, UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT), public.internal_supplier_future_demand_framework_capacity_period_create(UUID, UUID, UUID, UUID, DATE, DATE, NUMERIC, TEXT, TEXT), public.internal_supplier_future_demand_framework_buying_power_provenance_attach(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT), public.internal_supplier_future_demand_framework_commercial_terms_get(UUID, UUID), public.internal_supplier_future_demand_framework_capacity_periods_get(UUID, UUID), public.internal_supplier_future_demand_framework_buying_power_provenance_get(UUID, UUID) FROM PUBLIC, sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_supplier_future_demand_framework_commercial_term_create(UUID, UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT), public.internal_supplier_future_demand_framework_capacity_period_create(UUID, UUID, UUID, UUID, DATE, DATE, NUMERIC, TEXT, TEXT), public.internal_supplier_future_demand_framework_buying_power_provenance_attach(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT), public.internal_supplier_future_demand_framework_commercial_terms_get(UUID, UUID), public.internal_supplier_future_demand_framework_capacity_periods_get(UUID, UUID), public.internal_supplier_future_demand_framework_buying_power_provenance_get(UUID, UUID) TO sco_internal_executor;