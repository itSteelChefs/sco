-- Capability E — Buy & Resell Operations.
-- Consumes D (0112) selection candidates. Does not reopen D semantics.
-- SCO buys from Supplier; SCO resells to Partner. Parallel to legacy RFQ→release→supplier_purchase_orders
-- path: legacy remains for product-identity execution; E serves BOQ/selection-driven commercial flow.
-- Cost snapshot: unit prices frozen from D quote lines (NOT approved_purchase_cost_snapshots — RFQ-bound).
-- STOP before accounting/ZATCA/credit/fulfillment execution platform.

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'commercial.purchase.manage', 'Internal create/issue/confirm supplier commercial purchase and allocations'),
  (gen_random_uuid(), 'commercial.purchase.approve', 'Internal commercial approval for supplier purchase'),
  (gen_random_uuid(), 'commercial.resale.manage', 'Internal create/confirm Partner resale commercial orders'),
  (gen_random_uuid(), 'commercial.resale.approve', 'Internal commercial approval for Partner resale'),
  (gen_random_uuid(), 'commercial.order.partner_read', 'Partner read own commercial/resale orders')
ON CONFLICT (code) DO NOTHING;

-- Purchase intent: commercial freeze from D selection (pre-PO boundary)
CREATE TABLE public.commercial_purchase_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  selection_candidate_id UUID NOT NULL UNIQUE
    REFERENCES public.procurement_selection_candidates(id) ON DELETE RESTRICT,
  requirement_id UUID NOT NULL REFERENCES public.procurement_requirements(id) ON DELETE RESTRICT,
  partner_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  quote_id UUID NOT NULL REFERENCES public.procurement_requirement_quotes(id) ON DELETE RESTRICT,
  supplier_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  alias_label TEXT NOT NULL,
  currency_code TEXT NOT NULL CHECK (char_length(currency_code) = 3),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','APPROVED','CONVERTED','CANCELLED'
  )),
  commercial_terms TEXT,
  delivery_context TEXT,
  purchase_subtotal NUMERIC(18,6) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  purchase_total NUMERIC(18,6) NOT NULL DEFAULT 0,
  tax_state TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (tax_state IN ('EXCL','INCL','ZERO','UNKNOWN','NOT_APPLICABLE')),
  payment_terms TEXT NOT NULL DEFAULT 'CASH',
  approved_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (idempotency_key)
);

CREATE TABLE public.commercial_purchase_intent_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL REFERENCES public.commercial_purchase_intents(id) ON DELETE RESTRICT,
  quote_line_id UUID NOT NULL REFERENCES public.procurement_requirement_quote_lines(id) ON DELETE RESTRICT,
  requirement_line_id UUID NOT NULL REFERENCES public.procurement_requirement_lines(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  specification TEXT,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  unit_id UUID NOT NULL REFERENCES public.unit_definitions(id) ON DELETE RESTRICT,
  purchase_unit_price NUMERIC(18,6) NOT NULL CHECK (purchase_unit_price >= 0),
  line_amount NUMERIC(18,6) NOT NULL CHECK (line_amount >= 0),
  tax_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  value_state TEXT NOT NULL,
  UNIQUE (intent_id, quote_line_id)
);

-- SCO → Supplier commercial PO (E). Distinct from legacy supplier_purchase_orders (release-bound).
CREATE TABLE public.commercial_supplier_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sco_buyer_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  supplier_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  order_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','APPROVED','ISSUED','PARTIALLY_CONFIRMED','CONFIRMED','CANCELLED'
  )),
  currency_code TEXT NOT NULL CHECK (char_length(currency_code) = 3),
  commercial_terms TEXT,
  delivery_context TEXT,
  payment_terms TEXT NOT NULL DEFAULT 'CASH',
  purchase_subtotal NUMERIC(18,6) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  purchase_total NUMERIC(18,6) NOT NULL DEFAULT 0,
  document_id UUID REFERENCES public.documents(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  issued_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  issued_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  confirmation_reference TEXT,
  expected_delivery_date DATE,
  confirmation_notes TEXT,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX commercial_supplier_orders_supplier_status_idx
  ON public.commercial_supplier_orders(supplier_company_id, status, updated_at DESC);

CREATE TABLE public.commercial_supplier_order_intents (
  order_id UUID NOT NULL REFERENCES public.commercial_supplier_orders(id) ON DELETE RESTRICT,
  intent_id UUID NOT NULL REFERENCES public.commercial_purchase_intents(id) ON DELETE RESTRICT,
  PRIMARY KEY (order_id, intent_id),
  UNIQUE (intent_id)
);

CREATE TABLE public.commercial_supplier_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.commercial_supplier_orders(id) ON DELETE RESTRICT,
  intent_line_id UUID NOT NULL REFERENCES public.commercial_purchase_intent_lines(id) ON DELETE RESTRICT,
  quote_line_id UUID NOT NULL REFERENCES public.procurement_requirement_quote_lines(id) ON DELETE RESTRICT,
  requirement_line_id UUID NOT NULL REFERENCES public.procurement_requirement_lines(id) ON DELETE RESTRICT,
  partner_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  specification TEXT,
  ordered_quantity NUMERIC(18,4) NOT NULL CHECK (ordered_quantity > 0),
  confirmed_quantity NUMERIC(18,4),
  unit_id UUID NOT NULL REFERENCES public.unit_definitions(id) ON DELETE RESTRICT,
  purchase_unit_price NUMERIC(18,6) NOT NULL CHECK (purchase_unit_price >= 0),
  line_amount NUMERIC(18,6) NOT NULL CHECK (line_amount >= 0),
  tax_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  allocated_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (allocated_quantity >= 0),
  UNIQUE (order_id, intent_line_id),
  CHECK (confirmed_quantity IS NULL OR confirmed_quantity >= 0),
  CHECK (allocated_quantity <= ordered_quantity)
);
CREATE INDEX commercial_supplier_order_lines_order_idx
  ON public.commercial_supplier_order_lines(order_id);

-- Partner allocation of PO line quantity
CREATE TABLE public.commercial_partner_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_order_line_id UUID NOT NULL REFERENCES public.commercial_supplier_order_lines(id) ON DELETE RESTRICT,
  supplier_order_id UUID NOT NULL REFERENCES public.commercial_supplier_orders(id) ON DELETE RESTRICT,
  partner_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  requirement_id UUID NOT NULL REFERENCES public.procurement_requirements(id) ON DELETE RESTRICT,
  requirement_line_id UUID NOT NULL REFERENCES public.procurement_requirement_lines(id) ON DELETE RESTRICT,
  intent_id UUID NOT NULL REFERENCES public.commercial_purchase_intents(id) ON DELETE RESTRICT,
  allocated_quantity NUMERIC(18,4) NOT NULL CHECK (allocated_quantity > 0),
  purchase_unit_price NUMERIC(18,6) NOT NULL CHECK (purchase_unit_price >= 0),
  purchase_line_amount NUMERIC(18,6) NOT NULL CHECK (purchase_line_amount >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','CONSUMED')),
  resale_order_line_id UUID,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX commercial_partner_allocations_partner_idx
  ON public.commercial_partner_allocations(partner_company_id, status);

-- SCO → Partner resale commercial order
CREATE TABLE public.commercial_partner_resale_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  sco_seller_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  order_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','APPROVED','CONFIRMED','CANCELLED'
  )),
  currency_code TEXT NOT NULL CHECK (char_length(currency_code) = 3),
  payment_terms TEXT NOT NULL DEFAULT 'CASH',
  delivery_terms TEXT,
  commercial_notes TEXT,
  sale_subtotal NUMERIC(18,6) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  sale_total NUMERIC(18,6) NOT NULL DEFAULT 0,
  purchase_cost_total NUMERIC(18,6) NOT NULL DEFAULT 0,
  gross_margin NUMERIC(18,6) NOT NULL DEFAULT 0,
  supplier_alias_label TEXT,
  document_id UUID REFERENCES public.documents(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ,
  fulfillment_ready BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX commercial_partner_resale_orders_partner_idx
  ON public.commercial_partner_resale_orders(partner_company_id, status, updated_at DESC);

CREATE TABLE public.commercial_partner_resale_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resale_order_id UUID NOT NULL REFERENCES public.commercial_partner_resale_orders(id) ON DELETE RESTRICT,
  allocation_id UUID NOT NULL UNIQUE REFERENCES public.commercial_partner_allocations(id) ON DELETE RESTRICT,
  requirement_line_id UUID NOT NULL REFERENCES public.procurement_requirement_lines(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  specification TEXT,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  unit_id UUID NOT NULL REFERENCES public.unit_definitions(id) ON DELETE RESTRICT,
  sale_unit_price NUMERIC(18,6) NOT NULL CHECK (sale_unit_price >= 0),
  sale_line_amount NUMERIC(18,6) NOT NULL CHECK (sale_line_amount >= 0),
  purchase_unit_price NUMERIC(18,6) NOT NULL CHECK (purchase_unit_price >= 0),
  purchase_line_amount NUMERIC(18,6) NOT NULL CHECK (purchase_line_amount >= 0),
  line_gross_margin NUMERIC(18,6) NOT NULL DEFAULT 0,
  tax_state TEXT NOT NULL DEFAULT 'UNKNOWN'
);

ALTER TABLE public.commercial_partner_allocations
  ADD CONSTRAINT commercial_partner_allocations_resale_line_fk
  FOREIGN KEY (resale_order_line_id)
  REFERENCES public.commercial_partner_resale_order_lines(id) ON DELETE RESTRICT;

-- RLS
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'commercial_purchase_intents',
    'commercial_purchase_intent_lines',
    'commercial_supplier_orders',
    'commercial_supplier_order_intents',
    'commercial_supplier_order_lines',
    'commercial_partner_allocations',
    'commercial_partner_resale_orders',
    'commercial_partner_resale_order_lines'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

CREATE POLICY commercial_purchase_intents_internal ON public.commercial_purchase_intents
  FOR ALL TO sco_runtime
  USING (current_setting('app.sco_internal', true) = 'true')
  WITH CHECK (current_setting('app.sco_internal', true) = 'true');

CREATE POLICY commercial_purchase_intent_lines_internal ON public.commercial_purchase_intent_lines
  FOR ALL TO sco_runtime
  USING (current_setting('app.sco_internal', true) = 'true')
  WITH CHECK (current_setting('app.sco_internal', true) = 'true');

CREATE POLICY commercial_supplier_orders_internal ON public.commercial_supplier_orders
  FOR ALL TO sco_runtime
  USING (current_setting('app.sco_internal', true) = 'true')
  WITH CHECK (current_setting('app.sco_internal', true) = 'true');

CREATE POLICY commercial_supplier_order_intents_internal ON public.commercial_supplier_order_intents
  FOR ALL TO sco_runtime
  USING (current_setting('app.sco_internal', true) = 'true')
  WITH CHECK (current_setting('app.sco_internal', true) = 'true');

CREATE POLICY commercial_supplier_order_lines_internal ON public.commercial_supplier_order_lines
  FOR ALL TO sco_runtime
  USING (current_setting('app.sco_internal', true) = 'true')
  WITH CHECK (current_setting('app.sco_internal', true) = 'true');

CREATE POLICY commercial_partner_allocations_internal ON public.commercial_partner_allocations
  FOR ALL TO sco_runtime
  USING (current_setting('app.sco_internal', true) = 'true')
  WITH CHECK (current_setting('app.sco_internal', true) = 'true');

-- Partner can read own resale orders only via gateways; table policy internal-only + partner SELECT own
CREATE POLICY commercial_partner_resale_orders_access ON public.commercial_partner_resale_orders
  FOR ALL TO sco_runtime
  USING (
    current_setting('app.sco_internal', true) = 'true'
    OR partner_company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (current_setting('app.sco_internal', true) = 'true');

CREATE POLICY commercial_partner_resale_order_lines_access ON public.commercial_partner_resale_order_lines
  FOR ALL TO sco_runtime
  USING (
    current_setting('app.sco_internal', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM public.commercial_partner_resale_orders o
       WHERE o.id = resale_order_id
         AND o.partner_company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (current_setting('app.sco_internal', true) = 'true');

CREATE OR REPLACE FUNCTION public.internal_commercial_capability(p_actor UUID, p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT public.internal_has_capability(p_actor, p_code)
     OR public.internal_has_capability(p_actor, 'sco.internal.manage');
$$;

CREATE OR REPLACE FUNCTION public.internal_commercial_purchase_from_selection(
  p_actor UUID,
  p_selection UUID,
  p_idempotency_key TEXT,
  p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_existing UUID;
  v_sel RECORD;
  v_quote RECORD;
  v_intent UUID;
  v_subtotal NUMERIC(18,6) := 0;
  v_line RECORD;
BEGIN
  IF NOT public.internal_commercial_capability(p_actor, 'commercial.purchase.manage') THEN
    RAISE EXCEPTION 'COMMERCIAL_PURCHASE_FORBIDDEN';
  END IF;
  IF btrim(COALESCE(p_idempotency_key,'')) = '' THEN
    RAISE EXCEPTION 'COMMERCIAL_IDEMPOTENCY_REQUIRED';
  END IF;

  SELECT id INTO v_existing FROM public.commercial_purchase_intents WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT s.*, r.company_id AS partner_company_id, r.status AS req_status
    INTO v_sel
    FROM public.procurement_selection_candidates s
    JOIN public.procurement_requirements r ON r.id = s.requirement_id
   WHERE s.id = p_selection;
  IF v_sel.id IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_SELECTION_NOT_FOUND'; END IF;
  IF v_sel.e_handoff_ready IS NOT TRUE THEN RAISE EXCEPTION 'COMMERCIAL_SELECTION_NOT_READY'; END IF;
  -- Partner company must remain commercially eligible (Class D / agreements); actor is SCO internal.
  IF NOT EXISTS (
    SELECT 1 FROM public.company_partnerships cp
     JOIN public."Company" c ON c.id = cp.company_id AND c.type = 'PARTNER' AND c.status = 'ACTIVE'
     WHERE cp.company_id = v_sel.partner_company_id
       AND cp.type = 'BUYER_PARTNERSHIP' AND cp.status = 'ACTIVE'
  ) OR NOT public.partner_required_agreements_satisfied(v_sel.partner_company_id) THEN
    RAISE EXCEPTION 'COMMERCIAL_PARTNER_INELIGIBLE';
  END IF;

  SELECT id INTO v_existing FROM public.commercial_purchase_intents WHERE selection_candidate_id = p_selection;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT * INTO v_quote FROM public.procurement_requirement_quotes WHERE id = v_sel.quote_id;
  IF v_quote.id IS NULL OR v_quote.status <> 'RECORDED' THEN
    RAISE EXCEPTION 'COMMERCIAL_QUOTE_INVALID';
  END IF;

  v_intent := gen_random_uuid();
  INSERT INTO public.commercial_purchase_intents(
    id, selection_candidate_id, requirement_id, partner_company_id, quote_id, supplier_company_id,
    alias_label, currency_code, status, commercial_terms, payment_terms, created_by,
    idempotency_key, correlation_id
  ) VALUES (
    v_intent, p_selection, v_sel.requirement_id, v_sel.partner_company_id, v_sel.quote_id,
    v_quote.supplier_company_id, v_sel.alias_label, v_quote.currency_code, 'DRAFT',
    v_quote.commercial_terms, 'CASH', p_actor, p_idempotency_key, p_correlation
  );

  FOR v_line IN
    SELECT ql.*, rl.description AS boq_description, rl.specification AS boq_spec, rl.unit_id AS boq_unit
      FROM public.procurement_requirement_quote_lines ql
      JOIN public.procurement_requirement_lines rl ON rl.id = ql.requirement_line_id
     WHERE ql.quote_id = v_sel.quote_id
       AND ql.value_state IN ('QUOTED','EXPLICIT_ZERO','INCLUDED')
       AND ql.match_state IN ('MATCHED','ALTERNATIVE')
       AND ql.requirement_line_id IS NOT NULL
  LOOP
    IF v_line.unit_price IS NULL AND v_line.value_state <> 'INCLUDED' THEN
      CONTINUE;
    END IF;
    INSERT INTO public.commercial_purchase_intent_lines(
      intent_id, quote_line_id, requirement_line_id, description, specification,
      quantity, unit_id, purchase_unit_price, line_amount, tax_state, value_state
    ) VALUES (
      v_intent, v_line.id, v_line.requirement_line_id,
      COALESCE(NULLIF(btrim(v_line.offered_description),''), v_line.boq_description),
      v_line.boq_spec,
      COALESCE(v_line.offered_quantity, (SELECT quantity FROM public.procurement_requirement_lines WHERE id = v_line.requirement_line_id)),
      COALESCE(v_line.unit_id, v_line.boq_unit),
      COALESCE(v_line.unit_price, 0),
      COALESCE(v_line.line_amount, COALESCE(v_line.unit_price,0) * COALESCE(v_line.offered_quantity,
        (SELECT quantity FROM public.procurement_requirement_lines WHERE id = v_line.requirement_line_id))),
      v_line.tax_state, v_line.value_state
    );
    v_subtotal := v_subtotal + COALESCE(v_line.line_amount, COALESCE(v_line.unit_price,0) * COALESCE(v_line.offered_quantity,
      (SELECT quantity FROM public.procurement_requirement_lines WHERE id = v_line.requirement_line_id)));
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.commercial_purchase_intent_lines WHERE intent_id = v_intent) THEN
    RAISE EXCEPTION 'COMMERCIAL_SELECTION_HAS_NO_PURCHASABLE_LINES';
  END IF;

  UPDATE public.commercial_purchase_intents
     SET purchase_subtotal = v_subtotal, purchase_total = v_subtotal, updated_at = clock_timestamp()
   WHERE id = v_intent;

  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, v_sel.partner_company_id, 'SCO_INTERNAL', 'commercial.purchase.intent_created',
          'CommercialPurchaseIntent', v_intent,
          jsonb_build_object('selectionCandidateId', p_selection, 'quoteId', v_sel.quote_id,
                             'supplierCompanyId', v_quote.supplier_company_id, 'purchaseTotal', v_subtotal),
          p_correlation);
  RETURN v_intent;
END $$;

CREATE OR REPLACE FUNCTION public.internal_commercial_purchase_approve(
  p_actor UUID, p_intent UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_commercial_capability(p_actor, 'commercial.purchase.approve') THEN
    RAISE EXCEPTION 'COMMERCIAL_APPROVAL_FORBIDDEN';
  END IF;
  UPDATE public.commercial_purchase_intents
     SET status = 'APPROVED', approved_by = p_actor, approved_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE id = p_intent AND status IN ('DRAFT','APPROVED');
  IF NOT FOUND THEN RAISE EXCEPTION 'COMMERCIAL_INTENT_NOT_APPROVABLE'; END IF;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  SELECT p_actor, partner_company_id, 'SCO_INTERNAL', 'commercial.purchase.intent_approved', 'CommercialPurchaseIntent', p_intent, '{}'::jsonb, p_correlation
    FROM public.commercial_purchase_intents WHERE id = p_intent;
  RETURN p_intent;
END $$;

CREATE OR REPLACE FUNCTION public.internal_commercial_supplier_order_create(
  p_actor UUID,
  p_intent_ids UUID[],
  p_idempotency_key TEXT,
  p_delivery_context TEXT,
  p_commercial_terms TEXT,
  p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_existing UUID;
  v_order UUID;
  v_supplier UUID;
  v_currency TEXT;
  v_sco UUID;
  v_intent RECORD;
  v_line RECORD;
  v_subtotal NUMERIC(18,6) := 0;
  v_ref TEXT;
BEGIN
  IF NOT public.internal_commercial_capability(p_actor, 'commercial.purchase.manage') THEN
    RAISE EXCEPTION 'COMMERCIAL_PURCHASE_FORBIDDEN';
  END IF;
  IF p_intent_ids IS NULL OR array_length(p_intent_ids,1) IS NULL THEN
    RAISE EXCEPTION 'COMMERCIAL_INTENTS_REQUIRED';
  END IF;
  SELECT id INTO v_existing FROM public.commercial_supplier_orders WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT c.id INTO v_sco FROM public."Company" c
   WHERE c.type = 'SCO' AND c.status = 'ACTIVE' ORDER BY c.id LIMIT 1;
  IF v_sco IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_SCO_BUYER_MISSING'; END IF;

  FOR v_intent IN
    SELECT * FROM public.commercial_purchase_intents WHERE id = ANY(p_intent_ids) FOR UPDATE
  LOOP
    IF v_intent.status <> 'APPROVED' THEN RAISE EXCEPTION 'COMMERCIAL_INTENT_NOT_APPROVED'; END IF;
    IF EXISTS (SELECT 1 FROM public.commercial_supplier_order_intents WHERE intent_id = v_intent.id) THEN
      RAISE EXCEPTION 'COMMERCIAL_INTENT_ALREADY_CONVERTED';
    END IF;
    IF v_supplier IS NULL THEN
      v_supplier := v_intent.supplier_company_id;
      v_currency := v_intent.currency_code;
    ELSIF v_supplier <> v_intent.supplier_company_id THEN
      RAISE EXCEPTION 'COMMERCIAL_INCOMPATIBLE_SUPPLIER';
    ELSIF v_currency <> v_intent.currency_code THEN
      RAISE EXCEPTION 'COMMERCIAL_INCOMPATIBLE_CURRENCY';
    END IF;
  END LOOP;

  IF v_supplier IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_INTENTS_REQUIRED'; END IF;

  v_order := gen_random_uuid();
  v_ref := 'CSO-' || upper(substr(replace(v_order::text,'-',''),1,12));
  INSERT INTO public.commercial_supplier_orders(
    id, sco_buyer_company_id, supplier_company_id, order_reference, status, currency_code,
    commercial_terms, delivery_context, payment_terms, created_by, idempotency_key, correlation_id
  ) VALUES (
    v_order, v_sco, v_supplier, v_ref, 'DRAFT', v_currency,
    p_commercial_terms, p_delivery_context, 'CASH', p_actor, p_idempotency_key, p_correlation
  );

  FOR v_intent IN SELECT * FROM public.commercial_purchase_intents WHERE id = ANY(p_intent_ids) LOOP
    INSERT INTO public.commercial_supplier_order_intents(order_id, intent_id) VALUES (v_order, v_intent.id);
    FOR v_line IN SELECT * FROM public.commercial_purchase_intent_lines WHERE intent_id = v_intent.id LOOP
      INSERT INTO public.commercial_supplier_order_lines(
        order_id, intent_line_id, quote_line_id, requirement_line_id, partner_company_id,
        description, specification, ordered_quantity, unit_id, purchase_unit_price, line_amount, tax_state
      ) VALUES (
        v_order, v_line.id, v_line.quote_line_id, v_line.requirement_line_id, v_intent.partner_company_id,
        v_line.description, v_line.specification, v_line.quantity, v_line.unit_id,
        v_line.purchase_unit_price, v_line.line_amount, v_line.tax_state
      );
      v_subtotal := v_subtotal + v_line.line_amount;
    END LOOP;
    UPDATE public.commercial_purchase_intents
       SET status = 'CONVERTED', updated_at = clock_timestamp() WHERE id = v_intent.id;
  END LOOP;

  UPDATE public.commercial_supplier_orders
     SET purchase_subtotal = v_subtotal, purchase_total = v_subtotal, updated_at = clock_timestamp()
   WHERE id = v_order;

  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, v_sco, 'SCO_INTERNAL', 'commercial.supplier_order.created', 'CommercialSupplierOrder', v_order,
          jsonb_build_object('supplierCompanyId', v_supplier, 'intentIds', to_jsonb(p_intent_ids), 'purchaseTotal', v_subtotal),
          p_correlation);
  RETURN v_order;
END $$;

CREATE OR REPLACE FUNCTION public.internal_commercial_supplier_order_approve(
  p_actor UUID, p_order UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_commercial_capability(p_actor, 'commercial.purchase.approve') THEN
    RAISE EXCEPTION 'COMMERCIAL_APPROVAL_FORBIDDEN';
  END IF;
  UPDATE public.commercial_supplier_orders
     SET status = 'APPROVED', approved_by = p_actor, approved_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE id = p_order AND status IN ('DRAFT','APPROVED');
  IF NOT FOUND THEN RAISE EXCEPTION 'COMMERCIAL_ORDER_NOT_APPROVABLE'; END IF;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  SELECT p_actor, sco_buyer_company_id, 'SCO_INTERNAL', 'commercial.supplier_order.approved', 'CommercialSupplierOrder', p_order, '{}'::jsonb, p_correlation
    FROM public.commercial_supplier_orders WHERE id = p_order;
  RETURN p_order;
END $$;

CREATE OR REPLACE FUNCTION public.internal_commercial_supplier_order_issue(
  p_actor UUID, p_order UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_status TEXT;
BEGIN
  IF NOT public.internal_commercial_capability(p_actor, 'commercial.purchase.manage') THEN
    RAISE EXCEPTION 'COMMERCIAL_PURCHASE_FORBIDDEN';
  END IF;
  SELECT status INTO v_status FROM public.commercial_supplier_orders WHERE id = p_order FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_ORDER_NOT_FOUND'; END IF;
  IF v_status = 'ISSUED' THEN RETURN p_order; END IF; -- idempotent
  IF v_status <> 'APPROVED' THEN RAISE EXCEPTION 'COMMERCIAL_ORDER_NOT_ISSUABLE'; END IF;
  UPDATE public.commercial_supplier_orders
     SET status = 'ISSUED', issued_by = p_actor, issued_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE id = p_order;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  SELECT p_actor, sco_buyer_company_id, 'SCO_INTERNAL', 'commercial.supplier_order.issued', 'CommercialSupplierOrder', p_order, '{}'::jsonb, p_correlation
    FROM public.commercial_supplier_orders WHERE id = p_order;
  RETURN p_order;
END $$;

CREATE OR REPLACE FUNCTION public.internal_commercial_supplier_order_confirm(
  p_actor UUID,
  p_order UUID,
  p_confirmation_reference TEXT,
  p_expected_delivery DATE,
  p_notes TEXT,
  p_line_confirmations JSONB,
  p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_status TEXT;
  v_elem JSONB;
  v_line_id UUID;
  v_qty NUMERIC(18,4);
  v_ordered NUMERIC(18,4);
  v_all_full BOOLEAN := TRUE;
  v_any BOOLEAN := FALSE;
BEGIN
  IF NOT public.internal_commercial_capability(p_actor, 'commercial.purchase.manage') THEN
    RAISE EXCEPTION 'COMMERCIAL_PURCHASE_FORBIDDEN';
  END IF;
  SELECT status INTO v_status FROM public.commercial_supplier_orders WHERE id = p_order FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_ORDER_NOT_FOUND'; END IF;
  IF v_status IN ('CONFIRMED','PARTIALLY_CONFIRMED') AND p_confirmation_reference IS NOT NULL THEN
    -- allow re-entry only to update notes if already confirmed with same reference (idempotent)
    IF EXISTS (
      SELECT 1 FROM public.commercial_supplier_orders
       WHERE id = p_order AND confirmation_reference IS NOT DISTINCT FROM p_confirmation_reference
    ) THEN
      RETURN p_order;
    END IF;
  END IF;
  IF v_status NOT IN ('ISSUED','PARTIALLY_CONFIRMED','CONFIRMED') THEN
    RAISE EXCEPTION 'COMMERCIAL_ORDER_NOT_CONFIRMABLE';
  END IF;

  IF p_line_confirmations IS NULL OR jsonb_typeof(p_line_confirmations) <> 'array' THEN
    -- confirm full ordered quantities
    UPDATE public.commercial_supplier_order_lines
       SET confirmed_quantity = ordered_quantity
     WHERE order_id = p_order;
  ELSE
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_line_confirmations) LOOP
      v_line_id := (v_elem->>'lineId')::uuid;
      v_qty := (v_elem->>'confirmedQuantity')::numeric;
      SELECT ordered_quantity INTO v_ordered FROM public.commercial_supplier_order_lines
       WHERE id = v_line_id AND order_id = p_order FOR UPDATE;
      IF v_ordered IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_CONFIRM_LINE_INVALID'; END IF;
      IF v_qty < 0 OR v_qty > v_ordered THEN RAISE EXCEPTION 'COMMERCIAL_CONFIRM_QTY_INVALID'; END IF;
      UPDATE public.commercial_supplier_order_lines SET confirmed_quantity = v_qty WHERE id = v_line_id;
    END LOOP;
  END IF;

  SELECT bool_and(confirmed_quantity IS NOT NULL AND confirmed_quantity = ordered_quantity),
         bool_or(confirmed_quantity IS NOT NULL AND confirmed_quantity > 0)
    INTO v_all_full, v_any
    FROM public.commercial_supplier_order_lines WHERE order_id = p_order;

  UPDATE public.commercial_supplier_orders SET
    status = CASE WHEN v_all_full THEN 'CONFIRMED' WHEN v_any THEN 'PARTIALLY_CONFIRMED' ELSE status END,
    confirmation_reference = COALESCE(p_confirmation_reference, confirmation_reference),
    expected_delivery_date = COALESCE(p_expected_delivery, expected_delivery_date),
    confirmation_notes = COALESCE(p_notes, confirmation_notes),
    confirmed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  WHERE id = p_order;

  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  SELECT p_actor, sco_buyer_company_id, 'SCO_INTERNAL', 'commercial.supplier_order.confirmed', 'CommercialSupplierOrder', p_order,
          jsonb_build_object('partial', NOT v_all_full), p_correlation
    FROM public.commercial_supplier_orders WHERE id = p_order;
  RETURN p_order;
END $$;

CREATE OR REPLACE FUNCTION public.internal_commercial_allocation_create(
  p_actor UUID,
  p_order_line UUID,
  p_quantity NUMERIC,
  p_idempotency_key TEXT,
  p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_existing UUID;
  v_line RECORD;
  v_available NUMERIC(18,4);
  v_id UUID;
  v_intent UUID;
  v_req UUID;
BEGIN
  IF NOT public.internal_commercial_capability(p_actor, 'commercial.purchase.manage') THEN
    RAISE EXCEPTION 'COMMERCIAL_PURCHASE_FORBIDDEN';
  END IF;
  SELECT id INTO v_existing FROM public.commercial_partner_allocations WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT l.*, o.status AS order_status INTO v_line
    FROM public.commercial_supplier_order_lines l
    JOIN public.commercial_supplier_orders o ON o.id = l.order_id
   WHERE l.id = p_order_line FOR UPDATE OF l;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_ORDER_LINE_NOT_FOUND'; END IF;
  IF v_line.order_status NOT IN ('ISSUED','PARTIALLY_CONFIRMED','CONFIRMED','APPROVED') THEN
    RAISE EXCEPTION 'COMMERCIAL_ORDER_NOT_ALLOCATABLE';
  END IF;

  -- Prefer confirmed qty when present, else ordered
  v_available := COALESCE(v_line.confirmed_quantity, v_line.ordered_quantity) - v_line.allocated_quantity;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'COMMERCIAL_ALLOCATION_QTY_INVALID'; END IF;
  IF p_quantity > v_available THEN RAISE EXCEPTION 'COMMERCIAL_OVER_ALLOCATION'; END IF;

  SELECT intent_id INTO v_intent FROM public.commercial_purchase_intent_lines WHERE id = v_line.intent_line_id;
  SELECT requirement_id INTO v_req FROM public.commercial_purchase_intents WHERE id = v_intent;

  -- Default: allocate only to the partner that owns the intent line (no silent cross-partner)
  IF v_line.partner_company_id IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_ALLOCATION_PARTNER_MISSING'; END IF;

  v_id := gen_random_uuid();
  INSERT INTO public.commercial_partner_allocations(
    id, supplier_order_line_id, supplier_order_id, partner_company_id, requirement_id, requirement_line_id,
    intent_id, allocated_quantity, purchase_unit_price, purchase_line_amount, created_by, idempotency_key, correlation_id
  ) VALUES (
    v_id, v_line.id, v_line.order_id, v_line.partner_company_id, v_req, v_line.requirement_line_id,
    v_intent, p_quantity, v_line.purchase_unit_price,
    round(p_quantity * v_line.purchase_unit_price, 6), p_actor, p_idempotency_key, p_correlation
  );

  UPDATE public.commercial_supplier_order_lines
     SET allocated_quantity = allocated_quantity + p_quantity
   WHERE id = v_line.id;

  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, v_line.partner_company_id, 'SCO_INTERNAL', 'commercial.allocation.created',
          'CommercialPartnerAllocation', v_id,
          jsonb_build_object('quantity', p_quantity, 'orderLineId', v_line.id), p_correlation);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_commercial_resale_create(
  p_actor UUID,
  p_partner_company UUID,
  p_allocations JSONB,
  p_payment_terms TEXT,
  p_delivery_terms TEXT,
  p_commercial_notes TEXT,
  p_idempotency_key TEXT,
  p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_existing UUID;
  v_order UUID;
  v_sco UUID;
  v_currency TEXT;
  v_alias TEXT;
  v_elem JSONB;
  v_alloc RECORD;
  v_sale_price NUMERIC(18,6);
  v_line_id UUID;
  v_sale_sub NUMERIC(18,6) := 0;
  v_cost_sub NUMERIC(18,6) := 0;
  v_ref TEXT;
  v_unit UUID;
BEGIN
  IF NOT public.internal_commercial_capability(p_actor, 'commercial.resale.manage') THEN
    RAISE EXCEPTION 'COMMERCIAL_RESALE_FORBIDDEN';
  END IF;
  SELECT id INTO v_existing FROM public.commercial_partner_resale_orders WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT c.id INTO v_sco FROM public."Company" c WHERE c.type='SCO' AND c.status='ACTIVE' ORDER BY c.id LIMIT 1;
  IF v_sco IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_SCO_SELLER_MISSING'; END IF;
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'COMMERCIAL_ALLOCATIONS_REQUIRED';
  END IF;

  v_order := gen_random_uuid();
  v_ref := 'CRO-' || upper(substr(replace(v_order::text,'-',''),1,12));

  -- validate all allocations belong to partner and are ACTIVE unused
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    SELECT * INTO v_alloc FROM public.commercial_partner_allocations
     WHERE id = (v_elem->>'allocationId')::uuid FOR UPDATE;
    IF v_alloc.id IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_ALLOCATION_NOT_FOUND'; END IF;
    IF v_alloc.partner_company_id <> p_partner_company THEN RAISE EXCEPTION 'COMMERCIAL_ALLOCATION_PARTNER_MISMATCH'; END IF;
    IF v_alloc.status <> 'ACTIVE' OR v_alloc.resale_order_line_id IS NOT NULL THEN
      RAISE EXCEPTION 'COMMERCIAL_ALLOCATION_NOT_AVAILABLE';
    END IF;
    IF v_currency IS NULL THEN
      SELECT currency_code INTO v_currency FROM public.commercial_supplier_orders WHERE id = v_alloc.supplier_order_id;
      SELECT alias_label INTO v_alias FROM public.commercial_purchase_intents WHERE id = v_alloc.intent_id;
    END IF;
  END LOOP;

  INSERT INTO public.commercial_partner_resale_orders(
    id, partner_company_id, sco_seller_company_id, order_reference, status, currency_code,
    payment_terms, delivery_terms, commercial_notes, supplier_alias_label, created_by,
    idempotency_key, correlation_id
  ) VALUES (
    v_order, p_partner_company, v_sco, v_ref, 'DRAFT', v_currency,
    COALESCE(NULLIF(btrim(p_payment_terms),''),'CASH'), p_delivery_terms, p_commercial_notes,
    v_alias, p_actor, p_idempotency_key, p_correlation
  );

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    SELECT * INTO v_alloc FROM public.commercial_partner_allocations WHERE id = (v_elem->>'allocationId')::uuid;
    v_sale_price := (v_elem->>'saleUnitPrice')::numeric;
    IF v_sale_price IS NULL OR v_sale_price < 0 THEN RAISE EXCEPTION 'COMMERCIAL_SALE_PRICE_REQUIRED'; END IF;
    SELECT unit_id INTO v_unit FROM public.procurement_requirement_lines WHERE id = v_alloc.requirement_line_id;
    v_line_id := gen_random_uuid();
    INSERT INTO public.commercial_partner_resale_order_lines(
      id, resale_order_id, allocation_id, requirement_line_id, description, specification,
      quantity, unit_id, sale_unit_price, sale_line_amount, purchase_unit_price, purchase_line_amount, line_gross_margin
    )
    SELECT v_line_id, v_order, v_alloc.id, v_alloc.requirement_line_id, rl.description, rl.specification,
           v_alloc.allocated_quantity, v_unit, v_sale_price,
           round(v_alloc.allocated_quantity * v_sale_price, 6),
           v_alloc.purchase_unit_price, v_alloc.purchase_line_amount,
           round(v_alloc.allocated_quantity * v_sale_price, 6) - v_alloc.purchase_line_amount
      FROM public.procurement_requirement_lines rl WHERE rl.id = v_alloc.requirement_line_id;

    UPDATE public.commercial_partner_allocations
       SET resale_order_line_id = v_line_id, status = 'CONSUMED' WHERE id = v_alloc.id;

    v_sale_sub := v_sale_sub + round(v_alloc.allocated_quantity * v_sale_price, 6);
    v_cost_sub := v_cost_sub + v_alloc.purchase_line_amount;
  END LOOP;

  UPDATE public.commercial_partner_resale_orders SET
    sale_subtotal = v_sale_sub, sale_total = v_sale_sub,
    purchase_cost_total = v_cost_sub, gross_margin = v_sale_sub - v_cost_sub,
    updated_at = clock_timestamp()
  WHERE id = v_order;

  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, p_partner_company, 'SCO_INTERNAL', 'commercial.resale.created', 'CommercialPartnerResaleOrder', v_order,
          jsonb_build_object('saleTotal', v_sale_sub, 'grossMargin', v_sale_sub - v_cost_sub), p_correlation);
  RETURN v_order;
END $$;

CREATE OR REPLACE FUNCTION public.internal_commercial_resale_approve(
  p_actor UUID, p_order UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_commercial_capability(p_actor, 'commercial.resale.approve') THEN
    RAISE EXCEPTION 'COMMERCIAL_APPROVAL_FORBIDDEN';
  END IF;
  UPDATE public.commercial_partner_resale_orders
     SET status = 'APPROVED', approved_by = p_actor, approved_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE id = p_order AND status IN ('DRAFT','APPROVED');
  IF NOT FOUND THEN RAISE EXCEPTION 'COMMERCIAL_RESALE_NOT_APPROVABLE'; END IF;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  SELECT p_actor, partner_company_id, 'SCO_INTERNAL', 'commercial.resale.approved', 'CommercialPartnerResaleOrder', p_order, '{}'::jsonb, p_correlation
    FROM public.commercial_partner_resale_orders WHERE id = p_order;
  RETURN p_order;
END $$;

CREATE OR REPLACE FUNCTION public.internal_commercial_resale_confirm(
  p_actor UUID, p_order UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_status TEXT;
  v_ready BOOLEAN;
BEGIN
  IF NOT public.internal_commercial_capability(p_actor, 'commercial.resale.manage') THEN
    RAISE EXCEPTION 'COMMERCIAL_RESALE_FORBIDDEN';
  END IF;
  SELECT status INTO v_status FROM public.commercial_partner_resale_orders WHERE id = p_order FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_RESALE_NOT_FOUND'; END IF;
  IF v_status = 'CONFIRMED' THEN RETURN p_order; END IF; -- idempotent
  IF v_status <> 'APPROVED' THEN RAISE EXCEPTION 'COMMERCIAL_RESALE_NOT_CONFIRMABLE'; END IF;

  -- Fulfillment ready only when all source supplier order lines for allocations are confirmed covering qty
  SELECT bool_and(
           COALESCE(l.confirmed_quantity, 0) >= a.allocated_quantity
           AND o.status IN ('CONFIRMED','PARTIALLY_CONFIRMED')
         )
    INTO v_ready
    FROM public.commercial_partner_resale_order_lines rl
    JOIN public.commercial_partner_allocations a ON a.id = rl.allocation_id
    JOIN public.commercial_supplier_order_lines l ON l.id = a.supplier_order_line_id
    JOIN public.commercial_supplier_orders o ON o.id = l.order_id
   WHERE rl.resale_order_id = p_order;

  UPDATE public.commercial_partner_resale_orders SET
    status = 'CONFIRMED', confirmed_by = p_actor, confirmed_at = clock_timestamp(),
    fulfillment_ready = COALESCE(v_ready, FALSE), updated_at = clock_timestamp()
  WHERE id = p_order;

  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  SELECT p_actor, partner_company_id, 'SCO_INTERNAL', 'commercial.resale.confirmed', 'CommercialPartnerResaleOrder', p_order,
          jsonb_build_object('fulfillmentReady', COALESCE(v_ready, FALSE)), p_correlation
    FROM public.commercial_partner_resale_orders WHERE id = p_order;
  RETURN p_order;
END $$;

-- Partner-safe projection (no cost/margin/supplier id)
CREATE OR REPLACE FUNCTION public.partner_commercial_order_list(p_actor UUID, p_company UUID)
RETURNS TABLE(
  id UUID, order_reference TEXT, status TEXT, currency_code TEXT,
  sale_total NUMERIC, payment_terms TEXT, fulfillment_ready BOOLEAN,
  supplier_alias_label TEXT, confirmed_at TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::text
     OR current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::text THEN
    RAISE EXCEPTION 'PARTNER_COMMERCIAL_FORBIDDEN';
  END IF;
  IF NOT public.partner_procurement_access_allowed(p_actor, p_company)
     AND NOT EXISTS (
       SELECT 1 FROM public."CompanyMembership" cm
        JOIN public."MembershipRole" mr ON mr.membership_id = cm.id
        JOIN public."RolePermission" rp ON rp.role_id = mr.role_id
        JOIN public."Permission" p ON p.id = rp.permission_id
       WHERE cm."userId" = p_actor AND cm."companyId" = p_company AND cm.status = 'ACTIVE'
         AND p.code IN ('commercial.order.partner_read','partner.portal.read')
     ) THEN
    RAISE EXCEPTION 'PARTNER_COMMERCIAL_FORBIDDEN';
  END IF;
  RETURN QUERY
  SELECT o.id, o.order_reference, o.status, o.currency_code, o.sale_total, o.payment_terms,
         o.fulfillment_ready, o.supplier_alias_label, o.confirmed_at, o.created_at
    FROM public.commercial_partner_resale_orders o
   WHERE o.partner_company_id = p_company
   ORDER BY o.updated_at DESC
   LIMIT 200;
END $$;

CREATE OR REPLACE FUNCTION public.partner_commercial_order_get(p_actor UUID, p_company UUID, p_order UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_row RECORD;
BEGIN
  IF current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::text
     OR current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::text THEN
    RAISE EXCEPTION 'PARTNER_COMMERCIAL_FORBIDDEN';
  END IF;
  IF NOT public.partner_procurement_access_allowed(p_actor, p_company)
     AND NOT EXISTS (
       SELECT 1 FROM public."CompanyMembership" cm
        JOIN public."MembershipRole" mr ON mr.membership_id = cm.id
        JOIN public."RolePermission" rp ON rp.role_id = mr.role_id
        JOIN public."Permission" p ON p.id = rp.permission_id
       WHERE cm."userId" = p_actor AND cm."companyId" = p_company AND cm.status = 'ACTIVE'
         AND p.code IN ('commercial.order.partner_read','partner.portal.read')
     ) THEN
    RAISE EXCEPTION 'PARTNER_COMMERCIAL_FORBIDDEN';
  END IF;
  SELECT * INTO v_row FROM public.commercial_partner_resale_orders
   WHERE id = p_order AND partner_company_id = p_company;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PARTNER_COMMERCIAL_NOT_FOUND'; END IF;
  RETURN jsonb_build_object(
    'id', v_row.id,
    'orderReference', v_row.order_reference,
    'status', v_row.status,
    'currencyCode', v_row.currency_code,
    'paymentTerms', v_row.payment_terms,
    'deliveryTerms', v_row.delivery_terms,
    'commercialNotes', v_row.commercial_notes,
    'saleSubtotal', v_row.sale_subtotal,
    'taxAmount', v_row.tax_amount,
    'saleTotal', v_row.sale_total,
    'fulfillmentReady', v_row.fulfillment_ready,
    'supplierAliasLabel', v_row.supplier_alias_label,
    'confirmedAt', v_row.confirmed_at,
    'createdAt', v_row.created_at,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'description', l.description,
        'specification', l.specification,
        'quantity', l.quantity,
        'saleUnitPrice', l.sale_unit_price,
        'saleLineAmount', l.sale_line_amount
      ) ORDER BY l.description)
      FROM public.commercial_partner_resale_order_lines l WHERE l.resale_order_id = v_row.id
    ), '[]'::jsonb)
  );
END $$;

-- Grants
REVOKE ALL ON FUNCTION public.internal_commercial_capability(UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_commercial_purchase_from_selection(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_commercial_purchase_approve(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_commercial_supplier_order_create(UUID,UUID[],TEXT,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_commercial_supplier_order_approve(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_commercial_supplier_order_issue(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_commercial_supplier_order_confirm(UUID,UUID,TEXT,DATE,TEXT,JSONB,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_commercial_allocation_create(UUID,UUID,NUMERIC,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_commercial_resale_create(UUID,UUID,JSONB,TEXT,TEXT,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_commercial_resale_approve(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_commercial_resale_confirm(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_commercial_order_list(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_commercial_order_get(UUID,UUID,UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.internal_commercial_capability(UUID,TEXT) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_commercial_purchase_from_selection(UUID,UUID,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_commercial_purchase_approve(UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_commercial_supplier_order_create(UUID,UUID[],TEXT,TEXT,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_commercial_supplier_order_approve(UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_commercial_supplier_order_issue(UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_commercial_supplier_order_confirm(UUID,UUID,TEXT,DATE,TEXT,JSONB,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_commercial_allocation_create(UUID,UUID,NUMERIC,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_commercial_resale_create(UUID,UUID,JSONB,TEXT,TEXT,TEXT,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_commercial_resale_approve(UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_commercial_resale_confirm(UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.partner_commercial_order_list(UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.partner_commercial_order_get(UUID,UUID,UUID) TO sco_runtime;

GRANT SELECT, INSERT, UPDATE ON
  public.commercial_purchase_intents,
  public.commercial_purchase_intent_lines,
  public.commercial_supplier_orders,
  public.commercial_supplier_order_intents,
  public.commercial_supplier_order_lines,
  public.commercial_partner_allocations,
  public.commercial_partner_resale_orders,
  public.commercial_partner_resale_order_lines
TO sco_runtime;
