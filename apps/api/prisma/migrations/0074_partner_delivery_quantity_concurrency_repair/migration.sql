CREATE OR REPLACE FUNCTION public.partner_delivery_receipt_confirm(
  p_actor UUID,
  p_company UUID,
  p_delivery_event UUID,
  p_quantity NUMERIC,
  p_received_at TIMESTAMPTZ,
  p_note TEXT,
  p_idempotency_key TEXT,
  p_correlation TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delivery RECORD;
  v_existing RECORD;
  v_received NUMERIC;
  v_id UUID;
  v_note TEXT := NULLIF(btrim(p_note), '');
  v_key TEXT := btrim(COALESCE(p_idempotency_key, ''));
BEGIN
  IF current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::TEXT
     OR current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::TEXT
     OR NOT public.partner_delivery_action_capability(p_actor, p_company, 'delivery.receipt.confirm') THEN
    RAISE EXCEPTION 'PARTNER_DELIVERY_FORBIDDEN';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity <> round(p_quantity, 4)
     OR p_received_at IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'PARTNER_DELIVERY_RECEIPT_INVALID';
  END IF;
  SELECT e.id, e.delivered_quantity
    INTO v_delivery
    FROM public.supplier_po_delivery_execution_events e
    JOIN public.supplier_po_delivery_tranches t ON t.id = e.tranche_id
    JOIN public.partner_delivery_sites site ON site.id = t.partner_delivery_site_id
   WHERE e.id = p_delivery_event
     AND site.company_id = p_company
   FOR UPDATE OF e;
  IF NOT FOUND THEN RAISE EXCEPTION 'PARTNER_DELIVERY_FORBIDDEN'; END IF;
  SELECT id,received_quantity,received_at,operational_note INTO v_existing
    FROM public.partner_delivery_receipt_events
   WHERE partner_company_id = p_company AND delivery_execution_event_id = p_delivery_event AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.received_quantity IS DISTINCT FROM p_quantity OR v_existing.received_at IS DISTINCT FROM p_received_at OR v_existing.operational_note IS DISTINCT FROM v_note THEN
      RAISE EXCEPTION 'PARTNER_DELIVERY_RECEIPT_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_existing.id;
  END IF;
  SELECT COALESCE(sum(received_quantity), 0) INTO v_received
    FROM public.partner_delivery_receipt_events
   WHERE partner_company_id = p_company AND delivery_execution_event_id = p_delivery_event;
  IF v_received + p_quantity > v_delivery.delivered_quantity THEN
    RAISE EXCEPTION 'PARTNER_DELIVERY_RECEIPT_QUANTITY_EXCEEDED';
  END IF;
  INSERT INTO public.partner_delivery_receipt_events(partner_company_id,delivery_execution_event_id,received_quantity,received_at,operational_note,actor_user_id,idempotency_key,correlation_id)
  VALUES(p_company,p_delivery_event,p_quantity,p_received_at,v_note,p_actor,v_key,NULLIF(p_correlation,'')::UUID)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(company_id,actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id)
  VALUES(p_company,p_actor,'TENANT','delivery.receipt.confirmed','PartnerDeliveryReceipt',v_id,jsonb_build_object('deliveryEventId',p_delivery_event,'quantity',p_quantity,'receivedAt',p_received_at,'idempotencyKey',v_key,'outcome','CONFIRMED'),NULLIF(p_correlation,'')::UUID);
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.partner_delivery_acceptance_confirm(
  p_actor UUID,
  p_company UUID,
  p_delivery_event UUID,
  p_quantity NUMERIC,
  p_accepted_at TIMESTAMPTZ,
  p_idempotency_key TEXT,
  p_correlation TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delivery RECORD;
  v_existing RECORD;
  v_received NUMERIC;
  v_accepted NUMERIC;
  v_id UUID;
  v_key TEXT := btrim(COALESCE(p_idempotency_key, ''));
BEGIN
  IF current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::TEXT
     OR current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::TEXT
     OR NOT public.partner_delivery_action_capability(p_actor, p_company, 'delivery.acceptance.confirm') THEN
    RAISE EXCEPTION 'PARTNER_DELIVERY_FORBIDDEN';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity <> round(p_quantity, 4)
     OR p_accepted_at IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'PARTNER_DELIVERY_ACCEPTANCE_INVALID';
  END IF;
  SELECT e.id, e.delivered_quantity
    INTO v_delivery
    FROM public.supplier_po_delivery_execution_events e
    JOIN public.supplier_po_delivery_tranches t ON t.id = e.tranche_id
    JOIN public.partner_delivery_sites site ON site.id = t.partner_delivery_site_id
   WHERE e.id = p_delivery_event
     AND site.company_id = p_company
   FOR UPDATE OF e;
  IF NOT FOUND THEN RAISE EXCEPTION 'PARTNER_DELIVERY_FORBIDDEN'; END IF;
  SELECT id,accepted_quantity,accepted_at INTO v_existing
    FROM public.partner_delivery_acceptance_events
   WHERE partner_company_id = p_company AND delivery_execution_event_id = p_delivery_event AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.accepted_quantity IS DISTINCT FROM p_quantity OR v_existing.accepted_at IS DISTINCT FROM p_accepted_at THEN
      RAISE EXCEPTION 'PARTNER_DELIVERY_ACCEPTANCE_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_existing.id;
  END IF;
  SELECT COALESCE(sum(received_quantity),0) INTO v_received FROM public.partner_delivery_receipt_events WHERE partner_company_id=p_company AND delivery_execution_event_id=p_delivery_event;
  SELECT COALESCE(sum(accepted_quantity),0) INTO v_accepted FROM public.partner_delivery_acceptance_events WHERE partner_company_id=p_company AND delivery_execution_event_id=p_delivery_event;
  IF v_received = 0 THEN RAISE EXCEPTION 'PARTNER_DELIVERY_ACCEPTANCE_RECEIPT_REQUIRED'; END IF;
  IF v_accepted + p_quantity > v_received THEN RAISE EXCEPTION 'PARTNER_DELIVERY_ACCEPTANCE_QUANTITY_EXCEEDED'; END IF;
  INSERT INTO public.partner_delivery_acceptance_events(partner_company_id,delivery_execution_event_id,accepted_quantity,accepted_at,actor_user_id,idempotency_key,correlation_id)
  VALUES(p_company,p_delivery_event,p_quantity,p_accepted_at,p_actor,v_key,NULLIF(p_correlation,'')::UUID)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(company_id,actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id)
  VALUES(p_company,p_actor,'TENANT','delivery.acceptance.confirmed','PartnerDeliveryAcceptance',v_id,jsonb_build_object('deliveryEventId',p_delivery_event,'quantity',p_quantity,'acceptedAt',p_accepted_at,'idempotencyKey',v_key,'outcome','CONFIRMED'),NULLIF(p_correlation,'')::UUID);
  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.partner_delivery_receipt_confirm(UUID,UUID,UUID,NUMERIC,TIMESTAMPTZ,TEXT,TEXT,TEXT),public.partner_delivery_acceptance_confirm(UUID,UUID,UUID,NUMERIC,TIMESTAMPTZ,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_delivery_receipt_confirm(UUID,UUID,UUID,NUMERIC,TIMESTAMPTZ,TEXT,TEXT,TEXT),public.partner_delivery_acceptance_confirm(UUID,UUID,UUID,NUMERIC,TIMESTAMPTZ,TEXT,TEXT) TO sco_runtime;