CREATE TABLE public.supplier_po_delivery_execution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tranche_id UUID NOT NULL REFERENCES public.supplier_po_delivery_tranches(id) ON DELETE RESTRICT,
  delivered_quantity NUMERIC(18,4) NOT NULL CHECK (delivered_quantity > 0),
  delivered_at TIMESTAMPTZ NOT NULL,
  operational_reference TEXT CHECK (operational_reference IS NULL OR btrim(operational_reference) <> ''),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id),
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supplier_po_delivery_execution_idempotency_unique UNIQUE (tranche_id, idempotency_key)
);

CREATE INDEX supplier_po_delivery_execution_tranche_time_idx
  ON public.supplier_po_delivery_execution_events(tranche_id, delivered_at, id);

ALTER TABLE public.supplier_po_delivery_execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_po_delivery_execution_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_po_delivery_execution_events FROM PUBLIC, sco_runtime, sco_internal_executor;

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'delivery.execution.record', 'Record physical delivery execution'),
  (gen_random_uuid(), 'delivery.execution.read_all', 'Read all physical delivery execution progress'),
  (gen_random_uuid(), 'delivery.execution.read_assigned', 'Read assigned physical delivery execution progress')
ON CONFLICT (code) DO NOTHING;

CREATE FUNCTION public.delivery_execution_line_scope_allowed(p_actor UUID, p_line UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.supplier_purchase_order_lines l
    JOIN public.supplier_purchase_orders po ON po.id = l.supplier_purchase_order_id
    JOIN public.product_identities pi ON pi.id = l.product_identity_id
    JOIN public.procurement_engineer_scope_assignments s
      ON s.actor_user_id = p_actor
     AND s.purchase_source_id = po.purchase_source_id
     AND s.product_category_id = pi.category_id
     AND s.status = 'ACTIVE'
    WHERE l.id = p_line
  ) OR EXISTS (
    SELECT 1
    FROM public.supplier_po_line_responsibilities r
    WHERE r.supplier_purchase_order_line_id = p_line
      AND r.actor_user_id = p_actor
  )
$$;

CREATE FUNCTION public.prevent_supplier_po_delivery_execution_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'DELIVERY_EXECUTION_IMMUTABLE';
END
$$;

CREATE TRIGGER supplier_po_delivery_execution_immutable
  BEFORE UPDATE OR DELETE ON public.supplier_po_delivery_execution_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_po_delivery_execution_mutation();

CREATE FUNCTION public.internal_supplier_po_delivery_execution_record(
  p_actor UUID,
  p_tranche UUID,
  p_quantity NUMERIC,
  p_delivered_at TIMESTAMPTZ,
  p_operational_reference TEXT,
  p_idempotency_key TEXT,
  p_correlation TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tranche RECORD;
  v_existing RECORD;
  v_delivered NUMERIC;
  v_id UUID;
  v_reference TEXT := NULLIF(btrim(p_operational_reference), '');
  v_idempotency_key TEXT := btrim(COALESCE(p_idempotency_key, ''));
  v_actor_context TEXT := NULLIF(current_setting('app.actor_id', true), '');
BEGIN
  IF p_actor IS NULL
     OR NOT EXISTS (SELECT 1 FROM public."User" u WHERE u.id = p_actor AND u.status = 'ACTIVE')
     OR NOT public.internal_has_capability(p_actor, 'delivery.execution.record') THEN
    RAISE EXCEPTION 'DELIVERY_EXECUTION_FORBIDDEN';
  END IF;
  IF v_actor_context IS NOT NULL AND v_actor_context <> p_actor::TEXT THEN
    RAISE EXCEPTION 'DELIVERY_EXECUTION_FORBIDDEN';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity <> round(p_quantity, 4)
     OR p_delivered_at IS NULL OR v_idempotency_key = '' THEN
    RAISE EXCEPTION 'DELIVERY_EXECUTION_INVALID';
  END IF;

  SELECT t.id, t.quantity, t.status, t.supplier_purchase_order_line_id
    INTO v_tranche
    FROM public.supplier_po_delivery_tranches t
   WHERE t.id = p_tranche
   FOR UPDATE;
  IF NOT FOUND OR NOT public.delivery_execution_line_scope_allowed(p_actor, v_tranche.supplier_purchase_order_line_id) THEN
    RAISE EXCEPTION 'DELIVERY_EXECUTION_FORBIDDEN';
  END IF;

  SELECT e.id, e.delivered_quantity, e.delivered_at, e.operational_reference
    INTO v_existing
    FROM public.supplier_po_delivery_execution_events e
   WHERE e.tranche_id = p_tranche
     AND e.idempotency_key = v_idempotency_key;
  IF FOUND THEN
    IF v_existing.delivered_quantity IS DISTINCT FROM p_quantity
       OR v_existing.delivered_at IS DISTINCT FROM p_delivered_at
       OR v_existing.operational_reference IS DISTINCT FROM v_reference THEN
      RAISE EXCEPTION 'DELIVERY_EXECUTION_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_existing.id;
  END IF;

  IF v_tranche.status <> 'READY_FOR_DELIVERY' THEN
    RAISE EXCEPTION 'DELIVERY_EXECUTION_NOT_READY';
  END IF;

  SELECT COALESCE(sum(e.delivered_quantity), 0)
    INTO v_delivered
    FROM public.supplier_po_delivery_execution_events e
   WHERE e.tranche_id = p_tranche;
  IF v_delivered + p_quantity > v_tranche.quantity THEN
    RAISE EXCEPTION 'DELIVERY_EXECUTION_OVER_DELIVERY';
  END IF;

  INSERT INTO public.supplier_po_delivery_execution_events(
    tranche_id, delivered_quantity, delivered_at, operational_reference,
    actor_user_id, idempotency_key, correlation_id
  ) VALUES (
    p_tranche, p_quantity, p_delivered_at, v_reference,
    p_actor, v_idempotency_key, NULLIF(p_correlation, '')::UUID
  ) RETURNING id INTO v_id;

  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (
    p_actor, 'SCO_INTERNAL', 'supplier_po.delivery.execution_recorded',
    'SupplierPODeliveryExecutionEvent', v_id,
    jsonb_build_object(
      'trancheId', p_tranche,
      'quantity', p_quantity,
      'deliveredAt', p_delivered_at,
      'operationalReference', v_reference,
      'idempotencyKey', v_idempotency_key,
      'outcome', 'RECORDED'
    ),
    NULLIF(p_correlation, '')::UUID
  );
  RETURN v_id;
END
$$;

CREATE FUNCTION public.internal_supplier_po_delivery_execution_get(p_actor UUID, p_tranche UUID)
RETURNS TABLE(
  tranche_id UUID,
  scheduled_quantity NUMERIC,
  delivered_quantity NUMERIC,
  remaining_quantity NUMERIC,
  delivery_event_count INTEGER,
  latest_delivered_at TIMESTAMPTZ
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT t.id,
         t.quantity,
         COALESCE(sum(e.delivered_quantity), 0),
         t.quantity - COALESCE(sum(e.delivered_quantity), 0),
         count(e.id)::INTEGER,
         max(e.delivered_at)
    FROM public.supplier_po_delivery_tranches t
    LEFT JOIN public.supplier_po_delivery_execution_events e ON e.tranche_id = t.id
   WHERE t.id = p_tranche
     AND EXISTS (SELECT 1 FROM public."User" u WHERE u.id = p_actor AND u.status = 'ACTIVE')
     AND (NULLIF(current_setting('app.actor_id', true), '') IS NULL
          OR NULLIF(current_setting('app.actor_id', true), '') = p_actor::TEXT)
     AND (
       public.internal_has_capability(p_actor, 'delivery.execution.read_all')
       OR (
         public.internal_has_capability(p_actor, 'delivery.execution.read_assigned')
         AND public.delivery_execution_line_scope_allowed(p_actor, t.supplier_purchase_order_line_id)
       )
     )
   GROUP BY t.id, t.quantity
$$;

REVOKE ALL ON FUNCTION public.delivery_execution_line_scope_allowed(UUID, UUID) FROM PUBLIC, sco_runtime, sco_internal_executor;
REVOKE ALL ON FUNCTION public.prevent_supplier_po_delivery_execution_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_supplier_po_delivery_execution_record(UUID, UUID, NUMERIC, TIMESTAMPTZ, TEXT, TEXT, TEXT) FROM PUBLIC, sco_runtime;
REVOKE ALL ON FUNCTION public.internal_supplier_po_delivery_execution_get(UUID, UUID) FROM PUBLIC, sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_supplier_po_delivery_execution_record(UUID, UUID, NUMERIC, TIMESTAMPTZ, TEXT, TEXT, TEXT) TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.internal_supplier_po_delivery_execution_get(UUID, UUID) TO sco_internal_executor;