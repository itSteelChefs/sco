CREATE TYPE "PricingRevisionStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','SUPERSEDED');

CREATE TABLE pricing_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_company_id UUID NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE pricing_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_case_id UUID NOT NULL REFERENCES pricing_cases(id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  status "PricingRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  selling_currency_code TEXT NOT NULL,
  direct_cost_basis NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (direct_cost_basis >= 0),
  selling_total NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (selling_total >= 0),
  gross_margin NUMERIC(18,6) NOT NULL DEFAULT 0,
  allocated_overhead NUMERIC(18,6) CHECK (allocated_overhead >= 0),
  estimated_contribution NUMERIC(18,6),
  created_by UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  submitted_by UUID REFERENCES "User"(id) ON DELETE RESTRICT,
  submitted_at TIMESTAMPTZ,
  approved_by UUID REFERENCES "User"(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  approval_reason TEXT,
  self_approved BOOLEAN NOT NULL DEFAULT false,
  superseded_by_revision_id UUID REFERENCES pricing_revisions(id) ON DELETE RESTRICT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pricing_case_id, revision_number)
);
CREATE TABLE pricing_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_revision_id UUID NOT NULL REFERENCES pricing_revisions(id) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  product_identity_id UUID NOT NULL REFERENCES product_identities(id) ON DELETE RESTRICT,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  unit_id UUID NOT NULL REFERENCES unit_definitions(id) ON DELETE RESTRICT,
  unit_selling_price NUMERIC(18,6) NOT NULL CHECK (unit_selling_price >= 0),
  tax_treatment_code TEXT,
  tax_rate NUMERIC(9,6),
  tax_amount NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  amount_excl_tax NUMERIC(18,6) NOT NULL CHECK (amount_excl_tax >= 0),
  amount_incl_tax NUMERIC(18,6) NOT NULL CHECK (amount_incl_tax >= 0),
  direct_cost_basis NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (direct_cost_basis >= 0),
  gross_margin NUMERIC(18,6) NOT NULL DEFAULT 0,
  estimated_contribution NUMERIC(18,6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pricing_revision_id, line_number)
);
CREATE TABLE manual_fx_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_line_id UUID NOT NULL REFERENCES pricing_lines(id) ON DELETE RESTRICT,
  source_currency_code TEXT NOT NULL,
  target_currency_code TEXT NOT NULL,
  manual_rate NUMERIC(24,12) NOT NULL CHECK (manual_rate > 0),
  as_of_date DATE NOT NULL,
  recorded_by UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_currency_code <> target_currency_code)
);
CREATE TABLE pricing_cost_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_line_id UUID NOT NULL REFERENCES pricing_lines(id) ON DELETE RESTRICT,
  approved_purchase_cost_snapshot_id UUID NOT NULL REFERENCES approved_purchase_cost_snapshots(id) ON DELETE RESTRICT,
  allocated_quantity NUMERIC(18,4) NOT NULL CHECK (allocated_quantity > 0),
  source_currency_code TEXT NOT NULL,
  source_unit_cost NUMERIC(18,6) NOT NULL CHECK (source_unit_cost >= 0),
  converted_cost_amount NUMERIC(18,6) NOT NULL CHECK (converted_cost_amount >= 0),
  manual_fx_snapshot_id UUID REFERENCES manual_fx_snapshots(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pricing_line_id, approved_purchase_cost_snapshot_id)
);
CREATE TABLE direct_deal_cost_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_line_id UUID NOT NULL REFERENCES pricing_lines(id) ON DELETE RESTRICT,
  cost_type TEXT NOT NULL,
  description TEXT,
  source_currency_code TEXT NOT NULL,
  source_amount NUMERIC(18,6) NOT NULL CHECK (source_amount >= 0),
  converted_cost_amount NUMERIC(18,6) NOT NULL CHECK (converted_cost_amount >= 0),
  manual_fx_snapshot_id UUID REFERENCES manual_fx_snapshots(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE pricing_overhead_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_revision_id UUID NOT NULL UNIQUE REFERENCES pricing_revisions(id) ON DELETE RESTRICT,
  allocated_overhead NUMERIC(18,6) NOT NULL CHECK (allocated_overhead >= 0),
  currency_code TEXT NOT NULL,
  rationale TEXT,
  created_by UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE pricing_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_revision_id UUID NOT NULL REFERENCES pricing_revisions(id) ON DELETE RESTRICT,
  decision "PricingRevisionStatus" NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  actor_user_id UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  reason TEXT,
  self_approval BOOLEAN NOT NULL DEFAULT false,
  direct_loss BOOLEAN NOT NULL DEFAULT false,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pricing_revision_id)
);

CREATE INDEX pricing_cases_partner_idx ON pricing_cases(partner_company_id);
CREATE INDEX pricing_revisions_case_idx ON pricing_revisions(pricing_case_id, revision_number);
CREATE INDEX pricing_lines_revision_idx ON pricing_lines(pricing_revision_id);
CREATE INDEX pricing_allocations_snapshot_idx ON pricing_cost_allocations(approved_purchase_cost_snapshot_id);

INSERT INTO "Permission"(id,code,description) VALUES
  (gen_random_uuid(),'pricing.read','Read internal selling-price revisions without buy-side cost data'),
  (gen_random_uuid(),'pricing.create','Create and submit internal pricing revisions'),
  (gen_random_uuid(),'pricing.approve','Approve or reject internal pricing revisions'),
  (gen_random_uuid(),'pricing.self_approve','Self-approve a pricing revision with a reason'),
  (gen_random_uuid(),'pricing.direct_cost.manage','Add direct deal costs to pricing revisions'),
  (gen_random_uuid(),'margin.read','Read internal direct-cost basis and gross margin'),
  (gen_random_uuid(),'overhead.read','Read internal overhead assessments'),
  (gen_random_uuid(),'loss_sale.approve','Approve direct-loss pricing revisions')
ON CONFLICT(code) DO NOTHING;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['pricing_cases','pricing_revisions','pricing_lines','manual_fx_snapshots','pricing_cost_allocations','direct_deal_cost_items','pricing_overhead_assessments','pricing_approvals'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM sco_runtime, sco_internal_executor', t);
  END LOOP;
END $$;

CREATE FUNCTION public.prevent_pricing_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR current_setting('app.pricing_gateway',true) <> 'true' THEN
    RAISE EXCEPTION 'PRICING_HISTORY_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pricing_revisions_immutable BEFORE UPDATE OR DELETE ON pricing_revisions FOR EACH ROW EXECUTE FUNCTION public.prevent_pricing_history_mutation();
CREATE TRIGGER pricing_lines_immutable BEFORE UPDATE OR DELETE ON pricing_lines FOR EACH ROW EXECUTE FUNCTION public.prevent_pricing_history_mutation();
CREATE TRIGGER manual_fx_snapshots_immutable BEFORE UPDATE OR DELETE ON manual_fx_snapshots FOR EACH ROW EXECUTE FUNCTION public.prevent_pricing_history_mutation();
CREATE TRIGGER pricing_cost_allocations_immutable BEFORE UPDATE OR DELETE ON pricing_cost_allocations FOR EACH ROW EXECUTE FUNCTION public.prevent_pricing_history_mutation();
CREATE TRIGGER direct_deal_cost_items_immutable BEFORE UPDATE OR DELETE ON direct_deal_cost_items FOR EACH ROW EXECUTE FUNCTION public.prevent_pricing_history_mutation();
CREATE TRIGGER pricing_overhead_assessments_immutable BEFORE UPDATE OR DELETE ON pricing_overhead_assessments FOR EACH ROW EXECUTE FUNCTION public.prevent_pricing_history_mutation();
CREATE TRIGGER pricing_approvals_immutable BEFORE UPDATE OR DELETE ON pricing_approvals FOR EACH ROW EXECUTE FUNCTION public.prevent_pricing_history_mutation();

CREATE FUNCTION public.internal_pricing_create(
  p_actor uuid, p_case uuid, p_partner uuid, p_currency text, p_lines jsonb, p_direct_costs jsonb,
  p_overhead numeric, p_overhead_reason text, p_correlation text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_case uuid := p_case; v_revision uuid := gen_random_uuid(); v_previous uuid; v_number integer; v_line jsonb; v_cost jsonb; v_direct jsonb;
  v_line_id uuid; v_fx_id uuid; v_line_cost numeric; v_line_selling numeric; v_line_tax numeric; v_direct_total numeric; v_total_cost numeric := 0;
  v_total_selling numeric := 0; v_product uuid; v_quantity numeric; v_unit uuid; v_rate numeric; v_source_currency text; v_source_unit numeric;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'pricing.create') THEN RAISE EXCEPTION 'PRICING_CREATE_FORBIDDEN'; END IF;
  IF p_lines IS NULL OR jsonb_array_length(p_lines)=0 THEN RAISE EXCEPTION 'PRICING_LINES_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public."Company" c WHERE c.id=p_partner AND c.type='PARTNER' AND c.status='ACTIVE') THEN RAISE EXCEPTION 'PRICING_PARTNER_NOT_AVAILABLE'; END IF;
  IF COALESCE(jsonb_array_length(p_direct_costs),0)>0 AND NOT public.internal_has_capability(p_actor,'pricing.direct_cost.manage') THEN RAISE EXCEPTION 'DIRECT_COST_MANAGE_FORBIDDEN'; END IF;
  IF v_case IS NULL THEN
    v_case:=gen_random_uuid(); INSERT INTO public.pricing_cases(id,partner_company_id,created_by) VALUES(v_case,p_partner,p_actor); v_number:=1;
  ELSE
    SELECT r.id,r.revision_number+1 INTO v_previous,v_number FROM public.pricing_revisions r JOIN public.pricing_cases c ON c.id=r.pricing_case_id
      WHERE r.pricing_case_id=v_case AND c.partner_company_id=p_partner ORDER BY r.revision_number DESC LIMIT 1 FOR UPDATE;
    IF v_previous IS NULL THEN RAISE EXCEPTION 'PRICING_CASE_NOT_AVAILABLE'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.pricing_revisions WHERE id=v_previous AND status IN ('APPROVED','REJECTED')) THEN RAISE EXCEPTION 'PRICING_REVISION_NOT_REVISIONABLE'; END IF;
  END IF;
  INSERT INTO public.pricing_revisions(id,pricing_case_id,revision_number,selling_currency_code,allocated_overhead,created_by,correlation_id)
    VALUES(v_revision,v_case,v_number,p_currency,COALESCE(p_overhead,0),p_actor,NULLIF(p_correlation,'')::uuid);
  PERFORM set_config('app.pricing_gateway','true',true);
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_product:=(v_line->>'productIdentityId')::uuid; v_quantity:=(v_line->>'quantity')::numeric; v_unit:=(v_line->>'unitId')::uuid;
    IF v_quantity IS NULL OR v_quantity<=0 OR NOT EXISTS(SELECT 1 FROM public.product_identities WHERE id=v_product AND status='ACTIVE') THEN RAISE EXCEPTION 'PRICING_LINE_INVALID'; END IF;
    v_line_id:=gen_random_uuid(); v_line_selling:=v_quantity*(v_line->>'unitSellingPrice')::numeric; v_line_tax:=COALESCE((v_line->>'taxAmount')::numeric,0); v_line_cost:=0;
    INSERT INTO public.pricing_lines(id,pricing_revision_id,line_number,product_identity_id,quantity,unit_id,unit_selling_price,tax_treatment_code,tax_rate,tax_amount,amount_excl_tax,amount_incl_tax)
      VALUES(v_line_id,v_revision,(v_line->>'lineNumber')::integer,v_product,v_quantity,v_unit,(v_line->>'unitSellingPrice')::numeric,NULLIF(v_line->>'taxTreatmentCode',''),NULLIF(v_line->>'taxRate','')::numeric,v_line_tax,v_line_selling,v_line_selling+v_line_tax);
    IF COALESCE(jsonb_array_length(v_line->'allocations'),0)=0 THEN RAISE EXCEPTION 'PRICING_COST_ALLOCATION_REQUIRED'; END IF;
    FOR v_cost IN SELECT value FROM jsonb_array_elements(v_line->'allocations') LOOP
      SELECT s.currency_code,s.unit_purchase_cost INTO v_source_currency,v_source_unit FROM public.approved_purchase_cost_snapshots s
        WHERE s.id=(v_cost->>'snapshotId')::uuid AND s.status='APPROVED' AND s.product_identity_id=v_product;
      IF v_source_currency IS NULL OR (v_cost->>'quantity')::numeric<=0 OR (v_cost->>'quantity')::numeric>(SELECT approved_quantity FROM public.approved_purchase_cost_snapshots WHERE id=(v_cost->>'snapshotId')::uuid) THEN RAISE EXCEPTION 'PRICING_COST_ALLOCATION_INVALID'; END IF;
      v_rate:=CASE WHEN v_source_currency=p_currency THEN 1 ELSE NULLIF(v_cost->>'fxRate','')::numeric END;
      IF v_rate IS NULL OR v_rate<=0 THEN RAISE EXCEPTION 'MANUAL_FX_REQUIRED'; END IF;
      v_fx_id:=NULL;
      IF v_source_currency<>p_currency THEN
        IF NULLIF(v_cost->>'asOfDate','') IS NULL THEN RAISE EXCEPTION 'MANUAL_FX_AS_OF_REQUIRED'; END IF;
        v_fx_id:=gen_random_uuid(); INSERT INTO public.manual_fx_snapshots(id,pricing_line_id,source_currency_code,target_currency_code,manual_rate,as_of_date,recorded_by,reason)
          VALUES(v_fx_id,v_line_id,v_source_currency,p_currency,v_rate,(v_cost->>'asOfDate')::date,p_actor,NULLIF(v_cost->>'fxReason',''));
      END IF;
      v_line_cost:=v_line_cost+((v_cost->>'quantity')::numeric*v_source_unit*v_rate);
      INSERT INTO public.pricing_cost_allocations(pricing_line_id,approved_purchase_cost_snapshot_id,allocated_quantity,source_currency_code,source_unit_cost,converted_cost_amount,manual_fx_snapshot_id)
        VALUES(v_line_id,(v_cost->>'snapshotId')::uuid,(v_cost->>'quantity')::numeric,v_source_currency,v_source_unit,(v_cost->>'quantity')::numeric*v_source_unit*v_rate,v_fx_id);
    END LOOP;
    IF (SELECT COALESCE(sum(allocated_quantity),0) FROM public.pricing_cost_allocations WHERE pricing_line_id=v_line_id)<>v_quantity THEN RAISE EXCEPTION 'PRICING_COST_ALLOCATION_QUANTITY_MISMATCH'; END IF;
    v_direct_total:=0;
    FOR v_direct IN SELECT value FROM jsonb_array_elements(COALESCE(p_direct_costs,'[]'::jsonb)) LOOP
      IF (v_direct->>'lineNumber')::integer=(v_line->>'lineNumber')::integer THEN
        v_rate:=CASE WHEN (v_direct->>'currency')=p_currency THEN 1 ELSE NULLIF(v_direct->>'fxRate','')::numeric END;
        IF v_rate IS NULL OR v_rate<=0 THEN RAISE EXCEPTION 'MANUAL_FX_REQUIRED'; END IF;
        v_fx_id:=NULL;
        IF (v_direct->>'currency')<>p_currency THEN
          IF NULLIF(v_direct->>'asOfDate','') IS NULL THEN RAISE EXCEPTION 'MANUAL_FX_AS_OF_REQUIRED'; END IF;
          v_fx_id:=gen_random_uuid(); INSERT INTO public.manual_fx_snapshots(id,pricing_line_id,source_currency_code,target_currency_code,manual_rate,as_of_date,recorded_by,reason)
            VALUES(v_fx_id,v_line_id,v_direct->>'currency',p_currency,v_rate,(v_direct->>'asOfDate')::date,p_actor,NULLIF(v_direct->>'fxReason',''));
        END IF;
        v_direct_total:=v_direct_total+(v_direct->>'amount')::numeric*v_rate;
        INSERT INTO public.direct_deal_cost_items(pricing_line_id,cost_type,description,source_currency_code,source_amount,converted_cost_amount,manual_fx_snapshot_id,created_by)
          VALUES(v_line_id,v_direct->>'type',NULLIF(v_direct->>'description',''),v_direct->>'currency',(v_direct->>'amount')::numeric,(v_direct->>'amount')::numeric*v_rate,v_fx_id,p_actor);
      END IF;
    END LOOP;
    UPDATE public.pricing_lines SET direct_cost_basis=v_line_cost+v_direct_total,gross_margin=v_line_selling-(v_line_cost+v_direct_total),estimated_contribution=v_line_selling-(v_line_cost+v_direct_total) WHERE id=v_line_id;
    v_total_cost:=v_total_cost+v_line_cost+v_direct_total; v_total_selling:=v_total_selling+v_line_selling;
  END LOOP;
  PERFORM set_config('app.pricing_gateway','true',true);
  UPDATE public.pricing_revisions SET direct_cost_basis=v_total_cost,selling_total=v_total_selling,gross_margin=v_total_selling-v_total_cost,estimated_contribution=v_total_selling-v_total_cost-COALESCE(p_overhead,0) WHERE id=v_revision;
  IF COALESCE(p_overhead,0)>0 THEN INSERT INTO public.pricing_overhead_assessments(pricing_revision_id,allocated_overhead,currency_code,rationale,created_by) VALUES(v_revision,p_overhead,p_currency,p_overhead_reason,p_actor); END IF;
  IF v_previous IS NOT NULL THEN UPDATE public.pricing_revisions SET status='SUPERSEDED',superseded_by_revision_id=v_revision WHERE id=v_previous; END IF;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','pricing.created','PricingRevision',v_revision,jsonb_build_object('pricingCaseId',v_case,'revisionNumber',v_number),NULLIF(p_correlation,'')::uuid);
  RETURN v_revision;
END $$;

CREATE FUNCTION public.internal_pricing_submit(p_actor uuid,p_revision uuid,p_correlation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor,'pricing.create') THEN RAISE EXCEPTION 'PRICING_CREATE_FORBIDDEN'; END IF;
  PERFORM set_config('app.pricing_gateway','true',true);
  UPDATE public.pricing_revisions SET status='PENDING_APPROVAL',submitted_by=p_actor,submitted_at=now() WHERE id=p_revision AND status='DRAFT' AND created_by=p_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRICING_REVISION_NOT_SUBMITTABLE'; END IF;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','pricing.submitted','PricingRevision',p_revision,'{}',NULLIF(p_correlation,'')::uuid);
END $$;

CREATE FUNCTION public.internal_pricing_decide(p_actor uuid,p_revision uuid,p_decision text,p_reason text,p_self boolean,p_correlation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_creator uuid; v_margin numeric; v_direct_loss boolean; v_action text;
BEGIN
  IF p_decision NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'PRICING_DECISION_INVALID'; END IF;
  IF NOT public.internal_has_capability(p_actor,'pricing.approve') THEN RAISE EXCEPTION 'PRICING_APPROVAL_FORBIDDEN'; END IF;
  SELECT created_by,gross_margin INTO v_creator,v_margin FROM public.pricing_revisions WHERE id=p_revision AND status='PENDING_APPROVAL' FOR UPDATE;
  IF v_creator IS NULL THEN RAISE EXCEPTION 'PRICING_REVISION_NOT_PENDING'; END IF;
  IF (p_decision='REJECTED' OR p_actor=v_creator) AND btrim(COALESCE(p_reason,''))='' THEN RAISE EXCEPTION 'PRICING_APPROVAL_REASON_REQUIRED'; END IF;
  IF p_actor=v_creator AND (NOT p_self OR NOT public.internal_has_capability(p_actor,'pricing.self_approve')) THEN RAISE EXCEPTION 'PRICING_SEPARATION_OF_DUTIES_REQUIRED'; END IF;
  v_direct_loss:=v_margin<0;
  IF p_decision='APPROVED' AND v_direct_loss AND (NOT public.internal_has_capability(p_actor,'loss_sale.approve') OR btrim(COALESCE(p_reason,''))='') THEN RAISE EXCEPTION 'DIRECT_LOSS_APPROVAL_REQUIRED'; END IF;
  PERFORM set_config('app.pricing_gateway','true',true);
  UPDATE public.pricing_revisions SET status=p_decision::"PricingRevisionStatus",approved_by=p_actor,approved_at=now(),approval_reason=NULLIF(p_reason,''),self_approved=(p_actor=v_creator) WHERE id=p_revision;
  INSERT INTO public.pricing_approvals(pricing_revision_id,decision,actor_user_id,reason,self_approval,direct_loss,correlation_id) VALUES(p_revision,p_decision::"PricingRevisionStatus",p_actor,NULLIF(p_reason,''),p_actor=v_creator,v_direct_loss,NULLIF(p_correlation,'')::uuid);
  v_action:=CASE WHEN p_decision='REJECTED' THEN 'pricing.rejected' WHEN v_direct_loss THEN 'pricing.direct_loss_approved' WHEN p_actor=v_creator THEN 'pricing.self_approved' ELSE 'pricing.approved' END;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL',v_action,'PricingRevision',p_revision,jsonb_build_object('decision',p_decision,'selfApproval',p_actor=v_creator,'directLoss',v_direct_loss,'reason',NULLIF(p_reason,'')),NULLIF(p_correlation,'')::uuid);
END $$;

CREATE FUNCTION public.internal_pricing_get(p_actor uuid,p_revision uuid) RETURNS TABLE(id uuid,status "PricingRevisionStatus",selling_currency_code text,selling_total numeric,created_at timestamptz) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT r.id,r.status,r.selling_currency_code,r.selling_total,r.created_at FROM public.pricing_revisions r WHERE r.id=p_revision AND public.internal_has_capability(p_actor,'pricing.read')
$$;
CREATE FUNCTION public.internal_pricing_margin_get(p_actor uuid,p_revision uuid) RETURNS TABLE(id uuid,direct_cost_basis numeric,selling_total numeric,gross_margin numeric,estimated_contribution numeric) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT r.id,r.direct_cost_basis,r.selling_total,r.gross_margin,r.estimated_contribution FROM public.pricing_revisions r WHERE r.id=p_revision AND public.internal_has_capability(p_actor,'margin.read')
$$;
CREATE FUNCTION public.internal_pricing_overhead_get(p_actor uuid,p_revision uuid) RETURNS TABLE(allocated_overhead numeric,currency_code text,rationale text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT o.allocated_overhead,o.currency_code,o.rationale FROM public.pricing_overhead_assessments o WHERE o.pricing_revision_id=p_revision AND public.internal_has_capability(p_actor,'overhead.read')
$$;

REVOKE ALL ON FUNCTION public.internal_pricing_create(uuid,uuid,uuid,text,jsonb,jsonb,numeric,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_pricing_submit(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_pricing_decide(uuid,uuid,text,text,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_pricing_get(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_pricing_margin_get(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_pricing_overhead_get(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_pricing_create(uuid,uuid,uuid,text,jsonb,jsonb,numeric,text,text) TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.internal_pricing_submit(uuid,uuid,text) TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.internal_pricing_decide(uuid,uuid,text,text,boolean,text) TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.internal_pricing_get(uuid,uuid) TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.internal_pricing_margin_get(uuid,uuid) TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.internal_pricing_overhead_get(uuid,uuid) TO sco_internal_executor;
