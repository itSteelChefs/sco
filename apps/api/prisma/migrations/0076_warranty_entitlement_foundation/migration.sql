CREATE TYPE public."WarrantyStartTrigger" AS ENUM (
  'DELIVERY',
  'RECEIPT',
  'ACCEPTANCE',
  'INSTALLATION',
  'CONTRACTUAL',
  'PROVIDER_DEFINED'
);

CREATE TYPE public."WarrantyProviderType" AS ENUM (
  'MANUFACTURER',
  'AUTHORIZED_DISTRIBUTOR',
  'SUPPLIER',
  'SCO_CONTRACTUAL',
  'OTHER'
);

CREATE TABLE public.warranty_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  delivery_execution_event_id UUID NOT NULL REFERENCES public.supplier_po_delivery_execution_events(id) ON DELETE RESTRICT,
  product_identity_id UUID NOT NULL REFERENCES public.product_identities(id) ON DELETE RESTRICT,
  covered_quantity NUMERIC(18,4) NOT NULL CHECK (covered_quantity > 0),
  start_trigger public."WarrantyStartTrigger" NOT NULL,
  start_date DATE NOT NULL,
  receipt_event_id UUID REFERENCES public.partner_delivery_receipt_events(id) ON DELETE RESTRICT,
  acceptance_event_id UUID REFERENCES public.partner_delivery_acceptance_events(id) ON DELETE RESTRICT,
  start_reference TEXT CHECK (start_reference IS NULL OR btrim(start_reference) <> ''),
  end_date DATE NOT NULL CHECK (end_date > start_date),
  provider_type public."WarrantyProviderType" NOT NULL,
  provider_company_id UUID REFERENCES public."Company"(id) ON DELETE RESTRICT,
  provider_reference TEXT CHECK (provider_reference IS NULL OR btrim(provider_reference) <> ''),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warranty_entitlement_idempotency_unique UNIQUE (partner_company_id, delivery_execution_event_id, idempotency_key),
  CONSTRAINT warranty_entitlement_provider_identified CHECK (provider_company_id IS NOT NULL OR provider_reference IS NOT NULL)
);

CREATE TABLE public.warranty_entitlement_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warranty_entitlement_id UUID NOT NULL REFERENCES public.warranty_entitlements(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  document_version_id UUID NOT NULL REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warranty_entitlement_evidence_version_unique UNIQUE (warranty_entitlement_id, document_version_id)
);

CREATE INDEX warranty_entitlements_partner_idx ON public.warranty_entitlements(partner_company_id, created_at, id);
CREATE INDEX warranty_entitlements_delivery_idx ON public.warranty_entitlements(delivery_execution_event_id);
CREATE INDEX warranty_entitlement_evidence_entitlement_idx ON public.warranty_entitlement_evidence(warranty_entitlement_id);

ALTER TABLE public.warranty_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warranty_entitlements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.warranty_entitlement_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warranty_entitlement_evidence FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.warranty_entitlements, public.warranty_entitlement_evidence FROM PUBLIC, sco_runtime, sco_internal_executor;

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'warranty.entitlement.register', 'Register scoped warranty entitlements'),
  (gen_random_uuid(), 'warranty.entitlement.read_all', 'Read all warranty entitlements'),
  (gen_random_uuid(), 'warranty.entitlement.read_assigned', 'Read assigned warranty entitlements'),
  (gen_random_uuid(), 'warranty.entitlement.read', 'Read own warranty entitlements')
ON CONFLICT (code) DO NOTHING;

CREATE FUNCTION public.prevent_warranty_entitlement_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'WARRANTY_ENTITLEMENT_IMMUTABLE';
END
$$;

CREATE TRIGGER warranty_entitlements_immutable
  BEFORE UPDATE OR DELETE ON public.warranty_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_warranty_entitlement_mutation();

CREATE TRIGGER warranty_entitlement_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.warranty_entitlement_evidence
  FOR EACH ROW EXECUTE FUNCTION public.prevent_warranty_entitlement_mutation();

CREATE FUNCTION public.internal_warranty_entitlement_register(
  p_actor UUID,
  p_delivery_event UUID,
  p_covered_quantity NUMERIC,
  p_start_trigger public."WarrantyStartTrigger",
  p_start_date DATE,
  p_receipt_event UUID,
  p_acceptance_event UUID,
  p_start_reference TEXT,
  p_end_date DATE,
  p_provider_type public."WarrantyProviderType",
  p_provider_company UUID,
  p_provider_reference TEXT,
  p_evidence_document UUID,
  p_evidence_version UUID,
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
  v_reference RECORD;
  v_id UUID;
  v_capacity NUMERIC;
  v_covered NUMERIC;
  v_key TEXT := btrim(COALESCE(p_idempotency_key, ''));
  v_start_reference TEXT := NULLIF(btrim(p_start_reference), '');
  v_provider_reference TEXT := NULLIF(btrim(p_provider_reference), '');
  v_actor_context TEXT := NULLIF(current_setting('app.actor_id', true), '');
BEGIN
  IF p_actor IS NULL
     OR NOT EXISTS (SELECT 1 FROM public."User" u WHERE u.id = p_actor AND u.status = 'ACTIVE')
     OR NOT public.internal_has_capability(p_actor, 'warranty.entitlement.register')
     OR (v_actor_context IS NOT NULL AND v_actor_context <> p_actor::TEXT) THEN
    RAISE EXCEPTION 'WARRANTY_ENTITLEMENT_FORBIDDEN';
  END IF;

  IF p_covered_quantity IS NULL OR p_covered_quantity <= 0 OR p_covered_quantity <> round(p_covered_quantity, 4)
     OR p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date
     OR p_start_trigger IS NULL OR p_provider_type IS NULL OR v_key = ''
     OR (p_provider_company IS NULL AND v_provider_reference IS NULL)
     OR ((p_evidence_document IS NULL) <> (p_evidence_version IS NULL)) THEN
    RAISE EXCEPTION 'WARRANTY_ENTITLEMENT_INVALID';
  END IF;

  SELECT e.id, e.delivered_quantity, e.delivered_at, t.supplier_purchase_order_line_id,
         l.product_identity_id, site.company_id AS partner_company_id
    INTO v_delivery
    FROM public.supplier_po_delivery_execution_events e
    JOIN public.supplier_po_delivery_tranches t ON t.id = e.tranche_id
    JOIN public.supplier_purchase_order_lines l ON l.id = t.supplier_purchase_order_line_id
    JOIN public.partner_delivery_sites site ON site.id = t.partner_delivery_site_id
   WHERE e.id = p_delivery_event
   FOR UPDATE OF e;

  IF NOT FOUND OR NOT public.delivery_execution_line_scope_allowed(p_actor, v_delivery.supplier_purchase_order_line_id) THEN
    RAISE EXCEPTION 'WARRANTY_ENTITLEMENT_FORBIDDEN';
  END IF;

  SELECT w.*, evidence.document_id AS evidence_document_id, evidence.document_version_id AS evidence_version_id
    INTO v_existing
    FROM public.warranty_entitlements w
    LEFT JOIN public.warranty_entitlement_evidence evidence ON evidence.warranty_entitlement_id = w.id
   WHERE w.partner_company_id = v_delivery.partner_company_id
     AND w.delivery_execution_event_id = p_delivery_event
     AND w.idempotency_key = v_key;

  IF FOUND THEN
    IF v_existing.covered_quantity IS DISTINCT FROM p_covered_quantity
       OR v_existing.start_trigger IS DISTINCT FROM p_start_trigger
       OR v_existing.start_date IS DISTINCT FROM p_start_date
       OR v_existing.receipt_event_id IS DISTINCT FROM p_receipt_event
       OR v_existing.acceptance_event_id IS DISTINCT FROM p_acceptance_event
       OR v_existing.start_reference IS DISTINCT FROM v_start_reference
       OR v_existing.end_date IS DISTINCT FROM p_end_date
       OR v_existing.provider_type IS DISTINCT FROM p_provider_type
       OR v_existing.provider_company_id IS DISTINCT FROM p_provider_company
       OR v_existing.provider_reference IS DISTINCT FROM v_provider_reference
       OR v_existing.evidence_document_id IS DISTINCT FROM p_evidence_document
       OR v_existing.evidence_version_id IS DISTINCT FROM p_evidence_version THEN
      RAISE EXCEPTION 'WARRANTY_ENTITLEMENT_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_existing.id;
  END IF;

  v_capacity := v_delivery.delivered_quantity;
  IF p_start_trigger = 'DELIVERY' THEN
    IF p_receipt_event IS NOT NULL OR p_acceptance_event IS NOT NULL OR v_start_reference IS NOT NULL OR p_start_date <> v_delivery.delivered_at::DATE THEN
      RAISE EXCEPTION 'WARRANTY_ENTITLEMENT_REFERENCE_INVALID';
    END IF;
  ELSIF p_start_trigger = 'RECEIPT' THEN
    SELECT received_quantity, received_at
      INTO v_reference
      FROM public.partner_delivery_receipt_events
     WHERE id = p_receipt_event
       AND partner_company_id = v_delivery.partner_company_id
       AND delivery_execution_event_id = p_delivery_event;
    IF NOT FOUND OR p_acceptance_event IS NOT NULL OR v_start_reference IS NOT NULL OR p_start_date <> v_reference.received_at::DATE THEN
      RAISE EXCEPTION 'WARRANTY_ENTITLEMENT_REFERENCE_INVALID';
    END IF;
    v_capacity := v_reference.received_quantity;
  ELSIF p_start_trigger = 'ACCEPTANCE' THEN
    SELECT accepted_quantity, accepted_at
      INTO v_reference
      FROM public.partner_delivery_acceptance_events
     WHERE id = p_acceptance_event
       AND partner_company_id = v_delivery.partner_company_id
       AND delivery_execution_event_id = p_delivery_event;
    IF NOT FOUND OR p_receipt_event IS NOT NULL OR v_start_reference IS NOT NULL OR p_start_date <> v_reference.accepted_at::DATE THEN
      RAISE EXCEPTION 'WARRANTY_ENTITLEMENT_REFERENCE_INVALID';
    END IF;
    v_capacity := v_reference.accepted_quantity;
  ELSE
    IF p_receipt_event IS NOT NULL OR p_acceptance_event IS NOT NULL OR v_start_reference IS NULL THEN
      RAISE EXCEPTION 'WARRANTY_ENTITLEMENT_REFERENCE_INVALID';
    END IF;
  END IF;

  IF p_covered_quantity > v_capacity THEN
    RAISE EXCEPTION 'WARRANTY_ENTITLEMENT_QUANTITY_EXCEEDED';
  END IF;

  SELECT COALESCE(sum(covered_quantity), 0)
    INTO v_covered
    FROM public.warranty_entitlements
   WHERE delivery_execution_event_id = p_delivery_event;
  IF v_covered + p_covered_quantity > v_delivery.delivered_quantity THEN
    RAISE EXCEPTION 'WARRANTY_ENTITLEMENT_QUANTITY_EXCEEDED';
  END IF;

  IF p_evidence_document IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.documents d
      JOIN public.document_versions dv ON dv.document_id = d.id
     WHERE d.id = p_evidence_document
       AND dv.id = p_evidence_version
       AND d.company_id = v_delivery.partner_company_id
       AND d.access_scope = 'TENANT'
       AND d.status = 'AVAILABLE'
  ) THEN
    RAISE EXCEPTION 'WARRANTY_ENTITLEMENT_EVIDENCE_INVALID';
  END IF;

  INSERT INTO public.warranty_entitlements(
    partner_company_id, delivery_execution_event_id, product_identity_id, covered_quantity,
    start_trigger, start_date, receipt_event_id, acceptance_event_id, start_reference,
    end_date, provider_type, provider_company_id, provider_reference, actor_user_id,
    idempotency_key, correlation_id
  ) VALUES (
    v_delivery.partner_company_id, p_delivery_event, v_delivery.product_identity_id, p_covered_quantity,
    p_start_trigger, p_start_date, p_receipt_event, p_acceptance_event, v_start_reference,
    p_end_date, p_provider_type, p_provider_company, v_provider_reference, p_actor,
    v_key, NULLIF(p_correlation, '')::UUID
  ) RETURNING id INTO v_id;

  IF p_evidence_document IS NOT NULL THEN
    INSERT INTO public.warranty_entitlement_evidence(warranty_entitlement_id, document_id, document_version_id, created_by)
    VALUES (v_id, p_evidence_document, p_evidence_version, p_actor);
  END IF;

  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (
    p_actor, 'SCO_INTERNAL', 'warranty.entitlement.registered', 'WarrantyEntitlement', v_id,
    jsonb_build_object(
      'partnerCompanyId', v_delivery.partner_company_id,
      'deliveryEventId', p_delivery_event,
      'productIdentityId', v_delivery.product_identity_id,
      'coveredQuantity', p_covered_quantity,
      'startTrigger', p_start_trigger,
      'startDate', p_start_date,
      'endDate', p_end_date,
      'providerType', p_provider_type,
      'providerCompanyId', p_provider_company,
      'evidenceAttached', p_evidence_document IS NOT NULL,
      'idempotencyKey', v_key,
      'outcome', 'REGISTERED'
    ),
    NULLIF(p_correlation, '')::UUID
  );
  RETURN v_id;
END
$$;

CREATE FUNCTION public.internal_warranty_entitlement_get(p_actor UUID, p_entitlement UUID)
RETURNS TABLE(
  id UUID,
  partner_company_id UUID,
  delivery_execution_event_id UUID,
  product_identity_id UUID,
  covered_quantity NUMERIC,
  start_trigger TEXT,
  start_date DATE,
  receipt_event_id UUID,
  acceptance_event_id UUID,
  start_reference TEXT,
  end_date DATE,
  provider_type TEXT,
  provider_company_id UUID,
  provider_reference TEXT,
  evidence_document_id UUID,
  evidence_document_version_id UUID
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT w.id, w.partner_company_id, w.delivery_execution_event_id, w.product_identity_id,
         w.covered_quantity, w.start_trigger::TEXT, w.start_date, w.receipt_event_id,
         w.acceptance_event_id, w.start_reference, w.end_date, w.provider_type::TEXT,
         w.provider_company_id, w.provider_reference, evidence.document_id, evidence.document_version_id
    FROM public.warranty_entitlements w
    JOIN public.supplier_po_delivery_execution_events e ON e.id = w.delivery_execution_event_id
    JOIN public.supplier_po_delivery_tranches t ON t.id = e.tranche_id
    LEFT JOIN public.warranty_entitlement_evidence evidence ON evidence.warranty_entitlement_id = w.id
   WHERE w.id = p_entitlement
     AND (NULLIF(current_setting('app.actor_id', true), '') IS NULL OR current_setting('app.actor_id', true) = p_actor::TEXT)
     AND (
       public.internal_has_capability(p_actor, 'warranty.entitlement.read_all')
       OR (
         public.internal_has_capability(p_actor, 'warranty.entitlement.read_assigned')
         AND public.delivery_execution_line_scope_allowed(p_actor, t.supplier_purchase_order_line_id)
       )
     )
$$;

CREATE FUNCTION public.partner_warranty_entitlement_list(p_actor UUID, p_company UUID)
RETURNS TABLE(
  id UUID,
  product_identity_id UUID,
  covered_quantity NUMERIC,
  start_trigger TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT,
  evidence_count INTEGER
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT w.id, w.product_identity_id, w.covered_quantity, w.start_trigger::TEXT,
         w.start_date, w.end_date,
         CASE WHEN w.end_date < CURRENT_DATE THEN 'EXPIRED' ELSE 'ACTIVE' END,
         count(evidence.id)::INTEGER
    FROM public.warranty_entitlements w
    LEFT JOIN public.warranty_entitlement_evidence evidence ON evidence.warranty_entitlement_id = w.id
   WHERE w.partner_company_id = p_company
     AND current_setting('app.tenant_id', true) = p_company::TEXT
     AND current_setting('app.actor_id', true) = p_actor::TEXT
     AND public.partner_delivery_action_capability(p_actor, p_company, 'warranty.entitlement.read')
   GROUP BY w.id
   ORDER BY w.created_at, w.id
$$;

CREATE FUNCTION public.partner_warranty_entitlement_evidence_list(p_actor UUID, p_company UUID, p_entitlement UUID)
RETURNS TABLE(
  document_id UUID,
  document_version_id UUID,
  filename TEXT,
  detected_mime_type TEXT,
  byte_size BIGINT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT d.id, dv.id, d.filename, d.detected_mime_type, d.byte_size
    FROM public.warranty_entitlements w
    JOIN public.warranty_entitlement_evidence evidence ON evidence.warranty_entitlement_id = w.id
    JOIN public.documents d ON d.id = evidence.document_id
    JOIN public.document_versions dv ON dv.id = evidence.document_version_id AND dv.document_id = d.id
   WHERE w.id = p_entitlement
     AND w.partner_company_id = p_company
     AND d.company_id = p_company
     AND d.access_scope = 'TENANT'
     AND current_setting('app.tenant_id', true) = p_company::TEXT
     AND current_setting('app.actor_id', true) = p_actor::TEXT
     AND public.partner_delivery_action_capability(p_actor, p_company, 'warranty.entitlement.read')
$$;

REVOKE ALL ON FUNCTION public.prevent_warranty_entitlement_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_warranty_entitlement_register(UUID,UUID,NUMERIC,public."WarrantyStartTrigger",DATE,UUID,UUID,TEXT,DATE,public."WarrantyProviderType",UUID,TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC, sco_runtime;
REVOKE ALL ON FUNCTION public.internal_warranty_entitlement_get(UUID,UUID) FROM PUBLIC, sco_runtime;
REVOKE ALL ON FUNCTION public.partner_warranty_entitlement_list(UUID,UUID), public.partner_warranty_entitlement_evidence_list(UUID,UUID,UUID) FROM PUBLIC, sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.internal_warranty_entitlement_register(UUID,UUID,NUMERIC,public."WarrantyStartTrigger",DATE,UUID,UUID,TEXT,DATE,public."WarrantyProviderType",UUID,TEXT,UUID,UUID,TEXT,TEXT), public.internal_warranty_entitlement_get(UUID,UUID) TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.partner_warranty_entitlement_list(UUID,UUID), public.partner_warranty_entitlement_evidence_list(UUID,UUID,UUID) TO sco_runtime;