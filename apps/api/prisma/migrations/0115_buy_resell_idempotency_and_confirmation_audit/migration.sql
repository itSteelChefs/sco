-- E closure: serialize idempotency decisions before calling the original
-- commercial writers, and reject a key reused for a different request.

ALTER FUNCTION public.internal_commercial_purchase_from_selection(UUID, UUID, TEXT, UUID)
  RENAME TO internal_commercial_purchase_from_selection_v1;
CREATE FUNCTION public.internal_commercial_purchase_from_selection(p_actor UUID, p_selection UUID, p_idempotency_key TEXT, p_correlation UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_existing RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('commercial.purchase:' || COALESCE(p_idempotency_key, ''), 0));
  SELECT id, selection_candidate_id, created_by INTO v_existing FROM public.commercial_purchase_intents WHERE idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.selection_candidate_id = p_selection AND v_existing.created_by = p_actor THEN RETURN v_existing.id; END IF;
    RAISE EXCEPTION 'COMMERCIAL_IDEMPOTENCY_CONFLICT';
  END IF;
  RETURN public.internal_commercial_purchase_from_selection_v1(p_actor, p_selection, p_idempotency_key, p_correlation);
END $$;

ALTER FUNCTION public.internal_commercial_supplier_order_create(UUID, UUID[], TEXT, TEXT, TEXT, UUID)
  RENAME TO internal_commercial_supplier_order_create_v1;
CREATE FUNCTION public.internal_commercial_supplier_order_create(p_actor UUID, p_intent_ids UUID[], p_idempotency_key TEXT, p_delivery_context TEXT, p_commercial_terms TEXT, p_correlation UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_existing RECORD; v_requested UUID[];
BEGIN
  IF p_intent_ids IS NULL OR array_length(p_intent_ids, 1) IS NULL OR cardinality(p_intent_ids) <> cardinality(ARRAY(SELECT DISTINCT x FROM unnest(p_intent_ids) x)) THEN RAISE EXCEPTION 'COMMERCIAL_INTENTS_REQUIRED'; END IF;
  SELECT array_agg(x ORDER BY x) INTO v_requested FROM unnest(p_intent_ids) x;
  PERFORM pg_advisory_xact_lock(hashtextextended('commercial.supplier-order:' || COALESCE(p_idempotency_key, ''), 0));
  SELECT o.id, o.created_by, o.delivery_context, o.commercial_terms, array_agg(i.intent_id ORDER BY i.intent_id) AS intent_ids
    INTO v_existing FROM public.commercial_supplier_orders o LEFT JOIN public.commercial_supplier_order_intents i ON i.order_id=o.id
   WHERE o.idempotency_key=p_idempotency_key GROUP BY o.id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.created_by=p_actor AND v_existing.delivery_context IS NOT DISTINCT FROM p_delivery_context
       AND v_existing.commercial_terms IS NOT DISTINCT FROM p_commercial_terms AND v_existing.intent_ids=v_requested THEN RETURN v_existing.id; END IF;
    RAISE EXCEPTION 'COMMERCIAL_IDEMPOTENCY_CONFLICT';
  END IF;
  RETURN public.internal_commercial_supplier_order_create_v1(p_actor, p_intent_ids, p_idempotency_key, p_delivery_context, p_commercial_terms, p_correlation);
END $$;

ALTER FUNCTION public.internal_commercial_allocation_create(UUID, UUID, NUMERIC, TEXT, UUID)
  RENAME TO internal_commercial_allocation_create_v1;
CREATE FUNCTION public.internal_commercial_allocation_create(p_actor UUID, p_order_line UUID, p_quantity NUMERIC, p_idempotency_key TEXT, p_correlation UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_existing RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('commercial.allocation:' || COALESCE(p_idempotency_key, ''), 0));
  SELECT id, created_by, supplier_order_line_id, allocated_quantity INTO v_existing FROM public.commercial_partner_allocations WHERE idempotency_key=p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.created_by=p_actor AND v_existing.supplier_order_line_id=p_order_line AND v_existing.allocated_quantity=p_quantity THEN RETURN v_existing.id; END IF;
    RAISE EXCEPTION 'COMMERCIAL_IDEMPOTENCY_CONFLICT';
  END IF;
  RETURN public.internal_commercial_allocation_create_v1(p_actor, p_order_line, p_quantity, p_idempotency_key, p_correlation);
END $$;

ALTER FUNCTION public.internal_commercial_resale_create(UUID, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, UUID)
  RENAME TO internal_commercial_resale_create_v1;
CREATE FUNCTION public.internal_commercial_resale_create(p_actor UUID, p_partner_company UUID, p_allocations JSONB, p_payment_terms TEXT, p_delivery_terms TEXT, p_commercial_notes TEXT, p_idempotency_key TEXT, p_correlation UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_existing RECORD; v_requested JSONB;
BEGIN
  SELECT jsonb_agg(x ORDER BY x->>'allocationId') INTO v_requested FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) x;
  PERFORM pg_advisory_xact_lock(hashtextextended('commercial.resale:' || COALESCE(p_idempotency_key, ''), 0));
  SELECT o.id, o.created_by, o.partner_company_id, o.payment_terms, o.delivery_terms, o.commercial_notes,
         jsonb_agg(jsonb_build_object('allocationId', l.allocation_id, 'saleUnitPrice', l.sale_unit_price) ORDER BY l.allocation_id::text) AS allocations
    INTO v_existing FROM public.commercial_partner_resale_orders o LEFT JOIN public.commercial_partner_resale_order_lines l ON l.resale_order_id=o.id
   WHERE o.idempotency_key=p_idempotency_key GROUP BY o.id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.created_by=p_actor AND v_existing.partner_company_id=p_partner_company
       AND v_existing.payment_terms=COALESCE(NULLIF(btrim(p_payment_terms),''),'CASH')
       AND v_existing.delivery_terms IS NOT DISTINCT FROM p_delivery_terms AND v_existing.commercial_notes IS NOT DISTINCT FROM p_commercial_notes
       AND v_existing.allocations=v_requested THEN RETURN v_existing.id; END IF;
    RAISE EXCEPTION 'COMMERCIAL_IDEMPOTENCY_CONFLICT';
  END IF;
  RETURN public.internal_commercial_resale_create_v1(p_actor, p_partner_company, p_allocations, p_payment_terms, p_delivery_terms, p_commercial_notes, p_idempotency_key, p_correlation);
END $$;

CREATE FUNCTION public.commercial_supplier_confirmation_revision_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor UUID; v_company UUID;
BEGIN
  IF OLD.confirmed_quantity IS NULL OR OLD.confirmed_quantity IS NOT DISTINCT FROM NEW.confirmed_quantity THEN RETURN NEW; END IF;
  v_actor := NULLIF(current_setting('app.actor_id', true), '')::UUID;
  SELECT sco_buyer_company_id INTO v_company FROM public.commercial_supplier_orders WHERE id=NEW.order_id;
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata)
  VALUES (v_actor, v_company, 'SCO_INTERNAL', 'commercial.supplier_order.confirmation_revised', 'CommercialSupplierOrder', NEW.order_id,
          jsonb_build_object('lineId', NEW.id, 'previousConfirmedQuantity', OLD.confirmed_quantity, 'confirmedQuantity', NEW.confirmed_quantity));
  RETURN NEW;
END $$;
CREATE TRIGGER commercial_supplier_confirmation_revision_audit_trg
AFTER UPDATE OF confirmed_quantity ON public.commercial_supplier_order_lines
FOR EACH ROW EXECUTE FUNCTION public.commercial_supplier_confirmation_revision_audit();

ALTER FUNCTION public.internal_commercial_purchase_from_selection(UUID, UUID, TEXT, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_supplier_order_create(UUID, UUID[], TEXT, TEXT, TEXT, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_allocation_create(UUID, UUID, NUMERIC, TEXT, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_resale_create(UUID, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.commercial_supplier_confirmation_revision_audit() OWNER TO sco_internal_gateway_owner;
REVOKE ALL ON FUNCTION public.internal_commercial_purchase_from_selection_v1(UUID, UUID, TEXT, UUID), public.internal_commercial_supplier_order_create_v1(UUID, UUID[], TEXT, TEXT, TEXT, UUID), public.internal_commercial_allocation_create_v1(UUID, UUID, NUMERIC, TEXT, UUID), public.internal_commercial_resale_create_v1(UUID, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, sco_runtime, sco_internal_executor;
REVOKE ALL ON FUNCTION public.internal_commercial_purchase_from_selection(UUID, UUID, TEXT, UUID), public.internal_commercial_supplier_order_create(UUID, UUID[], TEXT, TEXT, TEXT, UUID), public.internal_commercial_allocation_create(UUID, UUID, NUMERIC, TEXT, UUID), public.internal_commercial_resale_create(UUID, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_commercial_purchase_from_selection(UUID, UUID, TEXT, UUID), public.internal_commercial_supplier_order_create(UUID, UUID[], TEXT, TEXT, TEXT, UUID), public.internal_commercial_allocation_create(UUID, UUID, NUMERIC, TEXT, UUID), public.internal_commercial_resale_create(UUID, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, UUID) TO sco_internal_executor;
