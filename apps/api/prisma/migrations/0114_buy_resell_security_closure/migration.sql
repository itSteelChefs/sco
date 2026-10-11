-- Capability E security closure: 0113 must not reintroduce app.sco_internal as a
-- runtime authorization primitive. Internal commercial source-of-truth is reachable
-- only through typed, capability-checked SECURITY DEFINER gateways owned by the
-- existing NOLOGIN/non-BYPASSRLS gateway role; partner projections remain typed.

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
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM sco_runtime, sco_internal_executor', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_internal', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_access', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO sco_internal_gateway_owner', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO sco_internal_gateway_owner USING (true) WITH CHECK (true)', t || '_gateway_owner', t);
  END LOOP;
END $$;

-- E consumes immutable D facts. The NOLOGIN gateway owner can read only through
-- the narrow E functions below; no D table is granted to runtime or mutated here.
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'procurement_requirements',
    'procurement_requirement_lines',
    'procurement_requirement_quotes',
    'procurement_requirement_quote_lines',
    'procurement_selection_candidates'
  ] LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO sco_internal_gateway_owner', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO sco_internal_gateway_owner USING (true)', t || '_e_gateway_read', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.internal_commercial_purchase_get(p_actor UUID, p_intent UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_row RECORD;
BEGIN
  IF NOT (public.internal_commercial_capability(p_actor, 'commercial.purchase.manage')
          OR public.internal_commercial_capability(p_actor, 'commercial.purchase.approve')) THEN
    RAISE EXCEPTION 'COMMERCIAL_PURCHASE_FORBIDDEN';
  END IF;
  SELECT * INTO v_row FROM public.commercial_purchase_intents WHERE id = p_intent;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_INTENT_NOT_FOUND'; END IF;
  RETURN jsonb_build_object(
    'id', v_row.id, 'selectionCandidateId', v_row.selection_candidate_id, 'requirementId', v_row.requirement_id,
    'partnerCompanyId', v_row.partner_company_id, 'quoteId', v_row.quote_id, 'supplierCompanyId', v_row.supplier_company_id,
    'aliasLabel', v_row.alias_label, 'currencyCode', v_row.currency_code, 'status', v_row.status,
    'purchaseSubtotal', v_row.purchase_subtotal, 'purchaseTotal', v_row.purchase_total, 'paymentTerms', v_row.payment_terms,
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', l.id, 'quoteLineId', l.quote_line_id, 'requirementLineId', l.requirement_line_id,
      'description', l.description, 'quantity', l.quantity, 'purchaseUnitPrice', l.purchase_unit_price,
      'lineAmount', l.line_amount, 'valueState', l.value_state
    ) ORDER BY l.description) FROM public.commercial_purchase_intent_lines l WHERE l.intent_id = v_row.id), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.internal_commercial_supplier_order_get(p_actor UUID, p_order UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_row RECORD;
BEGIN
  IF NOT (public.internal_commercial_capability(p_actor, 'commercial.purchase.manage')
          OR public.internal_commercial_capability(p_actor, 'commercial.purchase.approve')) THEN
    RAISE EXCEPTION 'COMMERCIAL_PURCHASE_FORBIDDEN';
  END IF;
  SELECT * INTO v_row FROM public.commercial_supplier_orders WHERE id = p_order;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_ORDER_NOT_FOUND'; END IF;
  RETURN jsonb_build_object(
    'id', v_row.id, 'orderReference', v_row.order_reference, 'scoBuyerCompanyId', v_row.sco_buyer_company_id,
    'supplierCompanyId', v_row.supplier_company_id, 'status', v_row.status, 'currencyCode', v_row.currency_code,
    'purchaseSubtotal', v_row.purchase_subtotal, 'purchaseTotal', v_row.purchase_total, 'paymentTerms', v_row.payment_terms,
    'issuedAt', v_row.issued_at, 'confirmedAt', v_row.confirmed_at, 'confirmationReference', v_row.confirmation_reference,
    'expectedDeliveryDate', v_row.expected_delivery_date,
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', l.id, 'partnerCompanyId', l.partner_company_id, 'requirementLineId', l.requirement_line_id,
      'description', l.description, 'orderedQuantity', l.ordered_quantity, 'confirmedQuantity', l.confirmed_quantity,
      'allocatedQuantity', l.allocated_quantity, 'purchaseUnitPrice', l.purchase_unit_price, 'lineAmount', l.line_amount,
      'availableToAllocate', COALESCE(l.confirmed_quantity, l.ordered_quantity) - l.allocated_quantity
    ) ORDER BY l.description) FROM public.commercial_supplier_order_lines l WHERE l.order_id = v_row.id), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.internal_commercial_allocation_get(p_actor UUID, p_allocation UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_row RECORD;
BEGIN
  IF NOT public.internal_commercial_capability(p_actor, 'commercial.purchase.manage') THEN
    RAISE EXCEPTION 'COMMERCIAL_PURCHASE_FORBIDDEN';
  END IF;
  SELECT * INTO v_row FROM public.commercial_partner_allocations WHERE id = p_allocation;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_ALLOCATION_NOT_FOUND'; END IF;
  RETURN jsonb_build_object(
    'id', v_row.id, 'supplierOrderLineId', v_row.supplier_order_line_id, 'supplierOrderId', v_row.supplier_order_id,
    'partnerCompanyId', v_row.partner_company_id, 'requirementId', v_row.requirement_id,
    'requirementLineId', v_row.requirement_line_id, 'allocatedQuantity', v_row.allocated_quantity,
    'purchaseUnitPrice', v_row.purchase_unit_price, 'purchaseLineAmount', v_row.purchase_line_amount,
    'status', v_row.status, 'resaleOrderLineId', v_row.resale_order_line_id
  );
END $$;

CREATE OR REPLACE FUNCTION public.internal_commercial_resale_get(p_actor UUID, p_order UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_row RECORD;
BEGIN
  IF NOT (public.internal_commercial_capability(p_actor, 'commercial.resale.manage')
          OR public.internal_commercial_capability(p_actor, 'commercial.resale.approve')) THEN
    RAISE EXCEPTION 'COMMERCIAL_RESALE_FORBIDDEN';
  END IF;
  SELECT * INTO v_row FROM public.commercial_partner_resale_orders WHERE id = p_order;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_RESALE_NOT_FOUND'; END IF;
  RETURN jsonb_build_object(
    'id', v_row.id, 'orderReference', v_row.order_reference, 'partnerCompanyId', v_row.partner_company_id,
    'scoSellerCompanyId', v_row.sco_seller_company_id, 'status', v_row.status, 'currencyCode', v_row.currency_code,
    'paymentTerms', v_row.payment_terms, 'saleSubtotal', v_row.sale_subtotal, 'saleTotal', v_row.sale_total,
    'purchaseCostTotal', v_row.purchase_cost_total, 'grossMargin', v_row.gross_margin,
    'supplierAliasLabel', v_row.supplier_alias_label, 'fulfillmentReady', v_row.fulfillment_ready,
    'confirmedAt', v_row.confirmed_at,
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', l.id, 'allocationId', l.allocation_id, 'description', l.description, 'quantity', l.quantity,
      'saleUnitPrice', l.sale_unit_price, 'saleLineAmount', l.sale_line_amount,
      'purchaseUnitPrice', l.purchase_unit_price, 'purchaseLineAmount', l.purchase_line_amount,
      'lineGrossMargin', l.line_gross_margin
    ) ORDER BY l.description) FROM public.commercial_partner_resale_order_lines l WHERE l.resale_order_id = v_row.id), '[]'::jsonb)
  );
END $$;

ALTER FUNCTION public.internal_commercial_capability(UUID, TEXT) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_purchase_from_selection(UUID, UUID, TEXT, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_purchase_approve(UUID, UUID, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_supplier_order_create(UUID, UUID[], TEXT, TEXT, TEXT, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_supplier_order_approve(UUID, UUID, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_supplier_order_issue(UUID, UUID, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_supplier_order_confirm(UUID, UUID, TEXT, DATE, TEXT, JSONB, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_allocation_create(UUID, UUID, NUMERIC, TEXT, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_resale_create(UUID, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_resale_approve(UUID, UUID, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_resale_confirm(UUID, UUID, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_purchase_get(UUID, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_supplier_order_get(UUID, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_allocation_get(UUID, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_resale_get(UUID, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.partner_commercial_order_list(UUID, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.partner_commercial_order_get(UUID, UUID, UUID) OWNER TO sco_internal_gateway_owner;

REVOKE ALL ON FUNCTION
  public.internal_commercial_capability(UUID, TEXT),
  public.internal_commercial_purchase_from_selection(UUID, UUID, TEXT, UUID),
  public.internal_commercial_purchase_approve(UUID, UUID, UUID),
  public.internal_commercial_supplier_order_create(UUID, UUID[], TEXT, TEXT, TEXT, UUID),
  public.internal_commercial_supplier_order_approve(UUID, UUID, UUID),
  public.internal_commercial_supplier_order_issue(UUID, UUID, UUID),
  public.internal_commercial_supplier_order_confirm(UUID, UUID, TEXT, DATE, TEXT, JSONB, UUID),
  public.internal_commercial_allocation_create(UUID, UUID, NUMERIC, TEXT, UUID),
  public.internal_commercial_resale_create(UUID, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, UUID),
  public.internal_commercial_resale_approve(UUID, UUID, UUID),
  public.internal_commercial_resale_confirm(UUID, UUID, UUID),
  public.internal_commercial_purchase_get(UUID, UUID),
  public.internal_commercial_supplier_order_get(UUID, UUID),
  public.internal_commercial_allocation_get(UUID, UUID),
  public.internal_commercial_resale_get(UUID, UUID),
  public.partner_commercial_order_list(UUID, UUID),
  public.partner_commercial_order_get(UUID, UUID, UUID)
FROM PUBLIC, sco_runtime, sco_internal_executor;

GRANT EXECUTE ON FUNCTION
  public.internal_commercial_purchase_from_selection(UUID, UUID, TEXT, UUID),
  public.internal_commercial_purchase_approve(UUID, UUID, UUID),
  public.internal_commercial_supplier_order_create(UUID, UUID[], TEXT, TEXT, TEXT, UUID),
  public.internal_commercial_supplier_order_approve(UUID, UUID, UUID),
  public.internal_commercial_supplier_order_issue(UUID, UUID, UUID),
  public.internal_commercial_supplier_order_confirm(UUID, UUID, TEXT, DATE, TEXT, JSONB, UUID),
  public.internal_commercial_allocation_create(UUID, UUID, NUMERIC, TEXT, UUID),
  public.internal_commercial_resale_create(UUID, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, UUID),
  public.internal_commercial_resale_approve(UUID, UUID, UUID),
  public.internal_commercial_resale_confirm(UUID, UUID, UUID),
  public.internal_commercial_purchase_get(UUID, UUID),
  public.internal_commercial_supplier_order_get(UUID, UUID),
  public.internal_commercial_allocation_get(UUID, UUID),
  public.internal_commercial_resale_get(UUID, UUID)
TO sco_internal_executor;

GRANT EXECUTE ON FUNCTION public.partner_commercial_order_list(UUID, UUID), public.partner_commercial_order_get(UUID, UUID, UUID) TO sco_runtime;
