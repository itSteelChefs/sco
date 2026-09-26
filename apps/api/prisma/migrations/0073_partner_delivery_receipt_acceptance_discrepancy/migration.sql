CREATE TABLE public.partner_delivery_receipt_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_company_id UUID NOT NULL REFERENCES public."Company"(id),
  delivery_execution_event_id UUID NOT NULL REFERENCES public.supplier_po_delivery_execution_events(id) ON DELETE RESTRICT,
  received_quantity NUMERIC(18,4) NOT NULL CHECK (received_quantity > 0),
  received_at TIMESTAMPTZ NOT NULL,
  operational_note TEXT CHECK (operational_note IS NULL OR btrim(operational_note) <> ''),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id),
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_delivery_receipt_idempotency_unique UNIQUE (partner_company_id, delivery_execution_event_id, idempotency_key)
);

CREATE TABLE public.partner_delivery_acceptance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_company_id UUID NOT NULL REFERENCES public."Company"(id),
  delivery_execution_event_id UUID NOT NULL REFERENCES public.supplier_po_delivery_execution_events(id) ON DELETE RESTRICT,
  accepted_quantity NUMERIC(18,4) NOT NULL CHECK (accepted_quantity > 0),
  accepted_at TIMESTAMPTZ NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES public."User"(id),
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_delivery_acceptance_idempotency_unique UNIQUE (partner_company_id, delivery_execution_event_id, idempotency_key)
);

CREATE TABLE public.partner_delivery_discrepancy_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_company_id UUID NOT NULL REFERENCES public."Company"(id),
  delivery_execution_event_id UUID NOT NULL REFERENCES public.supplier_po_delivery_execution_events(id) ON DELETE RESTRICT,
  receipt_event_id UUID REFERENCES public.partner_delivery_receipt_events(id) ON DELETE RESTRICT,
  acceptance_event_id UUID REFERENCES public.partner_delivery_acceptance_events(id) ON DELETE RESTRICT,
  discrepancy_quantity NUMERIC(18,4) NOT NULL CHECK (discrepancy_quantity > 0),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('SHORTAGE','DAMAGED','WRONG_PRODUCT','WRONG_QUANTITY','MISSING_SERIAL_OR_DOCUMENT','PARTIAL_REJECTION','OTHER')),
  note TEXT CHECK (note IS NULL OR btrim(note) <> ''),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id),
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_delivery_discrepancy_idempotency_unique UNIQUE (partner_company_id, delivery_execution_event_id, idempotency_key)
);

CREATE INDEX partner_delivery_receipt_event_idx ON public.partner_delivery_receipt_events(delivery_execution_event_id);
CREATE INDEX partner_delivery_acceptance_event_idx ON public.partner_delivery_acceptance_events(delivery_execution_event_id);
CREATE INDEX partner_delivery_discrepancy_event_idx ON public.partner_delivery_discrepancy_events(delivery_execution_event_id);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['partner_delivery_receipt_events','partner_delivery_acceptance_events','partner_delivery_discrepancy_events']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, sco_runtime, sco_internal_executor', table_name);
  END LOOP;
END
$$;

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'delivery.receipt.confirm', 'Confirm receipt for own delivery execution'),
  (gen_random_uuid(), 'delivery.acceptance.confirm', 'Confirm acceptance for own received delivery'),
  (gen_random_uuid(), 'delivery.issue.record', 'Record discrepancy for own delivery execution')
ON CONFLICT (code) DO NOTHING;

CREATE FUNCTION public.partner_delivery_action_capability(p_actor UUID, p_company UUID, p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."User" u
    JOIN public."CompanyMembership" cm ON cm."userId" = u.id
      AND cm."companyId" = p_company
      AND cm.status = 'ACTIVE'
    JOIN public."Company" c ON c.id = cm."companyId"
      AND c.type = 'PARTNER'
      AND c.status = 'ACTIVE'
    JOIN public."MembershipRole" mr ON mr.membership_id = cm.id
    JOIN public."RolePermission" rp ON rp.role_id = mr.role_id
    JOIN public."Permission" permission ON permission.id = rp.permission_id
    WHERE u.id = p_actor
      AND u.status = 'ACTIVE'
      AND permission.code = p_permission
  )
$$;

CREATE FUNCTION public.partner_delivery_execution_owned(p_company UUID, p_event UUID)
RETURNS TABLE(event_id UUID, tranche_id UUID, delivered_quantity NUMERIC)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT e.id, t.id, e.delivered_quantity
    FROM public.supplier_po_delivery_execution_events e
    JOIN public.supplier_po_delivery_tranches t ON t.id = e.tranche_id
    JOIN public.partner_delivery_sites site ON site.id = t.partner_delivery_site_id
   WHERE e.id = p_event
     AND site.company_id = p_company
$$;

CREATE FUNCTION public.prevent_partner_delivery_fact_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PARTNER_DELIVERY_FACT_IMMUTABLE';
END
$$;

CREATE TRIGGER partner_delivery_receipt_immutable
  BEFORE UPDATE OR DELETE ON public.partner_delivery_receipt_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_partner_delivery_fact_mutation();
CREATE TRIGGER partner_delivery_acceptance_immutable
  BEFORE UPDATE OR DELETE ON public.partner_delivery_acceptance_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_partner_delivery_fact_mutation();
CREATE TRIGGER partner_delivery_discrepancy_immutable
  BEFORE UPDATE OR DELETE ON public.partner_delivery_discrepancy_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_partner_delivery_fact_mutation();

CREATE FUNCTION public.partner_delivery_receipt_confirm(
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
  SELECT * INTO v_delivery FROM public.partner_delivery_execution_owned(p_company, p_delivery_event) FOR UPDATE;
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

CREATE FUNCTION public.partner_delivery_acceptance_confirm(
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
  SELECT * INTO v_delivery FROM public.partner_delivery_execution_owned(p_company, p_delivery_event) FOR UPDATE;
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

CREATE FUNCTION public.partner_delivery_discrepancy_record(
  p_actor UUID,
  p_company UUID,
  p_delivery_event UUID,
  p_receipt_event UUID,
  p_acceptance_event UUID,
  p_quantity NUMERIC,
  p_reason TEXT,
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
  v_id UUID;
  v_key TEXT := btrim(COALESCE(p_idempotency_key, ''));
  v_note TEXT := NULLIF(btrim(p_note), '');
BEGIN
  IF current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::TEXT
     OR current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::TEXT
     OR NOT public.partner_delivery_action_capability(p_actor, p_company, 'delivery.issue.record') THEN
    RAISE EXCEPTION 'PARTNER_DELIVERY_FORBIDDEN';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity <> round(p_quantity, 4)
     OR p_reason NOT IN ('SHORTAGE','DAMAGED','WRONG_PRODUCT','WRONG_QUANTITY','MISSING_SERIAL_OR_DOCUMENT','PARTIAL_REJECTION','OTHER')
     OR v_key = '' THEN
    RAISE EXCEPTION 'PARTNER_DELIVERY_DISCREPANCY_INVALID';
  END IF;
  SELECT * INTO v_delivery FROM public.partner_delivery_execution_owned(p_company, p_delivery_event) FOR UPDATE;
  IF NOT FOUND OR p_quantity > v_delivery.delivered_quantity THEN RAISE EXCEPTION 'PARTNER_DELIVERY_FORBIDDEN'; END IF;
  IF p_receipt_event IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.partner_delivery_receipt_events WHERE id=p_receipt_event AND partner_company_id=p_company AND delivery_execution_event_id=p_delivery_event) THEN RAISE EXCEPTION 'PARTNER_DELIVERY_FORBIDDEN'; END IF;
  IF p_acceptance_event IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.partner_delivery_acceptance_events WHERE id=p_acceptance_event AND partner_company_id=p_company AND delivery_execution_event_id=p_delivery_event) THEN RAISE EXCEPTION 'PARTNER_DELIVERY_FORBIDDEN'; END IF;
  SELECT id,discrepancy_quantity,reason_code,note,receipt_event_id,acceptance_event_id INTO v_existing FROM public.partner_delivery_discrepancy_events WHERE partner_company_id=p_company AND delivery_execution_event_id=p_delivery_event AND idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing.discrepancy_quantity IS DISTINCT FROM p_quantity OR v_existing.reason_code IS DISTINCT FROM p_reason OR v_existing.note IS DISTINCT FROM v_note OR v_existing.receipt_event_id IS DISTINCT FROM p_receipt_event OR v_existing.acceptance_event_id IS DISTINCT FROM p_acceptance_event THEN
      RAISE EXCEPTION 'PARTNER_DELIVERY_DISCREPANCY_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_existing.id;
  END IF;
  INSERT INTO public.partner_delivery_discrepancy_events(partner_company_id,delivery_execution_event_id,receipt_event_id,acceptance_event_id,discrepancy_quantity,reason_code,note,actor_user_id,idempotency_key,correlation_id)
  VALUES(p_company,p_delivery_event,p_receipt_event,p_acceptance_event,p_quantity,p_reason,v_note,p_actor,v_key,NULLIF(p_correlation,'')::UUID)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(company_id,actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id)
  VALUES(p_company,p_actor,'TENANT','delivery.discrepancy.recorded','PartnerDeliveryDiscrepancy',v_id,jsonb_build_object('deliveryEventId',p_delivery_event,'quantity',p_quantity,'reasonCode',p_reason,'idempotencyKey',v_key,'outcome','RECORDED'),NULLIF(p_correlation,'')::UUID);
  RETURN v_id;
END
$$;

DROP FUNCTION public.partner_delivery_projection_list(UUID, UUID, UUID);
CREATE FUNCTION public.partner_delivery_projection_list(p_actor UUID, p_company UUID, p_commitment UUID DEFAULT NULL)
RETURNS TABLE(
  commercial_commitment_id UUID,
  commercial_commitment_line_id UUID,
  product_identity_id UUID,
  product_description TEXT,
  committed_quantity NUMERIC,
  tranche_id UUID,
  tranche_quantity NUMERIC,
  supplier_confirmed_quantity NUMERIC,
  original_promised_date DATE,
  current_expected_date DATE,
  site_label TEXT,
  location_details JSONB,
  tranche_status TEXT,
  date_changed BOOLEAN,
  delivered_quantity NUMERIC,
  received_quantity NUMERIC,
  accepted_quantity NUMERIC,
  remaining_to_receive NUMERIC,
  remaining_to_accept NUMERIC,
  discrepancy_quantity NUMERIC,
  discrepancy_status TEXT,
  latest_delivered_at TIMESTAMPTZ,
  latest_received_at TIMESTAMPTZ,
  latest_accepted_at TIMESTAMPTZ
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT cc.id,ccl.id,ccl.product_identity_id,ccl.product_description,ccl.quantity,
         t.id,t.quantity,LEAST(confirmation.confirmed_quantity_delta,a.allocated_quantity),
         confirmation.promised_delivery_date,COALESCE(changed.new_date,confirmation.promised_delivery_date),
         site.operational_label,site.location_details,t.status::TEXT,(changed.id IS NOT NULL),
         COALESCE(progress.delivered_quantity,0),COALESCE(progress.received_quantity,0),COALESCE(progress.accepted_quantity,0),
         COALESCE(progress.delivered_quantity,0)-COALESCE(progress.received_quantity,0),
         COALESCE(progress.received_quantity,0)-COALESCE(progress.accepted_quantity,0),
         COALESCE(progress.discrepancy_quantity,0),
         CASE WHEN COALESCE(progress.discrepancy_quantity,0)>0 THEN 'HAS_DISCREPANCY' ELSE 'NONE' END,
         progress.latest_delivered_at,progress.latest_received_at,progress.latest_accepted_at
    FROM public.supplier_po_delivery_tranches t
    JOIN public.supplier_po_release_line_allocations a ON a.id=t.supplier_po_release_line_allocation_id
    JOIN public.procurement_release_lines rl ON rl.id=a.procurement_release_line_id
    JOIN public.procurement_releases pr ON pr.id=rl.release_id
    JOIN public.commercial_commitments cc ON cc.id=pr.commercial_commitment_id AND cc.partner_company_id=p_company
    JOIN public.commercial_commitment_lines ccl ON ccl.id=rl.commercial_commitment_line_id AND ccl.commercial_commitment_id=cc.id
    JOIN public.supplier_po_line_confirmation_events confirmation ON confirmation.id=t.supplier_po_line_confirmation_event_id
    JOIN public.partner_delivery_sites site ON site.id=t.partner_delivery_site_id AND site.company_id=p_company
    LEFT JOIN LATERAL (SELECT c.id,c.new_date FROM public.supplier_po_delivery_tranche_change_events c WHERE c.tranche_id=t.id ORDER BY c.created_at DESC,c.id DESC LIMIT 1) changed ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(e.delivered_quantity),0) delivered_quantity,
             COALESCE((SELECT sum(r.received_quantity) FROM public.partner_delivery_receipt_events r JOIN public.supplier_po_delivery_execution_events re ON re.id=r.delivery_execution_event_id WHERE re.tranche_id=t.id AND r.partner_company_id=p_company),0) received_quantity,
             COALESCE((SELECT sum(ac.accepted_quantity) FROM public.partner_delivery_acceptance_events ac JOIN public.supplier_po_delivery_execution_events ae ON ae.id=ac.delivery_execution_event_id WHERE ae.tranche_id=t.id AND ac.partner_company_id=p_company),0) accepted_quantity,
             COALESCE((SELECT sum(d.discrepancy_quantity) FROM public.partner_delivery_discrepancy_events d JOIN public.supplier_po_delivery_execution_events de ON de.id=d.delivery_execution_event_id WHERE de.tranche_id=t.id AND d.partner_company_id=p_company),0) discrepancy_quantity,
             max(e.delivered_at) latest_delivered_at,
             (SELECT max(r.received_at) FROM public.partner_delivery_receipt_events r JOIN public.supplier_po_delivery_execution_events re ON re.id=r.delivery_execution_event_id WHERE re.tranche_id=t.id AND r.partner_company_id=p_company) latest_received_at,
             (SELECT max(ac.accepted_at) FROM public.partner_delivery_acceptance_events ac JOIN public.supplier_po_delivery_execution_events ae ON ae.id=ac.delivery_execution_event_id WHERE ae.tranche_id=t.id AND ac.partner_company_id=p_company) latest_accepted_at
        FROM public.supplier_po_delivery_execution_events e WHERE e.tranche_id=t.id
    ) progress ON true
   WHERE current_setting('app.tenant_id',true)=p_company::TEXT
     AND current_setting('app.actor_id',true)=p_actor::TEXT
     AND public.partner_delivery_projection_capability(p_actor,p_company)
     AND (p_commitment IS NULL OR cc.id=p_commitment)
   ORDER BY t.created_at,t.id
$$;

REVOKE ALL ON FUNCTION public.partner_delivery_action_capability(UUID,UUID,TEXT),public.partner_delivery_execution_owned(UUID,UUID) FROM PUBLIC,sco_runtime,sco_internal_executor;
REVOKE ALL ON FUNCTION public.prevent_partner_delivery_fact_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_delivery_receipt_confirm(UUID,UUID,UUID,NUMERIC,TIMESTAMPTZ,TEXT,TEXT,TEXT),public.partner_delivery_acceptance_confirm(UUID,UUID,UUID,NUMERIC,TIMESTAMPTZ,TEXT,TEXT),public.partner_delivery_discrepancy_record(UUID,UUID,UUID,UUID,UUID,NUMERIC,TEXT,TEXT,TEXT,TEXT),public.partner_delivery_projection_list(UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_delivery_receipt_confirm(UUID,UUID,UUID,NUMERIC,TIMESTAMPTZ,TEXT,TEXT,TEXT),public.partner_delivery_acceptance_confirm(UUID,UUID,UUID,NUMERIC,TIMESTAMPTZ,TEXT,TEXT),public.partner_delivery_discrepancy_record(UUID,UUID,UUID,UUID,UUID,NUMERIC,TEXT,TEXT,TEXT,TEXT),public.partner_delivery_projection_list(UUID,UUID,UUID) TO sco_runtime;