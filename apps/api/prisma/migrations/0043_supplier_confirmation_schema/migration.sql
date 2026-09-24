CREATE TABLE supplier_po_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_purchase_order_id UUID NOT NULL REFERENCES supplier_purchase_orders(id),
  created_by UUID NOT NULL REFERENCES "User"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(supplier_purchase_order_id)
);

CREATE TABLE supplier_po_line_confirmation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_po_confirmation_id UUID NOT NULL REFERENCES supplier_po_confirmations(id),
  supplier_purchase_order_line_id UUID NOT NULL REFERENCES supplier_purchase_order_lines(id),
  confirmed_quantity_delta NUMERIC(18,4) NOT NULL CHECK (confirmed_quantity_delta > 0),
  promised_delivery_date DATE NOT NULL,
  supplier_reference TEXT,
  operational_note TEXT,
  actor_user_id UUID NOT NULL REFERENCES "User"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID
);

CREATE TABLE supplier_po_delivery_date_change_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_purchase_order_line_id UUID NOT NULL REFERENCES supplier_purchase_order_lines(id),
  previous_date DATE NOT NULL,
  new_date DATE NOT NULL,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  actor_user_id UUID NOT NULL REFERENCES "User"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID
);

CREATE TABLE supplier_po_reference_correction_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_purchase_order_line_id UUID NOT NULL REFERENCES supplier_purchase_order_lines(id),
  previous_reference TEXT NOT NULL,
  corrected_reference TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  actor_user_id UUID NOT NULL REFERENCES "User"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID
);

CREATE INDEX supplier_po_confirmation_events_line_idx ON supplier_po_line_confirmation_events(supplier_purchase_order_line_id, created_at);
CREATE INDEX supplier_po_date_change_events_line_idx ON supplier_po_delivery_date_change_events(supplier_purchase_order_line_id, created_at);
CREATE INDEX supplier_po_reference_correction_events_line_idx ON supplier_po_reference_correction_events(supplier_purchase_order_line_id, created_at);

INSERT INTO "Permission"(id,code,description)
SELECT gen_random_uuid(),v.code,v.description
FROM (VALUES
 ('supplier_po.confirm.read','Read scoped supplier confirmations'),
 ('supplier_po.confirm.record','Record supplier confirmation deltas'),
 ('supplier_po.confirm.date_change','Record promised delivery date changes'),
 ('supplier_po.confirm.reference_correct','Record supplier reference corrections')
) v(code,description)
WHERE NOT EXISTS (SELECT 1 FROM "Permission" p WHERE p.code=v.code);

CREATE OR REPLACE FUNCTION public.prevent_supplier_po_confirmation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('app.supplier_po_confirmation_gateway',true),'') <> 'true' THEN
    RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_HISTORY_IMMUTABLE';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE TRIGGER supplier_po_confirmations_immutable BEFORE UPDATE OR DELETE ON supplier_po_confirmations FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_po_confirmation_mutation();
CREATE TRIGGER supplier_po_confirmation_events_immutable BEFORE UPDATE OR DELETE ON supplier_po_line_confirmation_events FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_po_confirmation_mutation();
CREATE TRIGGER supplier_po_date_change_events_immutable BEFORE UPDATE OR DELETE ON supplier_po_delivery_date_change_events FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_po_confirmation_mutation();
CREATE TRIGGER supplier_po_reference_correction_events_immutable BEFORE UPDATE OR DELETE ON supplier_po_reference_correction_events FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_po_confirmation_mutation();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_po_confirmations','supplier_po_line_confirmation_events','supplier_po_delivery_date_change_events','supplier_po_reference_correction_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON %I FROM sco_runtime,sco_internal_executor',t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.internal_supplier_po_confirmation_record(p_actor uuid,p_line uuid,p_quantity numeric,p_promised_date date,p_reference text,p_note text,p_correlation text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_po uuid; v_source uuid; v_category uuid; v_header uuid; v_used numeric; v_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity<=0 OR p_promised_date IS NULL THEN RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_INVALID'; END IF;
  IF NOT public.internal_has_capability(p_actor,'supplier_po.confirm.record') THEN RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_FORBIDDEN'; END IF;
  SELECT p.id,p.purchase_source_id,pi.category_id INTO v_po,v_source,v_category
  FROM supplier_purchase_order_lines l JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id JOIN product_identities pi ON pi.id=l.product_identity_id
  WHERE l.id=p_line FOR UPDATE;
  IF v_po IS NULL THEN RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_NOT_FOUND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM supplier_purchase_orders WHERE id=v_po AND status='ISSUED') THEN RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_PO_NOT_ISSUED'; END IF;
  IF NOT (EXISTS(SELECT 1 FROM procurement_engineer_scope_assignments s WHERE s.actor_user_id=p_actor AND s.purchase_source_id=v_source AND s.product_category_id=v_category AND s.status='ACTIVE') OR EXISTS(SELECT 1 FROM supplier_po_line_responsibilities r WHERE r.supplier_purchase_order_line_id=p_line AND r.actor_user_id=p_actor) OR public.internal_has_capability(p_actor,'supplier_po.confirm.read_all')) THEN RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_SCOPE_REQUIRED'; END IF;
  SELECT COALESCE(sum(confirmed_quantity_delta),0) INTO v_used FROM supplier_po_line_confirmation_events WHERE supplier_purchase_order_line_id=p_line;
  IF v_used+p_quantity > (SELECT ordered_quantity FROM supplier_purchase_order_lines WHERE id=p_line) THEN RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_QUANTITY_EXCEEDED'; END IF;
  SELECT id INTO v_header FROM supplier_po_confirmations WHERE supplier_purchase_order_id=v_po;
  IF v_header IS NULL THEN INSERT INTO supplier_po_confirmations(supplier_purchase_order_id,created_by) VALUES(v_po,p_actor) RETURNING id INTO v_header; END IF;
  PERFORM set_config('app.supplier_po_confirmation_gateway','true',true);
  INSERT INTO supplier_po_line_confirmation_events(supplier_po_confirmation_id,supplier_purchase_order_line_id,confirmed_quantity_delta,promised_delivery_date,supplier_reference,operational_note,actor_user_id,correlation_id) VALUES(v_header,p_line,p_quantity,p_promised_date,NULLIF(btrim(p_reference),''),NULLIF(btrim(p_note),''),p_actor,NULLIF(p_correlation,'')::uuid) RETURNING id INTO v_id;
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.confirmation.recorded','SupplierPurchaseOrderLine',p_line,jsonb_build_object('quantityDelta',p_quantity,'promisedDeliveryDate',p_promised_date,'supplierReference',p_reference),NULLIF(p_correlation,'')::uuid);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_supplier_po_confirmation_line_get(p_actor uuid,p_line uuid)
RETURNS TABLE(confirmed_quantity numeric,remaining_quantity numeric,status text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT COALESCE(sum(e.confirmed_quantity_delta),0), l.ordered_quantity-COALESCE(sum(e.confirmed_quantity_delta),0), CASE WHEN COALESCE(sum(e.confirmed_quantity_delta),0)=0 THEN 'NOT_CONFIRMED' WHEN COALESCE(sum(e.confirmed_quantity_delta),0)<l.ordered_quantity THEN 'PARTIALLY_CONFIRMED' ELSE 'CONFIRMED' END
  FROM supplier_purchase_order_lines l LEFT JOIN supplier_po_line_confirmation_events e ON e.supplier_purchase_order_line_id=l.id
  WHERE l.id=p_line AND (public.internal_has_capability(p_actor,'supplier_po.confirm.read') OR public.internal_has_capability(p_actor,'supplier_po.confirm.record'))
  GROUP BY l.ordered_quantity
$$;

CREATE OR REPLACE FUNCTION public.internal_supplier_po_confirmation_date_change(p_actor uuid,p_line uuid,p_previous date,p_new date,p_reason text,p_correlation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_source uuid; v_category uuid;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'supplier_po.confirm.date_change') THEN RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_DATE_FORBIDDEN'; END IF;
  SELECT p.purchase_source_id,pi.category_id INTO v_source,v_category FROM supplier_purchase_order_lines l JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id JOIN product_identities pi ON pi.id=l.product_identity_id WHERE l.id=p_line;
  IF v_source IS NULL OR NOT (EXISTS(SELECT 1 FROM procurement_engineer_scope_assignments s WHERE s.actor_user_id=p_actor AND s.purchase_source_id=v_source AND s.product_category_id=v_category AND s.status='ACTIVE') OR EXISTS(SELECT 1 FROM supplier_po_line_responsibilities r WHERE r.supplier_purchase_order_line_id=p_line AND r.actor_user_id=p_actor)) THEN RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_SCOPE_REQUIRED'; END IF;
  PERFORM set_config('app.supplier_po_confirmation_gateway','true',true);
  INSERT INTO supplier_po_delivery_date_change_events(supplier_purchase_order_line_id,previous_date,new_date,reason,actor_user_id,correlation_id) VALUES(p_line,p_previous,p_new,btrim(p_reason),p_actor,NULLIF(p_correlation,'')::uuid);
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.confirmation.date_changed','SupplierPurchaseOrderLine',p_line,jsonb_build_object('previousDate',p_previous,'newDate',p_new,'reason',p_reason),NULLIF(p_correlation,'')::uuid);
END $$;

CREATE OR REPLACE FUNCTION public.internal_supplier_po_confirmation_reference_correct(p_actor uuid,p_line uuid,p_previous text,p_corrected text,p_reason text,p_correlation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_source uuid; v_category uuid;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'supplier_po.confirm.reference_correct') THEN RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_REFERENCE_FORBIDDEN'; END IF;
  SELECT p.purchase_source_id,pi.category_id INTO v_source,v_category FROM supplier_purchase_order_lines l JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id JOIN product_identities pi ON pi.id=l.product_identity_id WHERE l.id=p_line;
  IF v_source IS NULL OR NOT (EXISTS(SELECT 1 FROM procurement_engineer_scope_assignments s WHERE s.actor_user_id=p_actor AND s.purchase_source_id=v_source AND s.product_category_id=v_category AND s.status='ACTIVE') OR EXISTS(SELECT 1 FROM supplier_po_line_responsibilities r WHERE r.supplier_purchase_order_line_id=p_line AND r.actor_user_id=p_actor)) THEN RAISE EXCEPTION 'SUPPLIER_PO_CONFIRMATION_SCOPE_REQUIRED'; END IF;
  PERFORM set_config('app.supplier_po_confirmation_gateway','true',true);
  INSERT INTO supplier_po_reference_correction_events(supplier_purchase_order_line_id,previous_reference,corrected_reference,reason,actor_user_id,correlation_id) VALUES(p_line,btrim(p_previous),btrim(p_corrected),btrim(p_reason),p_actor,NULLIF(p_correlation,'')::uuid);
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.confirmation.reference_corrected','SupplierPurchaseOrderLine',p_line,jsonb_build_object('previousReference',p_previous,'correctedReference',p_corrected,'reason',p_reason),NULLIF(p_correlation,'')::uuid);
END $$;

REVOKE ALL ON FUNCTION public.internal_supplier_po_confirmation_record(uuid,uuid,numeric,date,text,text,text), public.internal_supplier_po_confirmation_line_get(uuid,uuid), public.internal_supplier_po_confirmation_date_change(uuid,uuid,date,date,text,text), public.internal_supplier_po_confirmation_reference_correct(uuid,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_po_confirmation_record(uuid,uuid,numeric,date,text,text,text), public.internal_supplier_po_confirmation_line_get(uuid,uuid), public.internal_supplier_po_confirmation_date_change(uuid,uuid,date,date,text,text), public.internal_supplier_po_confirmation_reference_correct(uuid,uuid,text,text,text,text) TO sco_internal_executor;
