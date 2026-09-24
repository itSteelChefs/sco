CREATE TYPE "ProcurementReleaseStatus" AS ENUM ('DRAFT','PROCUREMENT_RELEASED','WITHDRAWN');
CREATE TYPE "ProcurementFundingAllocationType" AS ENUM ('CUSTOMER_VERIFIED','SCO_INTERNAL');

CREATE TABLE procurement_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_commitment_id UUID NOT NULL REFERENCES commercial_commitments(id),
  partner_company_id UUID NOT NULL REFERENCES "Company"(id),
  status "ProcurementReleaseStatus" NOT NULL DEFAULT 'DRAFT',
  total_required NUMERIC(18,6) NOT NULL CHECK(total_required>=0),
  currency_code TEXT NOT NULL,
  executed_by UUID REFERENCES "User"(id),
  executed_at TIMESTAMPTZ,
  withdrawn_by UUID REFERENCES "User"(id),
  withdrawn_at TIMESTAMPTZ,
  withdrawal_reason TEXT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, commercial_commitment_id)
);
CREATE TABLE supplier_reconfirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_source_id UUID NOT NULL REFERENCES purchase_sources(id),
  supplier_company_id UUID NOT NULL REFERENCES "Company"(id),
  product_identity_id UUID NOT NULL REFERENCES product_identities(id),
  confirmed_purchase_price NUMERIC(18,6) NOT NULL CHECK(confirmed_purchase_price>=0),
  currency_code TEXT NOT NULL,
  confirmed_available_quantity NUMERIC(18,4) NOT NULL CHECK(confirmed_available_quantity>0),
  valid_until DATE,
  confirmed_by UUID NOT NULL REFERENCES "User"(id),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note_reference TEXT,
  correlation_id UUID
);
CREATE TABLE procurement_release_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES procurement_releases(id),
  commercial_commitment_line_id UUID NOT NULL REFERENCES commercial_commitment_lines(id),
  product_identity_id UUID NOT NULL REFERENCES product_identities(id),
  released_quantity NUMERIC(18,4) NOT NULL CHECK(released_quantity>0),
  unit_id UUID NOT NULL REFERENCES unit_definitions(id),
  approved_purchase_cost_snapshot_id UUID NOT NULL REFERENCES approved_purchase_cost_snapshots(id),
  purchase_source_id UUID NOT NULL REFERENCES purchase_sources(id),
  supplier_company_id UUID NOT NULL REFERENCES "Company"(id),
  supplier_reconfirmation_id UUID REFERENCES supplier_reconfirmations(id),
  currency_code TEXT NOT NULL,
  unit_purchase_cost NUMERIC(18,6) NOT NULL CHECK(unit_purchase_cost>=0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(release_id, commercial_commitment_line_id)
);
CREATE TABLE procurement_funding_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES procurement_releases(id),
  allocation_type "ProcurementFundingAllocationType" NOT NULL,
  customer_payment_receipt_id UUID REFERENCES customer_payment_receipts(id),
  internal_funding_authorization_id UUID REFERENCES internal_funding_authorizations(id),
  amount NUMERIC(18,6) NOT NULL CHECK(amount>0),
  currency_code TEXT NOT NULL,
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(release_id, allocation_type, customer_payment_receipt_id, internal_funding_authorization_id)
);
CREATE TABLE procurement_funding_deallocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id UUID NOT NULL REFERENCES procurement_funding_allocations(id),
  release_id UUID NOT NULL REFERENCES procurement_releases(id),
  amount NUMERIC(18,6) NOT NULL CHECK(amount>0),
  reason TEXT NOT NULL,
  deallocated_by UUID NOT NULL REFERENCES "User"(id),
  deallocated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID
);

INSERT INTO "Permission"(id,code,description) VALUES
(gen_random_uuid(),'procurement_release.execute','Execute procurement releases'),
(gen_random_uuid(),'procurement_release.read','Read procurement releases'),
(gen_random_uuid(),'procurement_release.withdraw','Withdraw procurement releases'),
(gen_random_uuid(),'supplier_reconfirmation.create','Record supplier reconfirmation'),
(gen_random_uuid(),'supplier_reconfirmation.read','Read supplier reconfirmation') ON CONFLICT(code) DO NOTHING;

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['procurement_releases','procurement_release_lines','procurement_funding_allocations','procurement_funding_deallocations','supplier_reconfirmations'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t); EXECUTE format('REVOKE ALL ON TABLE public.%I FROM sco_runtime,sco_internal_executor',t); END LOOP; END $$;
CREATE FUNCTION public.prevent_procurement_release_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' OR COALESCE(current_setting('app.procurement_release_gateway',true),'')<>'true' THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_HISTORY_IMMUTABLE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER procurement_releases_immutable BEFORE UPDATE OR DELETE ON procurement_releases FOR EACH ROW EXECUTE FUNCTION public.prevent_procurement_release_mutation();
CREATE TRIGGER procurement_release_lines_immutable BEFORE UPDATE OR DELETE ON procurement_release_lines FOR EACH ROW EXECUTE FUNCTION public.prevent_procurement_release_mutation();
CREATE TRIGGER procurement_funding_allocations_immutable BEFORE UPDATE OR DELETE ON procurement_funding_allocations FOR EACH ROW EXECUTE FUNCTION public.prevent_procurement_release_mutation();
CREATE TRIGGER procurement_funding_deallocations_immutable BEFORE UPDATE OR DELETE ON procurement_funding_deallocations FOR EACH ROW EXECUTE FUNCTION public.prevent_procurement_release_mutation();
CREATE TRIGGER supplier_reconfirmations_immutable BEFORE UPDATE OR DELETE ON supplier_reconfirmations FOR EACH ROW EXECUTE FUNCTION public.prevent_procurement_release_mutation();

CREATE OR REPLACE FUNCTION public.internal_supplier_reconfirmation_create(p_actor uuid,p_source uuid,p_supplier uuid,p_product uuid,p_price numeric,p_currency text,p_quantity numeric,p_valid_until date,p_note text,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE v uuid:=gen_random_uuid(); BEGIN IF NOT public.internal_has_capability(p_actor,'supplier_reconfirmation.create') THEN RAISE EXCEPTION 'SUPPLIER_RECONFIRMATION_FORBIDDEN'; END IF; IF p_price IS NULL OR p_price<0 OR p_quantity IS NULL OR p_quantity<=0 OR NOT EXISTS(SELECT 1 FROM purchase_sources s JOIN supplier_qualifications q ON q.company_id=s.supplier_company_id AND q.status IN ('APPROVED','ACTIVE') WHERE s.id=p_source AND s.supplier_company_id=p_supplier AND s.status='ACTIVE') THEN RAISE EXCEPTION 'SUPPLIER_RECONFIRMATION_INVALID'; END IF; PERFORM set_config('app.procurement_release_gateway','true',true); INSERT INTO supplier_reconfirmations(id,purchase_source_id,supplier_company_id,product_identity_id,confirmed_purchase_price,currency_code,confirmed_available_quantity,valid_until,confirmed_by,note_reference,correlation_id) VALUES(v,p_source,p_supplier,p_product,p_price,p_currency,p_quantity,p_valid_until,p_actor,p_note,NULLIF(p_correlation,'')::uuid); INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_reconfirmation.recorded','SupplierReconfirmation',v,jsonb_build_object('purchaseSourceId',p_source,'productIdentityId',p_product),NULLIF(p_correlation,'')::uuid); RETURN v; END $$;

CREATE OR REPLACE FUNCTION public.internal_procurement_release_execute(p_actor uuid,p_commitment uuid,p_lines jsonb,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_release uuid:=gen_random_uuid(); v_company uuid; v_currency text; v_req uuid; v_eval record; v_line jsonb; v_commit_line record; v_snapshot record; v_source record; v_qty numeric; v_customer numeric:=0; v_internal numeric:=0; v_total numeric:=0; v_available numeric; v_id uuid; v_receipt record; v_auth record;
BEGIN
 IF NOT public.internal_has_capability(p_actor,'procurement_release.execute') THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_FORBIDDEN'; END IF;
 IF p_lines IS NULL OR jsonb_array_length(p_lines)=0 THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_INVALID'; END IF;
 SELECT partner_company_id,currency_code INTO v_company,v_currency FROM commercial_commitments WHERE id=p_commitment AND status='COMMITTED' FOR UPDATE;
 IF v_company IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_COMMITMENT_NOT_RELEASEABLE'; END IF;
 SELECT id INTO v_req FROM supplier_funding_requirements WHERE commercial_commitment_id=p_commitment AND stage_type='CURRENT_PROCUREMENT_STEP' AND status='FUNDED' FOR UPDATE;
 IF v_req IS NULL THEN RAISE EXCEPTION 'PROCUREMENT_FUNDING_NOT_SATISFIED'; END IF;
 SELECT * INTO v_eval FROM cash_funding_evaluations WHERE supplier_funding_requirement_id=v_req ORDER BY evaluation_number DESC LIMIT 1;
 IF v_eval.status<>'FUNDED' OR v_eval.currency_code<>v_currency THEN RAISE EXCEPTION 'PROCUREMENT_FUNDING_NOT_SATISFIED'; END IF;
 FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
   SELECT * INTO v_commit_line FROM commercial_commitment_lines WHERE id=(v_line->>'commercialCommitmentLineId')::uuid AND commercial_commitment_id=p_commitment FOR UPDATE;
   IF v_commit_line.id IS NULL THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_LINE_INVALID'; END IF;
   v_qty:=(v_line->>'quantity')::numeric; IF v_qty IS NULL OR v_qty<=0 THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_LINE_INVALID'; END IF;
   IF v_qty > v_commit_line.quantity - COALESCE((SELECT sum(l.released_quantity) FROM procurement_release_lines l JOIN procurement_releases r ON r.id=l.release_id WHERE l.commercial_commitment_line_id=v_commit_line.id AND r.status='PROCUREMENT_RELEASED'),0) THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_QUANTITY_EXCEEDED'; END IF;
   SELECT * INTO v_snapshot FROM approved_purchase_cost_snapshots WHERE id=(v_line->>'approvedPurchaseCostSnapshotId')::uuid AND status='APPROVED' AND product_identity_id=v_commit_line.product_identity_id FOR SHARE;
   IF v_snapshot.id IS NULL OR v_snapshot.approved_quantity<v_qty OR v_snapshot.currency_code<>v_currency THEN RAISE EXCEPTION 'PROCUREMENT_BASIS_INVALID'; END IF;
   SELECT * INTO v_source FROM purchase_sources s JOIN supplier_qualifications q ON q.company_id=s.supplier_company_id AND q.status IN ('APPROVED','ACTIVE') WHERE s.id=v_snapshot.purchase_source_id AND s.status='ACTIVE' FOR SHARE;
   IF v_source.id IS NULL THEN RAISE EXCEPTION 'PURCHASE_SOURCE_NOT_USABLE'; END IF;
   v_total:=v_total+(v_qty*v_snapshot.unit_purchase_cost);
 END LOOP;
 SELECT COALESCE(sum(r.amount),0)-COALESCE(sum(d.amount),0) INTO v_available FROM customer_payment_receipts r LEFT JOIN procurement_funding_allocations a ON a.customer_payment_receipt_id=r.id LEFT JOIN procurement_funding_deallocations d ON d.allocation_id=a.id WHERE r.commercial_commitment_id=p_commitment AND r.status='VERIFIED' AND r.currency_code=v_currency;
 v_customer:=LEAST(v_total,COALESCE(v_available,0)); v_internal:=v_total-v_customer;
 IF v_internal>0 AND NOT EXISTS(SELECT 1 FROM internal_funding_authorizations a WHERE a.supplier_funding_requirement_id=v_req AND a.status='AUTHORIZED' AND a.currency_code=v_currency AND a.amount_approved>=v_internal) THEN RAISE EXCEPTION 'PROCUREMENT_FUNDING_NOT_AVAILABLE'; END IF;
 INSERT INTO procurement_releases(id,commercial_commitment_id,partner_company_id,status,total_required,currency_code,executed_by,executed_at,correlation_id) VALUES(v_release,p_commitment,v_company,'PROCUREMENT_RELEASED',v_total,v_currency,p_actor,now(),NULLIF(p_correlation,'')::uuid);
 FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
   SELECT * INTO v_snapshot FROM approved_purchase_cost_snapshots WHERE id=(v_line->>'approvedPurchaseCostSnapshotId')::uuid;
   INSERT INTO procurement_release_lines(release_id,commercial_commitment_line_id,product_identity_id,released_quantity,unit_id,approved_purchase_cost_snapshot_id,purchase_source_id,supplier_company_id,supplier_reconfirmation_id,currency_code,unit_purchase_cost) VALUES(v_release,(v_line->>'commercialCommitmentLineId')::uuid,(v_line->>'productIdentityId')::uuid,(v_line->>'quantity')::numeric,(v_line->>'unitId')::uuid,v_snapshot.id,v_snapshot.purchase_source_id,v_snapshot.supplier_company_id,NULLIF(v_line->>'supplierReconfirmationId','')::uuid,v_snapshot.currency_code,v_snapshot.unit_purchase_cost);
 END LOOP;
 IF v_customer>0 THEN INSERT INTO procurement_funding_allocations(release_id,allocation_type,amount,currency_code) VALUES(v_release,'CUSTOMER_VERIFIED',v_customer,v_currency); END IF;
 IF v_internal>0 THEN INSERT INTO procurement_funding_allocations(release_id,allocation_type,amount,currency_code) VALUES(v_release,'SCO_INTERNAL',v_internal,v_currency); END IF;
 INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','procurement_release.executed','ProcurementRelease',v_release,jsonb_build_object('commitmentId',p_commitment,'totalRequired',v_total),NULLIF(p_correlation,'')::uuid);
 RETURN v_release;
END $$;

CREATE OR REPLACE FUNCTION public.internal_procurement_release_withdraw(p_actor uuid,p_release uuid,p_reason text,p_correlation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE v_status "ProcurementReleaseStatus"; v_alloc record; BEGIN IF NOT public.internal_has_capability(p_actor,'procurement_release.withdraw') THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_WITHDRAW_FORBIDDEN'; END IF; IF btrim(COALESCE(p_reason,''))='' THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_WITHDRAW_REASON_REQUIRED'; END IF; SELECT status INTO v_status FROM procurement_releases WHERE id=p_release FOR UPDATE; IF v_status IS NULL THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_NOT_FOUND'; END IF; IF v_status<>'PROCUREMENT_RELEASED' THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_NOT_WITHDRAWABLE'; END IF; PERFORM set_config('app.procurement_release_gateway','true',true); UPDATE procurement_releases SET status='WITHDRAWN',withdrawn_by=p_actor,withdrawn_at=now(),withdrawal_reason=p_reason WHERE id=p_release; FOR v_alloc IN SELECT * FROM procurement_funding_allocations WHERE release_id=p_release LOOP INSERT INTO procurement_funding_deallocations(allocation_id,release_id,amount,reason,deallocated_by,correlation_id) VALUES(v_alloc.id,p_release,v_alloc.amount,p_reason,p_actor,NULLIF(p_correlation,'')::uuid); END LOOP; INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','procurement_release.withdrawn','ProcurementRelease',p_release,jsonb_build_object('reason',p_reason),NULLIF(p_correlation,'')::uuid); END $$;

REVOKE ALL ON FUNCTION public.internal_procurement_release_execute(uuid,uuid,jsonb,text),public.internal_procurement_release_withdraw(uuid,uuid,text,text),public.internal_supplier_reconfirmation_create(uuid,uuid,uuid,uuid,numeric,text,numeric,date,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_procurement_release_execute(uuid,uuid,jsonb,text),public.internal_procurement_release_withdraw(uuid,uuid,text,text),public.internal_supplier_reconfirmation_create(uuid,uuid,uuid,uuid,numeric,text,numeric,date,text,text) TO sco_internal_executor;
