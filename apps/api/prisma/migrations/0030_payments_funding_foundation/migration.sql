CREATE TYPE "CustomerPaymentRequirementStatus" AS ENUM ('OPEN','PARTIALLY_SATISFIED','SATISFIED','CANCELLED');
CREATE TYPE "CustomerPaymentReceiptStatus" AS ENUM ('RECORDED','VERIFIED','REJECTED');
CREATE TYPE "PaymentVerificationMethod" AS ENUM ('DOCUMENT_EVIDENCE','INTERNAL_CONFIRMATION');
CREATE TYPE "SupplierFundingRequirementStatus" AS ENUM ('OPEN','FUNDED','CANCELLED');
CREATE TYPE "CashFundingEvaluationStatus" AS ENUM ('NOT_FUNDED','FUNDED','NOT_COMPARABLE');
CREATE TYPE "InternalFundingAuthorizationStatus" AS ENUM ('AUTHORIZED','REVOKED');

CREATE TABLE customer_payment_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_commitment_id UUID NOT NULL REFERENCES commercial_commitments(id),
  partner_company_id UUID NOT NULL REFERENCES "Company"(id),
  requirement_type TEXT NOT NULL,
  amount_required NUMERIC(18,6) NOT NULL CHECK(amount_required>0),
  currency_code TEXT NOT NULL,
  due_date DATE,
  status "CustomerPaymentRequirementStatus" NOT NULL DEFAULT 'OPEN',
  created_by UUID NOT NULL REFERENCES "User"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID,
  UNIQUE(commercial_commitment_id,requirement_type)
);

CREATE TABLE customer_payment_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_payment_requirement_id UUID NOT NULL REFERENCES customer_payment_requirements(id),
  commercial_commitment_id UUID NOT NULL REFERENCES commercial_commitments(id),
  partner_company_id UUID NOT NULL REFERENCES "Company"(id),
  amount NUMERIC(18,6) NOT NULL CHECK(amount>0),
  currency_code TEXT NOT NULL,
  payment_date DATE NOT NULL,
  payment_method TEXT,
  payment_reference TEXT,
  evidence_reference TEXT,
  idempotency_key TEXT,
  status "CustomerPaymentReceiptStatus" NOT NULL DEFAULT 'RECORDED',
  recorded_by UUID NOT NULL REFERENCES "User"(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID,
  UNIQUE(partner_company_id,idempotency_key)
);

CREATE TABLE customer_payment_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_payment_receipt_id UUID NOT NULL UNIQUE REFERENCES customer_payment_receipts(id),
  method "PaymentVerificationMethod" NOT NULL,
  verified_by UUID NOT NULL REFERENCES "User"(id),
  reason_reference TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID
);

CREATE TABLE supplier_funding_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_commitment_id UUID NOT NULL REFERENCES commercial_commitments(id),
  stage_type TEXT NOT NULL,
  amount_required NUMERIC(18,6) NOT NULL CHECK(amount_required>0),
  currency_code TEXT NOT NULL,
  required_by DATE,
  status "SupplierFundingRequirementStatus" NOT NULL DEFAULT 'OPEN',
  created_by UUID NOT NULL REFERENCES "User"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID,
  UNIQUE(commercial_commitment_id,stage_type)
);

CREATE TABLE internal_funding_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_funding_requirement_id UUID NOT NULL REFERENCES supplier_funding_requirements(id),
  amount_approved NUMERIC(18,6) NOT NULL CHECK(amount_approved>0),
  currency_code TEXT NOT NULL,
  reason TEXT NOT NULL,
  status "InternalFundingAuthorizationStatus" NOT NULL DEFAULT 'AUTHORIZED',
  approved_by UUID NOT NULL REFERENCES "User"(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID,
  UNIQUE(supplier_funding_requirement_id)
);

CREATE TABLE cash_funding_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_funding_requirement_id UUID NOT NULL REFERENCES supplier_funding_requirements(id),
  evaluation_number INTEGER NOT NULL CHECK(evaluation_number>0),
  currency_code TEXT NOT NULL,
  customer_verified_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  customer_unverified_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  supplier_funding_required NUMERIC(18,6) NOT NULL,
  approved_internal_funding NUMERIC(18,6) NOT NULL DEFAULT 0,
  funding_gap NUMERIC(18,6) NOT NULL,
  status "CashFundingEvaluationStatus" NOT NULL,
  evaluated_by UUID NOT NULL REFERENCES "User"(id),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID,
  UNIQUE(supplier_funding_requirement_id,evaluation_number)
);

CREATE INDEX customer_payment_receipts_commitment_idx ON customer_payment_receipts(commercial_commitment_id);
CREATE INDEX cash_funding_evaluations_requirement_idx ON cash_funding_evaluations(supplier_funding_requirement_id,evaluation_number);

INSERT INTO "Permission"(id,code,description) VALUES
(gen_random_uuid(),'payment_requirement.create','Create customer payment requirements'),
(gen_random_uuid(),'payment_requirement.read','Read own customer payment requirements'),
(gen_random_uuid(),'payment.record','Record customer payment receipts'),
(gen_random_uuid(),'payment.verify','Verify customer payment receipts'),
(gen_random_uuid(),'payment.self_verify','Self-verify customer payment receipts with explicit authority'),
(gen_random_uuid(),'supplier_funding.read','Read internal supplier funding requirements'),
(gen_random_uuid(),'supplier_funding.manage','Manage internal supplier funding requirements'),
(gen_random_uuid(),'cash_exposure.read','Read internal cash exposure evaluations'),
(gen_random_uuid(),'funding.evaluate','Evaluate current procurement funding conditions'),
(gen_random_uuid(),'internal_funding.approve','Authorize internal SCO funding')
ON CONFLICT(code) DO NOTHING;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['customer_payment_requirements','customer_payment_receipts','customer_payment_verifications','supplier_funding_requirements','internal_funding_authorizations','cash_funding_evaluations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM sco_runtime,sco_internal_executor',t);
  END LOOP;
END $$;

CREATE FUNCTION public.prevent_payment_funding_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR COALESCE(current_setting('app.payment_funding_gateway',true),'')<>'true' THEN RAISE EXCEPTION 'PAYMENT_FUNDING_HISTORY_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_payment_requirements_immutable BEFORE UPDATE OR DELETE ON customer_payment_requirements FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_funding_history_mutation();
CREATE TRIGGER customer_payment_receipts_immutable BEFORE UPDATE OR DELETE ON customer_payment_receipts FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_funding_history_mutation();
CREATE TRIGGER customer_payment_verifications_immutable BEFORE UPDATE OR DELETE ON customer_payment_verifications FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_funding_history_mutation();
CREATE TRIGGER supplier_funding_requirements_immutable BEFORE UPDATE OR DELETE ON supplier_funding_requirements FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_funding_history_mutation();
CREATE TRIGGER internal_funding_authorizations_immutable BEFORE UPDATE OR DELETE ON internal_funding_authorizations FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_funding_history_mutation();
CREATE TRIGGER cash_funding_evaluations_immutable BEFORE UPDATE OR DELETE ON cash_funding_evaluations FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_funding_history_mutation();

CREATE FUNCTION public.internal_payment_requirement_create(p_actor uuid,p_commitment uuid,p_type text,p_amount numeric,p_currency text,p_due date,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid:=gen_random_uuid(); v_company uuid;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'payment_requirement.create') THEN RAISE EXCEPTION 'PAYMENT_REQUIREMENT_CREATE_FORBIDDEN'; END IF;
  SELECT partner_company_id INTO v_company FROM public.commercial_commitments WHERE id=p_commitment AND status='COMMITTED';
  IF v_company IS NULL OR btrim(COALESCE(p_type,''))='' OR p_amount IS NULL OR p_amount<=0 OR p_currency IS NULL THEN RAISE EXCEPTION 'PAYMENT_REQUIREMENT_INVALID'; END IF;
  PERFORM set_config('app.payment_funding_gateway','true',true);
  INSERT INTO public.customer_payment_requirements(id,commercial_commitment_id,partner_company_id,requirement_type,amount_required,currency_code,due_date,created_by,correlation_id) VALUES(v_id,p_commitment,v_company,p_type,p_amount,p_currency,p_due,p_actor,NULLIF(p_correlation,'')::uuid);
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','payment_requirement.created','CustomerPaymentRequirement',v_id,jsonb_build_object('commitmentId',p_commitment,'stage',p_type),NULLIF(p_correlation,'')::uuid);
  RETURN v_id;
END $$;

CREATE FUNCTION public.partner_payment_receipt_record(p_actor uuid,p_company uuid,p_requirement uuid,p_amount numeric,p_currency text,p_date date,p_method text,p_reference text,p_evidence text,p_idempotency text,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid:=gen_random_uuid(); v_commitment uuid;
BEGIN
  IF current_setting('app.tenant_id',true) IS DISTINCT FROM p_company::text OR NOT public.partner_po_capability(p_actor,p_company,'payment.record') THEN RAISE EXCEPTION 'PAYMENT_RECORD_NOT_AVAILABLE'; END IF;
  SELECT commercial_commitment_id INTO v_commitment FROM public.customer_payment_requirements WHERE id=p_requirement AND partner_company_id=p_company AND status<>'CANCELLED';
  IF v_commitment IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_currency IS NULL OR p_date IS NULL THEN RAISE EXCEPTION 'PAYMENT_RECORD_NOT_AVAILABLE'; END IF;
  IF p_idempotency IS NOT NULL AND EXISTS(SELECT 1 FROM public.customer_payment_receipts WHERE partner_company_id=p_company AND idempotency_key=p_idempotency) THEN RAISE EXCEPTION 'PAYMENT_RECEIPT_ALREADY_EXISTS'; END IF;
  PERFORM set_config('app.payment_funding_gateway','true',true);
  INSERT INTO public.customer_payment_receipts(id,customer_payment_requirement_id,commercial_commitment_id,partner_company_id,amount,currency_code,payment_date,payment_method,payment_reference,evidence_reference,idempotency_key,recorded_by,correlation_id) VALUES(v_id,p_requirement,v_commitment,p_company,p_amount,p_currency,p_date,p_method,p_reference,p_evidence,p_idempotency,p_actor,NULLIF(p_correlation,'')::uuid);
  INSERT INTO public.audit_logs(actor_user_id,company_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,p_company,'TENANT','payment.receipt_recorded','CustomerPaymentReceipt',v_id,jsonb_build_object('requirementId',p_requirement,'amount',p_amount,'currency',p_currency),NULLIF(p_correlation,'')::uuid);
  RETURN v_id;
END $$;

CREATE FUNCTION public.internal_payment_verify(p_actor uuid,p_receipt uuid,p_method "PaymentVerificationMethod",p_reason text,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid:=gen_random_uuid(); v_recorder uuid; v_company uuid; v_status "CustomerPaymentReceiptStatus"; v_evidence text;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'payment.verify') THEN RAISE EXCEPTION 'PAYMENT_VERIFY_FORBIDDEN'; END IF;
  SELECT recorded_by,partner_company_id,status,evidence_reference INTO v_recorder,v_company,v_status,v_evidence FROM public.customer_payment_receipts WHERE id=p_receipt FOR UPDATE;
  IF v_status IS NULL OR v_status<>'RECORDED' THEN RAISE EXCEPTION 'PAYMENT_NOT_VERIFIABLE'; END IF;
  IF v_recorder=p_actor AND NOT public.internal_has_capability(p_actor,'payment.self_verify') THEN RAISE EXCEPTION 'PAYMENT_SEPARATION_OF_DUTIES_REQUIRED'; END IF;
  IF btrim(COALESCE(p_reason,''))='' OR (p_method='DOCUMENT_EVIDENCE' AND btrim(COALESCE(v_evidence,''))='') THEN RAISE EXCEPTION 'PAYMENT_VERIFICATION_REASON_REQUIRED'; END IF;
  PERFORM set_config('app.payment_funding_gateway','true',true);
  INSERT INTO public.customer_payment_verifications(id,customer_payment_receipt_id,method,verified_by,reason_reference,correlation_id) VALUES(v_id,p_receipt,p_method,p_actor,p_reason,NULLIF(p_correlation,'')::uuid);
  UPDATE public.customer_payment_receipts SET status='VERIFIED' WHERE id=p_receipt;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','payment.verified','CustomerPaymentReceipt',p_receipt,jsonb_build_object('method',p_method),NULLIF(p_correlation,'')::uuid);
  RETURN v_id;
END $$;

CREATE FUNCTION public.internal_supplier_funding_create(p_actor uuid,p_commitment uuid,p_stage text,p_amount numeric,p_currency text,p_required_by date,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid:=gen_random_uuid();
BEGIN
  IF NOT public.internal_has_capability(p_actor,'supplier_funding.manage') THEN RAISE EXCEPTION 'SUPPLIER_FUNDING_FORBIDDEN'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.commercial_commitments WHERE id=p_commitment AND status='COMMITTED') OR btrim(COALESCE(p_stage,''))='' OR p_amount IS NULL OR p_amount<=0 OR p_currency IS NULL THEN RAISE EXCEPTION 'SUPPLIER_FUNDING_INVALID'; END IF;
  PERFORM set_config('app.payment_funding_gateway','true',true);
  INSERT INTO public.supplier_funding_requirements(id,commercial_commitment_id,stage_type,amount_required,currency_code,required_by,created_by,correlation_id) VALUES(v_id,p_commitment,p_stage,p_amount,p_currency,p_required_by,p_actor,NULLIF(p_correlation,'')::uuid);
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_funding_requirement.created','SupplierFundingRequirement',v_id,jsonb_build_object('commitmentId',p_commitment,'stage',p_stage),NULLIF(p_correlation,'')::uuid);
  RETURN v_id;
END $$;

CREATE FUNCTION public.internal_funding_authorize(p_actor uuid,p_requirement uuid,p_amount numeric,p_currency text,p_reason text,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid:=gen_random_uuid();
BEGIN
  IF NOT public.internal_has_capability(p_actor,'internal_funding.approve') THEN RAISE EXCEPTION 'INTERNAL_FUNDING_FORBIDDEN'; END IF;
  IF btrim(COALESCE(p_reason,''))='' OR p_amount IS NULL OR p_amount<=0 OR p_currency IS NULL OR NOT EXISTS(SELECT 1 FROM public.supplier_funding_requirements WHERE id=p_requirement AND status<>'CANCELLED') THEN RAISE EXCEPTION 'INTERNAL_FUNDING_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM public.internal_funding_authorizations WHERE supplier_funding_requirement_id=p_requirement) THEN RAISE EXCEPTION 'INTERNAL_FUNDING_ALREADY_AUTHORIZED'; END IF;
  PERFORM set_config('app.payment_funding_gateway','true',true);
  INSERT INTO public.internal_funding_authorizations(id,supplier_funding_requirement_id,amount_approved,currency_code,reason,approved_by,correlation_id) VALUES(v_id,p_requirement,p_amount,p_currency,p_reason,p_actor,NULLIF(p_correlation,'')::uuid);
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','internal_funding.authorized','InternalFundingAuthorization',v_id,jsonb_build_object('requirementId',p_requirement,'amount',p_amount,'currency',p_currency),NULLIF(p_correlation,'')::uuid);
  RETURN v_id;
END $$;

CREATE FUNCTION public.internal_cash_funding_evaluate(p_actor uuid,p_requirement uuid,p_correlation text) RETURNS TABLE(evaluation_id uuid,status "CashFundingEvaluationStatus",funding_gap numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid:=gen_random_uuid(); v_commitment uuid; v_currency text; v_required numeric; v_verified numeric:=0; v_unverified numeric:=0; v_internal numeric:=0; v_gap numeric; v_status "CashFundingEvaluationStatus"; v_number integer;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'funding.evaluate') THEN RAISE EXCEPTION 'FUNDING_EVALUATION_FORBIDDEN'; END IF;
  SELECT commercial_commitment_id,currency_code,amount_required INTO v_commitment,v_currency,v_required FROM public.supplier_funding_requirements WHERE id=p_requirement AND status<>'CANCELLED' FOR UPDATE;
  IF v_commitment IS NULL THEN RAISE EXCEPTION 'SUPPLIER_FUNDING_NOT_FOUND'; END IF;
  IF EXISTS(SELECT 1 FROM public.customer_payment_receipts r WHERE r.commercial_commitment_id=v_commitment AND r.status='VERIFIED' AND r.currency_code<>v_currency) OR EXISTS(SELECT 1 FROM public.internal_funding_authorizations a WHERE a.supplier_funding_requirement_id=p_requirement AND a.status='AUTHORIZED' AND a.currency_code<>v_currency) THEN v_status:='NOT_COMPARABLE';
  ELSE
    SELECT COALESCE(sum(CASE WHEN status='VERIFIED' AND currency_code=v_currency THEN amount ELSE 0 END),0),COALESCE(sum(CASE WHEN status='RECORDED' AND currency_code=v_currency THEN amount ELSE 0 END),0) INTO v_verified,v_unverified FROM public.customer_payment_receipts WHERE commercial_commitment_id=v_commitment;
    SELECT COALESCE(sum(amount_approved),0) INTO v_internal FROM public.internal_funding_authorizations WHERE supplier_funding_requirement_id=p_requirement AND status='AUTHORIZED';
    v_gap:=v_required-v_verified-v_internal; v_status:=CASE WHEN v_gap<=0 THEN 'FUNDED'::"CashFundingEvaluationStatus" ELSE 'NOT_FUNDED'::"CashFundingEvaluationStatus" END;
  END IF;
  IF v_status='NOT_COMPARABLE' THEN v_gap:=NULL; END IF;
  SELECT COALESCE(max(evaluation_number),0)+1 INTO v_number FROM public.cash_funding_evaluations WHERE supplier_funding_requirement_id=p_requirement;
  PERFORM set_config('app.payment_funding_gateway','true',true);
  INSERT INTO public.cash_funding_evaluations(id,supplier_funding_requirement_id,evaluation_number,currency_code,customer_verified_amount,customer_unverified_amount,supplier_funding_required,approved_internal_funding,funding_gap,status,evaluated_by,correlation_id) VALUES(v_id,p_requirement,v_number,v_currency,v_verified,v_unverified,v_required,v_internal,v_gap,v_status,p_actor,NULLIF(p_correlation,'')::uuid);
  IF v_status='FUNDED' THEN UPDATE public.supplier_funding_requirements SET status='FUNDED' WHERE id=p_requirement; END IF;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','funding.evaluated','CashFundingEvaluation',v_id,jsonb_build_object('status',v_status,'fundingGap',v_gap),NULLIF(p_correlation,'')::uuid);
  IF v_status='FUNDED' THEN INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','funding.condition_satisfied','SupplierFundingRequirement',p_requirement,jsonb_build_object('evaluationId',v_id),NULLIF(p_correlation,'')::uuid); END IF;
  RETURN QUERY SELECT v_id,v_status,v_gap;
END $$;

CREATE FUNCTION public.partner_payment_summary(p_actor uuid,p_company uuid,p_commitment uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE v jsonb; BEGIN IF current_setting('app.tenant_id',true) IS DISTINCT FROM p_company::text OR NOT public.partner_po_capability(p_actor,p_company,'payment_requirement.read') THEN RETURN NULL; END IF; SELECT jsonb_build_object('commitmentId',p_commitment,'totalRequired',COALESCE((SELECT sum(amount_required) FROM public.customer_payment_requirements WHERE commercial_commitment_id=p_commitment),0),'verifiedAmountReceived',COALESCE((SELECT sum(amount) FROM public.customer_payment_receipts WHERE commercial_commitment_id=p_commitment AND status='VERIFIED'),0),'unverifiedAmountRecorded',COALESCE((SELECT sum(amount) FROM public.customer_payment_receipts WHERE commercial_commitment_id=p_commitment AND status='RECORDED'),0),'amountRemaining',GREATEST(COALESCE((SELECT sum(amount_required) FROM public.customer_payment_requirements WHERE commercial_commitment_id=p_commitment),0)-COALESCE((SELECT sum(amount) FROM public.customer_payment_receipts WHERE commercial_commitment_id=p_commitment AND status='VERIFIED'),0),0)) INTO v FROM public.commercial_commitments c WHERE c.id=p_commitment AND c.partner_company_id=p_company; RETURN v; END $$;

CREATE FUNCTION public.internal_supplier_funding_get(p_actor uuid,p_requirement uuid) RETURNS SETOF public.supplier_funding_requirements LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT r FROM public.supplier_funding_requirements r WHERE r.id=p_requirement AND public.internal_has_capability(p_actor,'supplier_funding.read') $$;
CREATE FUNCTION public.internal_cash_exposure_get(p_actor uuid,p_requirement uuid) RETURNS SETOF public.cash_funding_evaluations LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT e FROM public.cash_funding_evaluations e WHERE e.supplier_funding_requirement_id=p_requirement AND public.internal_has_capability(p_actor,'cash_exposure.read') ORDER BY e.evaluation_number $$;

REVOKE ALL ON FUNCTION public.internal_payment_requirement_create(uuid,uuid,text,numeric,text,date,text),public.partner_payment_receipt_record(uuid,uuid,uuid,numeric,text,date,text,text,text,text,text),public.internal_payment_verify(uuid,uuid,"PaymentVerificationMethod",text,text),public.internal_supplier_funding_create(uuid,uuid,text,numeric,text,date,text),public.internal_funding_authorize(uuid,uuid,numeric,text,text,text),public.internal_cash_funding_evaluate(uuid,uuid,text),public.partner_payment_summary(uuid,uuid,uuid),public.internal_supplier_funding_get(uuid,uuid),public.internal_cash_exposure_get(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_payment_receipt_record(uuid,uuid,uuid,numeric,text,date,text,text,text,text,text),public.partner_payment_summary(uuid,uuid,uuid) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_payment_requirement_create(uuid,uuid,text,numeric,text,date,text),public.internal_payment_verify(uuid,uuid,"PaymentVerificationMethod",text,text),public.internal_supplier_funding_create(uuid,uuid,text,numeric,text,date,text),public.internal_funding_authorize(uuid,uuid,numeric,text,text,text),public.internal_cash_funding_evaluate(uuid,uuid,text),public.internal_supplier_funding_get(uuid,uuid),public.internal_cash_exposure_get(uuid,uuid) TO sco_internal_executor;
