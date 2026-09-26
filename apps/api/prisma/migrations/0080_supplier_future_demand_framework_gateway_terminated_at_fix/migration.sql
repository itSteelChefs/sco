CREATE OR REPLACE FUNCTION public.internal_supplier_future_demand_framework_commercial_term_create(
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

  SELECT revision.*, framework.purchase_source_id, framework.supplier_company_id, framework.supplier_partnership_id, framework.terminated_at
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

CREATE OR REPLACE FUNCTION public.internal_supplier_future_demand_framework_capacity_period_create(
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
  SELECT revision.*, framework.purchase_source_id, framework.supplier_company_id, framework.supplier_partnership_id, framework.terminated_at
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