CREATE TYPE "SupplierPurchaseOrderStatus" AS ENUM ('DRAFT','ISSUED');
CREATE TYPE "SupplierPODemandOrigin" AS ENUM ('RELEASED_DEMAND','STRATEGIC_OVERBUY');

CREATE TABLE supplier_purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_source_id UUID NOT NULL REFERENCES purchase_sources(id),
  supplier_company_id UUID NOT NULL REFERENCES "Company"(id),
  currency_code TEXT NOT NULL,
  status "SupplierPurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  lead_procurement_engineer_id UUID REFERENCES "User"(id),
  created_by UUID NOT NULL REFERENCES "User"(id),
  issued_by UUID REFERENCES "User"(id),
  issued_at TIMESTAMPTZ,
  total_actual_purchase_cost NUMERIC(18,6),
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status='DRAFT' AND issued_by IS NULL AND issued_at IS NULL) OR (status='ISSUED' AND issued_by IS NOT NULL AND issued_at IS NOT NULL))
);

CREATE TABLE strategic_overbuy_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_source_id UUID NOT NULL REFERENCES purchase_sources(id),
  product_identity_id UUID NOT NULL REFERENCES product_identities(id),
  unit_id UUID NOT NULL REFERENCES unit_definitions(id),
  authorized_quantity NUMERIC(18,4) NOT NULL CHECK(authorized_quantity>0),
  currency_code TEXT NOT NULL,
  max_unit_purchase_cost NUMERIC(18,6) NOT NULL CHECK(max_unit_purchase_cost>=0),
  reason TEXT NOT NULL CHECK(btrim(reason)<>''),
  authorized_by UUID NOT NULL REFERENCES "User"(id),
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID
);

CREATE TABLE supplier_purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_purchase_order_id UUID NOT NULL REFERENCES supplier_purchase_orders(id),
  demand_origin "SupplierPODemandOrigin" NOT NULL,
  product_identity_id UUID NOT NULL REFERENCES product_identities(id),
  unit_id UUID NOT NULL REFERENCES unit_definitions(id),
  ordered_quantity NUMERIC(18,4) NOT NULL CHECK(ordered_quantity>0),
  actual_unit_purchase_cost NUMERIC(18,6) NOT NULL CHECK(actual_unit_purchase_cost>=0),
  currency_code TEXT NOT NULL,
  supplier_reconfirmation_id UUID REFERENCES supplier_reconfirmations(id),
  strategic_overbuy_authorization_id UUID REFERENCES strategic_overbuy_authorizations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((demand_origin='RELEASED_DEMAND' AND strategic_overbuy_authorization_id IS NULL) OR (demand_origin='STRATEGIC_OVERBUY' AND strategic_overbuy_authorization_id IS NOT NULL))
);

CREATE TABLE supplier_po_release_line_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_purchase_order_line_id UUID NOT NULL REFERENCES supplier_purchase_order_lines(id),
  procurement_release_line_id UUID NOT NULL REFERENCES procurement_release_lines(id),
  allocated_quantity NUMERIC(18,4) NOT NULL CHECK(allocated_quantity>0),
  approved_purchase_cost_snapshot_id UUID NOT NULL REFERENCES approved_purchase_cost_snapshots(id),
  original_purchase_source_id UUID NOT NULL REFERENCES purchase_sources(id),
  approved_unit_purchase_cost NUMERIC(18,6) NOT NULL CHECK(approved_unit_purchase_cost>=0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(supplier_purchase_order_line_id, procurement_release_line_id)
);

CREATE TABLE supplier_po_coverage_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_po_release_line_allocation_id UUID NOT NULL REFERENCES supplier_po_release_line_allocations(id),
  procurement_funding_allocation_id UUID NOT NULL REFERENCES procurement_funding_allocations(id),
  bound_amount NUMERIC(18,6) NOT NULL CHECK(bound_amount>0),
  currency_code TEXT NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(supplier_po_release_line_allocation_id, procurement_funding_allocation_id)
);

CREATE TABLE procurement_engineer_scope_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES "User"(id),
  purchase_source_id UUID NOT NULL REFERENCES purchase_sources(id),
  product_category_id UUID NOT NULL REFERENCES product_categories(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
  assigned_by UUID NOT NULL REFERENCES "User"(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID,
  UNIQUE(actor_user_id,purchase_source_id,product_category_id)
);

CREATE TABLE supplier_po_line_responsibilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_purchase_order_line_id UUID NOT NULL REFERENCES supplier_purchase_order_lines(id),
  actor_user_id UUID NOT NULL REFERENCES "User"(id),
  assigned_by UUID NOT NULL REFERENCES "User"(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(supplier_purchase_order_line_id,actor_user_id)
);

CREATE TABLE purchase_source_preferences (
  purchase_source_id UUID PRIMARY KEY REFERENCES purchase_sources(id),
  is_preferred BOOLEAN NOT NULL,
  changed_by UUID NOT NULL REFERENCES "User"(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL CHECK(btrim(reason)<>''),
  correlation_id UUID
);

CREATE TABLE supplier_po_financial_authorities (
  actor_user_id UUID PRIMARY KEY REFERENCES "User"(id),
  max_issue_amount_sar NUMERIC(18,6) NOT NULL CHECK(max_issue_amount_sar>=0),
  active BOOLEAN NOT NULL DEFAULT true,
  changed_by UUID NOT NULL REFERENCES "User"(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID
);

CREATE INDEX supplier_po_lines_po_idx ON supplier_purchase_order_lines(supplier_purchase_order_id);
CREATE INDEX supplier_po_release_allocations_release_line_idx ON supplier_po_release_line_allocations(procurement_release_line_id);
CREATE INDEX supplier_po_coverage_bindings_funding_idx ON supplier_po_coverage_bindings(procurement_funding_allocation_id);
CREATE INDEX procurement_engineer_scope_visibility_idx ON procurement_engineer_scope_assignments(actor_user_id,purchase_source_id,product_category_id) WHERE status='ACTIVE';

INSERT INTO "Permission"(id,code,description) VALUES
  (gen_random_uuid(),'supplier_po.read_all','Read all SCO supplier purchase orders'),
  (gen_random_uuid(),'supplier_po.read_assigned','Read supplier purchase orders in assigned scopes'),
  (gen_random_uuid(),'supplier_po.draft.create','Create SCO supplier PO drafts'),
  (gen_random_uuid(),'supplier_po.issue','Issue SCO supplier purchase orders'),
  (gen_random_uuid(),'supplier_po.financial_authority.manage','Manage SAR supplier PO financial authority'),
  (gen_random_uuid(),'purchase_source.preference.manage','Manage strategic purchase source preference'),
  (gen_random_uuid(),'procurement_engineer.scope.manage','Manage procurement engineer source/category scopes'),
  (gen_random_uuid(),'supplier_po.lead.manage','Assign Supplier PO lead and line responsibilities'),
  (gen_random_uuid(),'strategic_overbuy.authorize','Authorize SCO strategic overbuy')
ON CONFLICT(code) DO NOTHING;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_purchase_orders','supplier_purchase_order_lines','supplier_po_release_line_allocations','supplier_po_coverage_bindings','strategic_overbuy_authorizations','procurement_engineer_scope_assignments','supplier_po_line_responsibilities','purchase_source_preferences','supplier_po_financial_authorities'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM sco_runtime,sco_internal_executor',t);
  END LOOP;
END $$;

CREATE FUNCTION public.prevent_supplier_po_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('app.supplier_po_gateway',true),'')<>'true' THEN
    RAISE EXCEPTION 'SUPPLIER_PO_HISTORY_IMMUTABLE';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER supplier_purchase_orders_immutable BEFORE UPDATE OR DELETE ON supplier_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_po_mutation();
CREATE TRIGGER supplier_purchase_order_lines_immutable BEFORE UPDATE OR DELETE ON supplier_purchase_order_lines FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_po_mutation();
CREATE TRIGGER supplier_po_release_allocations_immutable BEFORE UPDATE OR DELETE ON supplier_po_release_line_allocations FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_po_mutation();
CREATE TRIGGER supplier_po_coverage_bindings_immutable BEFORE UPDATE OR DELETE ON supplier_po_coverage_bindings FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_po_mutation();
CREATE TRIGGER strategic_overbuy_authorizations_immutable BEFORE UPDATE OR DELETE ON strategic_overbuy_authorizations FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_po_mutation();

CREATE FUNCTION public.internal_supplier_po_financial_authority_set(p_actor uuid,p_target uuid,p_limit numeric,p_correlation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor,'supplier_po.financial_authority.manage') THEN RAISE EXCEPTION 'SUPPLIER_PO_FINANCIAL_AUTHORITY_FORBIDDEN'; END IF;
  IF p_limit IS NULL OR p_limit<0 THEN RAISE EXCEPTION 'SUPPLIER_PO_FINANCIAL_LIMIT_INVALID'; END IF;
  PERFORM set_config('app.supplier_po_gateway','true',true);
  INSERT INTO supplier_po_financial_authorities(actor_user_id,max_issue_amount_sar,changed_by,correlation_id) VALUES(p_target,p_limit,p_actor,NULLIF(p_correlation,'')::uuid)
  ON CONFLICT(actor_user_id) DO UPDATE SET max_issue_amount_sar=EXCLUDED.max_issue_amount_sar,active=true,changed_by=EXCLUDED.changed_by,changed_at=now(),correlation_id=EXCLUDED.correlation_id;
END $$;

CREATE FUNCTION public.internal_purchase_source_preference_set(p_actor uuid,p_source uuid,p_preferred boolean,p_reason text,p_correlation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor,'purchase_source.preference.manage') THEN RAISE EXCEPTION 'PURCHASE_SOURCE_PREFERENCE_FORBIDDEN'; END IF;
  IF btrim(COALESCE(p_reason,''))='' OR NOT EXISTS(SELECT 1 FROM purchase_sources WHERE id=p_source) THEN RAISE EXCEPTION 'PURCHASE_SOURCE_PREFERENCE_INVALID'; END IF;
  PERFORM set_config('app.supplier_po_gateway','true',true);
  INSERT INTO purchase_source_preferences(purchase_source_id,is_preferred,changed_by,reason,correlation_id) VALUES(p_source,p_preferred,p_actor,p_reason,NULLIF(p_correlation,'')::uuid)
  ON CONFLICT(purchase_source_id) DO UPDATE SET is_preferred=EXCLUDED.is_preferred,changed_by=EXCLUDED.changed_by,changed_at=now(),reason=EXCLUDED.reason,correlation_id=EXCLUDED.correlation_id;
END $$;

CREATE FUNCTION public.internal_procurement_engineer_scope_set(p_actor uuid,p_engineer uuid,p_source uuid,p_category uuid,p_active boolean,p_correlation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor,'procurement_engineer.scope.manage') THEN RAISE EXCEPTION 'PROCUREMENT_ENGINEER_SCOPE_FORBIDDEN'; END IF;
  IF NOT EXISTS(SELECT 1 FROM purchase_sources WHERE id=p_source) OR NOT EXISTS(SELECT 1 FROM product_categories WHERE id=p_category) THEN RAISE EXCEPTION 'PROCUREMENT_ENGINEER_SCOPE_INVALID'; END IF;
  INSERT INTO procurement_engineer_scope_assignments(actor_user_id,purchase_source_id,product_category_id,status,assigned_by,correlation_id) VALUES(p_engineer,p_source,p_category,CASE WHEN p_active THEN 'ACTIVE' ELSE 'REVOKED' END,p_actor,NULLIF(p_correlation,'')::uuid)
  ON CONFLICT(actor_user_id,purchase_source_id,product_category_id) DO UPDATE SET status=EXCLUDED.status,assigned_by=EXCLUDED.assigned_by,assigned_at=now(),correlation_id=EXCLUDED.correlation_id;
END $$;

CREATE FUNCTION public.internal_strategic_overbuy_authorize(p_actor uuid,p_source uuid,p_product uuid,p_unit uuid,p_quantity numeric,p_currency text,p_max_price numeric,p_reason text,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid:=gen_random_uuid();
BEGIN
  IF NOT public.internal_has_capability(p_actor,'strategic_overbuy.authorize') THEN RAISE EXCEPTION 'STRATEGIC_OVERBUY_FORBIDDEN'; END IF;
  IF p_quantity IS NULL OR p_quantity<=0 OR p_max_price IS NULL OR p_max_price<0 OR btrim(COALESCE(p_reason,''))='' THEN RAISE EXCEPTION 'STRATEGIC_OVERBUY_INVALID'; END IF;
  IF NOT EXISTS(SELECT 1 FROM purchase_sources s WHERE s.id=p_source AND s.status='ACTIVE') THEN RAISE EXCEPTION 'PURCHASE_SOURCE_NOT_USABLE'; END IF;
  PERFORM set_config('app.supplier_po_gateway','true',true);
  INSERT INTO strategic_overbuy_authorizations(id,purchase_source_id,product_identity_id,unit_id,authorized_quantity,currency_code,max_unit_purchase_cost,reason,authorized_by,correlation_id) VALUES(v_id,p_source,p_product,p_unit,p_quantity,p_currency,p_max_price,p_reason,p_actor,NULLIF(p_correlation,'')::uuid);
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','strategic_overbuy.authorized','StrategicOverbuyAuthorization',v_id,jsonb_build_object('purchaseSourceId',p_source,'productIdentityId',p_product,'quantity',p_quantity),NULLIF(p_correlation,'')::uuid);
  RETURN v_id;
END $$;

CREATE FUNCTION public.internal_supplier_po_draft_create(p_actor uuid,p_source uuid,p_currency text,p_lines jsonb,p_lead uuid,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_po uuid:=gen_random_uuid(); v_supplier uuid; v_line jsonb; v_line_id uuid; v_release jsonb; v_qty numeric; v_sum numeric; v_release_line record; v_strategic record;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'supplier_po.draft.create') THEN RAISE EXCEPTION 'SUPPLIER_PO_DRAFT_FORBIDDEN'; END IF;
  IF p_lines IS NULL OR jsonb_array_length(p_lines)=0 THEN RAISE EXCEPTION 'SUPPLIER_PO_LINES_REQUIRED'; END IF;
  SELECT supplier_company_id INTO v_supplier FROM purchase_sources WHERE id=p_source;
  IF v_supplier IS NULL THEN RAISE EXCEPTION 'SUPPLIER_PO_SOURCE_INVALID'; END IF;
  PERFORM set_config('app.supplier_po_gateway','true',true);
  INSERT INTO supplier_purchase_orders(id,purchase_source_id,supplier_company_id,currency_code,lead_procurement_engineer_id,created_by,correlation_id) VALUES(v_po,p_source,v_supplier,p_currency,p_lead,p_actor,NULLIF(p_correlation,'')::uuid);
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty:=(v_line->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty<=0 OR (v_line->>'actualUnitPurchaseCost')::numeric<0 THEN RAISE EXCEPTION 'SUPPLIER_PO_LINE_INVALID'; END IF;
    v_line_id:=gen_random_uuid();
    IF COALESCE(v_line->>'demandOrigin','RELEASED_DEMAND')='RELEASED_DEMAND' THEN
      SELECT COALESCE(sum((x->>'quantity')::numeric),0) INTO v_sum FROM jsonb_array_elements(COALESCE(v_line->'releaseAllocations','[]'::jsonb)) x;
      IF v_sum<>v_qty OR v_sum<=0 THEN RAISE EXCEPTION 'SUPPLIER_PO_LINE_INVALID'; END IF;
      INSERT INTO supplier_purchase_order_lines(id,supplier_purchase_order_id,demand_origin,product_identity_id,unit_id,ordered_quantity,actual_unit_purchase_cost,currency_code,supplier_reconfirmation_id) VALUES(v_line_id,v_po,'RELEASED_DEMAND',(v_line->>'productIdentityId')::uuid,(v_line->>'unitId')::uuid,v_qty,(v_line->>'actualUnitPurchaseCost')::numeric,p_currency,NULLIF(v_line->>'supplierReconfirmationId','')::uuid);
      FOR v_release IN SELECT * FROM jsonb_array_elements(v_line->'releaseAllocations') LOOP
        SELECT rl.*,s.id AS snapshot_id INTO v_release_line FROM procurement_release_lines rl JOIN approved_purchase_cost_snapshots s ON s.id=rl.approved_purchase_cost_snapshot_id WHERE rl.id=(v_release->>'releaseLineId')::uuid;
        IF v_release_line.id IS NULL OR v_release_line.product_identity_id<>(v_line->>'productIdentityId')::uuid OR v_release_line.unit_id<>(v_line->>'unitId')::uuid OR (v_release->>'quantity')::numeric<=0 THEN RAISE EXCEPTION 'SUPPLIER_PO_RELEASE_LINE_INVALID'; END IF;
        INSERT INTO supplier_po_release_line_allocations(supplier_purchase_order_line_id,procurement_release_line_id,allocated_quantity,approved_purchase_cost_snapshot_id,original_purchase_source_id,approved_unit_purchase_cost) VALUES(v_line_id,v_release_line.id,(v_release->>'quantity')::numeric,v_release_line.approved_purchase_cost_snapshot_id,v_release_line.purchase_source_id,v_release_line.unit_purchase_cost);
      END LOOP;
    ELSIF (v_line->>'demandOrigin')='STRATEGIC_OVERBUY' THEN
      SELECT * INTO v_strategic FROM strategic_overbuy_authorizations WHERE id=(v_line->>'strategicOverbuyAuthorizationId')::uuid;
      IF v_strategic.id IS NULL OR v_strategic.purchase_source_id<>p_source OR v_strategic.product_identity_id<>(v_line->>'productIdentityId')::uuid OR v_strategic.unit_id<>(v_line->>'unitId')::uuid OR v_qty>v_strategic.authorized_quantity THEN RAISE EXCEPTION 'STRATEGIC_OVERBUY_INVALID'; END IF;
      INSERT INTO supplier_purchase_order_lines(id,supplier_purchase_order_id,demand_origin,product_identity_id,unit_id,ordered_quantity,actual_unit_purchase_cost,currency_code,supplier_reconfirmation_id,strategic_overbuy_authorization_id) VALUES(v_line_id,v_po,'STRATEGIC_OVERBUY',(v_line->>'productIdentityId')::uuid,(v_line->>'unitId')::uuid,v_qty,(v_line->>'actualUnitPurchaseCost')::numeric,p_currency,NULLIF(v_line->>'supplierReconfirmationId','')::uuid,v_strategic.id);
    ELSE RAISE EXCEPTION 'SUPPLIER_PO_LINE_INVALID'; END IF;
  END LOOP;
  RETURN v_po;
END $$;

CREATE FUNCTION public.internal_supplier_po_issue(p_actor uuid,p_po uuid,p_correlation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_po record; v_line record; v_allocation record; v_release record; v_source record; v_reconfirm record; v_open numeric; v_need numeric; v_bound numeric; v_funding record; v_total numeric:=0; v_limit numeric; v_actual numeric;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'supplier_po.issue') THEN RAISE EXCEPTION 'SUPPLIER_PO_ISSUE_FORBIDDEN'; END IF;
  SELECT * INTO v_po FROM supplier_purchase_orders WHERE id=p_po FOR UPDATE;
  IF v_po.id IS NULL OR v_po.status<>'DRAFT' THEN RAISE EXCEPTION 'SUPPLIER_PO_NOT_ISSUABLE'; END IF;
  IF v_po.currency_code<>'SAR' THEN RAISE EXCEPTION 'SUPPLIER_PO_FINANCIAL_CURRENCY_UNSUPPORTED'; END IF;
  SELECT max_issue_amount_sar INTO v_limit FROM supplier_po_financial_authorities WHERE actor_user_id=p_actor AND active FOR UPDATE;
  IF v_limit IS NULL THEN RAISE EXCEPTION 'SUPPLIER_PO_FINANCIAL_AUTHORITY_REQUIRED'; END IF;
  SELECT s.*,q.id AS qualification_id INTO v_source FROM purchase_sources s JOIN supplier_qualifications q ON q.company_id=s.supplier_company_id AND q.status IN ('APPROVED','ACTIVE') WHERE s.id=v_po.purchase_source_id AND s.status='ACTIVE' FOR SHARE;
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'PURCHASE_SOURCE_NOT_USABLE'; END IF;
  FOR v_line IN SELECT l.*,pi.category_id FROM supplier_purchase_order_lines l JOIN product_identities pi ON pi.id=l.product_identity_id WHERE l.supplier_purchase_order_id=p_po ORDER BY l.id FOR UPDATE LOOP
    IF NOT EXISTS(SELECT 1 FROM supplier_category_capabilities c WHERE c.supplier_partnership_id=v_source.supplier_partnership_id AND c.category_id=v_line.category_id AND c.status='ACTIVE') THEN RAISE EXCEPTION 'PURCHASE_SOURCE_NOT_CAPABLE'; END IF;
    IF v_line.supplier_reconfirmation_id IS NOT NULL THEN
      SELECT * INTO v_reconfirm FROM supplier_reconfirmations WHERE id=v_line.supplier_reconfirmation_id AND purchase_source_id=v_po.purchase_source_id AND product_identity_id=v_line.product_identity_id FOR SHARE;
      IF v_reconfirm.id IS NULL OR v_reconfirm.currency_code<>v_po.currency_code OR v_reconfirm.confirmed_purchase_price<>v_line.actual_unit_purchase_cost OR v_reconfirm.confirmed_available_quantity<v_line.ordered_quantity OR (v_reconfirm.valid_until IS NOT NULL AND v_reconfirm.valid_until<current_date) THEN RAISE EXCEPTION 'SUPPLIER_PO_PRICE_EVIDENCE_INVALID'; END IF;
    END IF;
    IF v_line.demand_origin='STRATEGIC_OVERBUY' THEN
      IF NOT EXISTS(SELECT 1 FROM strategic_overbuy_authorizations a WHERE a.id=v_line.strategic_overbuy_authorization_id AND a.purchase_source_id=v_po.purchase_source_id AND a.product_identity_id=v_line.product_identity_id AND a.unit_id=v_line.unit_id AND a.currency_code=v_po.currency_code AND a.max_unit_purchase_cost>=v_line.actual_unit_purchase_cost FOR UPDATE) THEN RAISE EXCEPTION 'STRATEGIC_OVERBUY_INVALID'; END IF;
      IF v_line.ordered_quantity>COALESCE((SELECT a.authorized_quantity-COALESCE(sum(x.ordered_quantity),0) FROM strategic_overbuy_authorizations a LEFT JOIN supplier_purchase_order_lines x ON x.strategic_overbuy_authorization_id=a.id LEFT JOIN supplier_purchase_orders xp ON xp.id=x.supplier_purchase_order_id AND xp.status='ISSUED' WHERE a.id=v_line.strategic_overbuy_authorization_id GROUP BY a.authorized_quantity),0) THEN RAISE EXCEPTION 'STRATEGIC_OVERBUY_QUANTITY_EXCEEDED'; END IF;
      v_total:=v_total+v_line.ordered_quantity*v_line.actual_unit_purchase_cost;
      CONTINUE;
    END IF;
    FOR v_allocation IN SELECT * FROM supplier_po_release_line_allocations WHERE supplier_purchase_order_line_id=v_line.id ORDER BY procurement_release_line_id FOR UPDATE LOOP
      SELECT rl.*,r.status AS release_status INTO v_release FROM procurement_release_lines rl JOIN procurement_releases r ON r.id=rl.release_id WHERE rl.id=v_allocation.procurement_release_line_id FOR UPDATE;
      IF v_release.id IS NULL OR v_release.release_status<>'PROCUREMENT_RELEASED' OR v_release.product_identity_id<>v_line.product_identity_id OR v_release.unit_id<>v_line.unit_id THEN RAISE EXCEPTION 'SUPPLIER_PO_RELEASE_LINE_INVALID'; END IF;
      v_open:=v_release.released_quantity-COALESCE((SELECT sum(a.allocated_quantity) FROM supplier_po_release_line_allocations a JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id WHERE a.procurement_release_line_id=v_release.id AND p.status='ISSUED'),0);
      IF v_allocation.allocated_quantity>v_open THEN RAISE EXCEPTION 'SUPPLIER_PO_RELEASE_QUANTITY_EXCEEDED'; END IF;
      IF v_line.actual_unit_purchase_cost>v_allocation.approved_unit_purchase_cost THEN RAISE EXCEPTION 'SUPPLIER_PO_COST_ABOVE_APPROVED_BASIS'; END IF;
      IF v_line.supplier_reconfirmation_id IS NULL AND (v_po.purchase_source_id<>v_allocation.original_purchase_source_id OR v_line.actual_unit_purchase_cost<>v_allocation.approved_unit_purchase_cost OR EXISTS(SELECT 1 FROM approved_purchase_cost_snapshots s JOIN supplier_quote_revisions q ON q.id=s.supplier_quote_revision_id WHERE s.id=v_allocation.approved_purchase_cost_snapshot_id AND q.valid_until IS NOT NULL AND q.valid_until<current_date)) THEN RAISE EXCEPTION 'SUPPLIER_PO_PRICE_EVIDENCE_REQUIRED'; END IF;
      v_need:=v_allocation.allocated_quantity*v_allocation.approved_unit_purchase_cost;
      FOR v_funding IN SELECT f.* FROM procurement_funding_allocations f WHERE f.release_id=v_release.release_id ORDER BY f.id FOR UPDATE LOOP
        EXIT WHEN v_need<=0;
        SELECT COALESCE(sum(b.bound_amount),0) INTO v_bound FROM supplier_po_coverage_bindings b JOIN supplier_po_release_line_allocations a ON a.id=b.supplier_po_release_line_allocation_id JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id WHERE b.procurement_funding_allocation_id=v_funding.id AND p.status='ISSUED';
        v_actual:=LEAST(v_need,GREATEST(v_funding.amount-v_bound,0));
        IF v_actual>0 THEN INSERT INTO supplier_po_coverage_bindings(supplier_po_release_line_allocation_id,procurement_funding_allocation_id,bound_amount,currency_code) VALUES(v_allocation.id,v_funding.id,v_actual,v_po.currency_code); v_need:=v_need-v_actual; END IF;
      END LOOP;
      IF v_need>0 THEN RAISE EXCEPTION 'SUPPLIER_PO_COVERAGE_NOT_AVAILABLE'; END IF;
      v_total:=v_total+v_allocation.allocated_quantity*v_line.actual_unit_purchase_cost;
    END LOOP;
  END LOOP;
  IF v_total>v_limit THEN RAISE EXCEPTION 'SUPPLIER_PO_FINANCIAL_LIMIT_EXCEEDED'; END IF;
  PERFORM set_config('app.supplier_po_gateway','true',true);
  UPDATE supplier_purchase_orders SET status='ISSUED',issued_by=p_actor,issued_at=now(),total_actual_purchase_cost=v_total,correlation_id=COALESCE(NULLIF(p_correlation,'')::uuid,correlation_id) WHERE id=p_po;
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.issued','SupplierPurchaseOrder',p_po,jsonb_build_object('purchaseSourceId',v_po.purchase_source_id,'totalActualPurchaseCost',v_total,'currencyCode',v_po.currency_code),NULLIF(p_correlation,'')::uuid);
END $$;

CREATE OR REPLACE FUNCTION public.internal_procurement_release_withdraw(p_actor uuid,p_release uuid,p_reason text,p_correlation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_status "ProcurementReleaseStatus"; v_alloc record;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'procurement_release.withdraw') THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_WITHDRAW_FORBIDDEN'; END IF;
  IF btrim(COALESCE(p_reason,''))='' THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_WITHDRAW_REASON_REQUIRED'; END IF;
  SELECT status INTO v_status FROM procurement_releases WHERE id=p_release FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_NOT_FOUND'; END IF;
  IF v_status<>'PROCUREMENT_RELEASED' THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_NOT_WITHDRAWABLE'; END IF;
  IF EXISTS(SELECT 1 FROM procurement_release_lines rl JOIN supplier_po_release_line_allocations a ON a.procurement_release_line_id=rl.id JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id WHERE rl.release_id=p_release AND p.status='ISSUED') THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_ALREADY_PURCHASED'; END IF;
  PERFORM set_config('app.procurement_release_gateway','true',true);
  UPDATE procurement_releases SET status='WITHDRAWN',withdrawn_by=p_actor,withdrawn_at=now(),withdrawal_reason=p_reason WHERE id=p_release;
  FOR v_alloc IN SELECT * FROM procurement_funding_allocations WHERE release_id=p_release ORDER BY id FOR UPDATE LOOP
    IF NOT EXISTS(SELECT 1 FROM procurement_funding_deallocations WHERE allocation_id=v_alloc.id) THEN INSERT INTO procurement_funding_deallocations(allocation_id,release_id,amount,reason,deallocated_by,correlation_id) VALUES(v_alloc.id,p_release,v_alloc.amount,p_reason,p_actor,NULLIF(p_correlation,'')::uuid); END IF;
  END LOOP;
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','procurement_release.withdrawn','ProcurementRelease',p_release,jsonb_build_object('reason',p_reason),NULLIF(p_correlation,'')::uuid);
END $$;

REVOKE ALL ON FUNCTION public.internal_supplier_po_financial_authority_set(uuid,uuid,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_purchase_source_preference_set(uuid,uuid,boolean,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_procurement_engineer_scope_set(uuid,uuid,uuid,uuid,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_strategic_overbuy_authorize(uuid,uuid,uuid,uuid,numeric,text,numeric,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_supplier_po_draft_create(uuid,uuid,text,jsonb,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_supplier_po_issue(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_procurement_release_withdraw(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_po_financial_authority_set(uuid,uuid,numeric,text), public.internal_purchase_source_preference_set(uuid,uuid,boolean,text,text), public.internal_procurement_engineer_scope_set(uuid,uuid,uuid,uuid,boolean,text), public.internal_strategic_overbuy_authorize(uuid,uuid,uuid,uuid,numeric,text,numeric,text,text), public.internal_supplier_po_draft_create(uuid,uuid,text,jsonb,uuid,text), public.internal_supplier_po_issue(uuid,uuid,text), public.internal_procurement_release_withdraw(uuid,uuid,text,text) TO sco_internal_executor;
