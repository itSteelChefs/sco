CREATE TYPE "PartnerPurchaseOrderStatus" AS ENUM ('RECEIVED','VERIFIED','MATERIAL_DIFFERENCE','REJECTED');
CREATE TYPE "PartnerPurchaseOrderVerificationOutcome" AS ENUM ('MATCHED','MATERIAL_DIFFERENCE','REJECTED','REPLACEMENT_REQUIRED');
CREATE TYPE "CommercialCommitmentStatus" AS ENUM ('COMMITTED');

CREATE TABLE partner_purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_company_id UUID NOT NULL REFERENCES "Company"(id),
  accepted_offer_id UUID NOT NULL REFERENCES partner_offers(id),
  accepted_offer_revision_id UUID NOT NULL REFERENCES partner_offer_revisions(id),
  po_reference TEXT NOT NULL,
  po_date DATE NOT NULL,
  submitted_by UUID NOT NULL REFERENCES "User"(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  currency_code TEXT NOT NULL,
  total_excl_tax NUMERIC(18,6) NOT NULL,
  tax_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  total_incl_tax NUMERIC(18,6) NOT NULL,
  payment_terms TEXT,
  delivery_terms TEXT,
  administrative_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status "PartnerPurchaseOrderStatus" NOT NULL DEFAULT 'RECEIVED',
  correlation_id UUID,
  UNIQUE(accepted_offer_revision_id),
  UNIQUE(partner_company_id,po_reference)
);

CREATE TABLE partner_purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_purchase_order_id UUID NOT NULL REFERENCES partner_purchase_orders(id),
  line_number INTEGER NOT NULL,
  product_identity_id UUID NOT NULL REFERENCES product_identities(id),
  product_description TEXT NOT NULL,
  quantity NUMERIC(18,4) NOT NULL CHECK(quantity>0),
  unit_id UUID NOT NULL REFERENCES unit_definitions(id),
  unit_selling_price NUMERIC(18,6) NOT NULL,
  tax_treatment_code TEXT,
  tax_rate NUMERIC(9,6),
  tax_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  amount_excl_tax NUMERIC(18,6) NOT NULL,
  amount_incl_tax NUMERIC(18,6) NOT NULL,
  UNIQUE(partner_purchase_order_id,line_number)
);

CREATE TABLE partner_purchase_order_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_purchase_order_id UUID NOT NULL UNIQUE REFERENCES partner_purchase_orders(id),
  accepted_offer_revision_id UUID NOT NULL REFERENCES partner_offer_revisions(id),
  outcome "PartnerPurchaseOrderVerificationOutcome" NOT NULL,
  material_differences JSONB NOT NULL DEFAULT '[]'::jsonb,
  verified_by UUID NOT NULL REFERENCES "User"(id),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  correlation_id UUID
);

CREATE TABLE commercial_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_company_id UUID NOT NULL REFERENCES "Company"(id),
  partner_purchase_order_id UUID NOT NULL UNIQUE REFERENCES partner_purchase_orders(id),
  accepted_offer_id UUID NOT NULL REFERENCES partner_offers(id),
  accepted_offer_revision_id UUID NOT NULL UNIQUE REFERENCES partner_offer_revisions(id),
  commitment_revision_number INTEGER NOT NULL CHECK(commitment_revision_number>0),
  status "CommercialCommitmentStatus" NOT NULL DEFAULT 'COMMITTED',
  currency_code TEXT NOT NULL,
  total_excl_tax NUMERIC(18,6) NOT NULL,
  tax_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  total_incl_tax NUMERIC(18,6) NOT NULL,
  payment_terms TEXT,
  delivery_terms TEXT,
  committed_by UUID NOT NULL REFERENCES "User"(id),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID,
  UNIQUE(accepted_offer_revision_id,commitment_revision_number)
);

CREATE TABLE commercial_commitment_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_commitment_id UUID NOT NULL REFERENCES commercial_commitments(id),
  line_number INTEGER NOT NULL,
  product_identity_id UUID NOT NULL REFERENCES product_identities(id),
  product_description TEXT NOT NULL,
  quantity NUMERIC(18,4) NOT NULL CHECK(quantity>0),
  unit_id UUID NOT NULL REFERENCES unit_definitions(id),
  unit_selling_price NUMERIC(18,6) NOT NULL,
  tax_treatment_code TEXT,
  tax_rate NUMERIC(9,6),
  tax_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  amount_excl_tax NUMERIC(18,6) NOT NULL,
  amount_incl_tax NUMERIC(18,6) NOT NULL,
  UNIQUE(commercial_commitment_id,line_number)
);

CREATE INDEX partner_purchase_orders_company_idx ON partner_purchase_orders(partner_company_id);
CREATE INDEX commercial_commitments_company_idx ON commercial_commitments(partner_company_id);

INSERT INTO "Permission"(id,code,description) VALUES
(gen_random_uuid(),'partner_po.submit','Submit Partner Purchase Orders'),
(gen_random_uuid(),'partner_po.read','Read own Partner Purchase Orders'),
(gen_random_uuid(),'partner_po.verify','Verify Partner Purchase Orders'),
(gen_random_uuid(),'commercial_commitment.read','Read own Commercial Commitments'),
(gen_random_uuid(),'commercial_commitment.create','Create Commercial Commitments')
ON CONFLICT(code) DO NOTHING;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['partner_purchase_orders','partner_purchase_order_lines','partner_purchase_order_verifications','commercial_commitments','commercial_commitment_lines'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM sco_runtime,sco_internal_executor',t);
  END LOOP;
END $$;

CREATE FUNCTION public.prevent_partner_po_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR COALESCE(current_setting('app.partner_po_gateway',true),'')<>'true' THEN
    RAISE EXCEPTION 'PARTNER_PO_HISTORY_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_purchase_orders_immutable BEFORE UPDATE OR DELETE ON partner_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.prevent_partner_po_history_mutation();
CREATE TRIGGER partner_purchase_order_lines_immutable BEFORE UPDATE OR DELETE ON partner_purchase_order_lines FOR EACH ROW EXECUTE FUNCTION public.prevent_partner_po_history_mutation();
CREATE TRIGGER partner_purchase_order_verifications_immutable BEFORE UPDATE OR DELETE ON partner_purchase_order_verifications FOR EACH ROW EXECUTE FUNCTION public.prevent_partner_po_history_mutation();
CREATE TRIGGER commercial_commitments_immutable BEFORE UPDATE OR DELETE ON commercial_commitments FOR EACH ROW EXECUTE FUNCTION public.prevent_partner_po_history_mutation();
CREATE TRIGGER commercial_commitment_lines_immutable BEFORE UPDATE OR DELETE ON commercial_commitment_lines FOR EACH ROW EXECUTE FUNCTION public.prevent_partner_po_history_mutation();

CREATE FUNCTION public.partner_po_capability(p_actor uuid,p_company uuid,p_code text) RETURNS boolean LANGUAGE sql SET search_path=pg_catalog,public AS $$
SELECT EXISTS(SELECT 1 FROM public."CompanyMembership" cm JOIN public."Company" c ON c.id=cm."companyId" AND c.type='PARTNER' AND c.status='ACTIVE' JOIN public."MembershipRole" mr ON mr.membership_id=cm.id JOIN public."RolePermission" rp ON rp.role_id=mr.role_id JOIN public."Permission" p ON p.id=rp.permission_id WHERE cm."userId"=p_actor AND cm."companyId"=p_company AND cm.status='ACTIVE' AND p.code=p_code)
$$;
REVOKE ALL ON FUNCTION public.partner_po_capability(uuid,uuid,text) FROM PUBLIC,sco_internal_executor;

CREATE FUNCTION public.partner_po_submit(
  p_actor uuid,p_company uuid,p_offer uuid,p_revision uuid,p_reference text,p_po_date date,
  p_currency text,p_total_excl_tax numeric,p_tax_amount numeric,p_total_incl_tax numeric,
  p_payment_terms text,p_delivery_terms text,p_admin jsonb,p_lines jsonb,p_correlation text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_po uuid:=gen_random_uuid(); v_count integer; v_line jsonb;
BEGIN
  IF current_setting('app.tenant_id',true) IS DISTINCT FROM p_company::text OR NOT public.partner_po_capability(p_actor,p_company,'partner_po.submit') THEN RAISE EXCEPTION 'PARTNER_PO_NOT_AVAILABLE'; END IF;
  IF p_reference IS NULL OR btrim(p_reference)='' OR p_po_date IS NULL OR p_currency IS NULL OR p_lines IS NULL OR jsonb_array_length(p_lines)=0 THEN RAISE EXCEPTION 'PARTNER_PO_INVALID'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.partner_offer_revisions r JOIN public.partner_offers o ON o.id=r.partner_offer_id WHERE r.id=p_revision AND r.partner_offer_id=p_offer AND o.company_id=p_company AND r.status='ACCEPTED') THEN RAISE EXCEPTION 'PARTNER_PO_NOT_AVAILABLE'; END IF;
  IF EXISTS(SELECT 1 FROM public.partner_purchase_orders WHERE accepted_offer_revision_id=p_revision) THEN RAISE EXCEPTION 'PARTNER_PO_ALREADY_EXISTS'; END IF;
  PERFORM set_config('app.partner_po_gateway','true',true);
  INSERT INTO public.partner_purchase_orders(id,partner_company_id,accepted_offer_id,accepted_offer_revision_id,po_reference,po_date,submitted_by,currency_code,total_excl_tax,tax_amount,total_incl_tax,payment_terms,delivery_terms,administrative_metadata,correlation_id) VALUES(v_po,p_company,p_offer,p_revision,p_reference,p_po_date,p_actor,p_currency,p_total_excl_tax,p_tax_amount,p_total_incl_tax,p_payment_terms,p_delivery_terms,COALESCE(p_admin,'{}'::jsonb),NULLIF(p_correlation,'')::uuid);
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.partner_purchase_order_lines(partner_purchase_order_id,line_number,product_identity_id,product_description,quantity,unit_id,unit_selling_price,tax_treatment_code,tax_rate,tax_amount,amount_excl_tax,amount_incl_tax) VALUES(v_po,(v_line->>'lineNumber')::integer,(v_line->>'productIdentityId')::uuid,v_line->>'productDescription',(v_line->>'quantity')::numeric,(v_line->>'unitId')::uuid,(v_line->>'unitSellingPrice')::numeric,NULLIF(v_line->>'taxTreatmentCode',''),NULLIF(v_line->>'taxRate','')::numeric,COALESCE((v_line->>'taxAmount')::numeric,0),(v_line->>'amountExclTax')::numeric,(v_line->>'amountInclTax')::numeric);
  END LOOP;
  SELECT count(*) INTO v_count FROM public.partner_purchase_order_lines WHERE partner_purchase_order_id=v_po;
  IF v_count<>jsonb_array_length(p_lines) THEN RAISE EXCEPTION 'PARTNER_PO_INVALID'; END IF;
  INSERT INTO public.audit_logs(actor_user_id,company_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,p_company,'TENANT','partner_po.received','PartnerPurchaseOrder',v_po,jsonb_build_object('offerRevisionId',p_revision),NULLIF(p_correlation,'')::uuid);
  RETURN v_po;
END $$;

CREATE FUNCTION public.internal_partner_po_verify(p_actor uuid,p_po uuid,p_reason text,p_correlation text) RETURNS TABLE(verification_id uuid,outcome "PartnerPurchaseOrderVerificationOutcome") LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_revision uuid; v_company uuid; v_submitter uuid; v_diffs jsonb:='[]'::jsonb; v_verification uuid:=gen_random_uuid(); v_outcome "PartnerPurchaseOrderVerificationOutcome"; v_line record;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'partner_po.verify') THEN RAISE EXCEPTION 'PARTNER_PO_VERIFY_FORBIDDEN'; END IF;
  SELECT po.accepted_offer_revision_id,po.partner_company_id,po.submitted_by INTO v_revision,v_company,v_submitter FROM public.partner_purchase_orders po WHERE po.id=p_po AND po.status='RECEIVED' FOR UPDATE;
  IF v_revision IS NULL THEN RAISE EXCEPTION 'PARTNER_PO_NOT_VERIFIABLE'; END IF;
  IF p_actor=v_submitter THEN RAISE EXCEPTION 'PARTNER_PO_SEPARATION_OF_DUTIES_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM public.partner_purchase_order_verifications WHERE partner_purchase_order_id=p_po) THEN RAISE EXCEPTION 'PARTNER_PO_ALREADY_VERIFIED'; END IF;
  IF EXISTS(SELECT 1 FROM public.partner_purchase_orders po JOIN public.partner_offer_revisions r ON r.id=po.accepted_offer_revision_id WHERE po.id=p_po AND po.currency_code<>r.currency_code) THEN v_diffs:=v_diffs||jsonb_build_array('currency'); END IF;
  IF EXISTS(SELECT 1 FROM public.partner_purchase_orders po JOIN public.partner_offer_revisions r ON r.id=po.accepted_offer_revision_id WHERE po.id=p_po AND (po.total_excl_tax<>r.offer_total_excl_tax OR po.total_incl_tax<>r.offer_total_incl_tax)) THEN v_diffs:=v_diffs||jsonb_build_array('total'); END IF;
  IF EXISTS(SELECT 1 FROM public.partner_purchase_orders po JOIN public.partner_offer_revisions r ON r.id=po.accepted_offer_revision_id WHERE po.id=p_po AND (po.tax_amount<>r.offer_tax_amount)) THEN v_diffs:=v_diffs||jsonb_build_array('tax'); END IF;
  IF EXISTS(SELECT 1 FROM public.partner_purchase_orders po JOIN public.partner_offer_revisions r ON r.id=po.accepted_offer_revision_id WHERE po.id=p_po AND (COALESCE(po.payment_terms,'')<>COALESCE(r.payment_terms,'') OR COALESCE(po.delivery_terms,'')<>COALESCE(r.delivery_terms,''))) THEN v_diffs:=v_diffs||jsonb_build_array('commercial_terms'); END IF;
  IF EXISTS(SELECT 1 FROM public.partner_purchase_order_lines pl LEFT JOIN public.partner_offer_lines ol ON ol.partner_offer_revision_id=v_revision AND ol.line_number=pl.line_number WHERE pl.partner_purchase_order_id=p_po AND (ol.id IS NULL OR pl.product_identity_id<>ol.product_identity_id OR pl.quantity<>ol.quantity)) OR EXISTS(SELECT 1 FROM public.partner_offer_lines ol LEFT JOIN public.partner_purchase_order_lines pl ON pl.partner_purchase_order_id=p_po AND pl.line_number=ol.line_number WHERE ol.partner_offer_revision_id=v_revision AND pl.id IS NULL) THEN v_diffs:=v_diffs||jsonb_build_array('product_or_quantity'); END IF;
  IF EXISTS(SELECT 1 FROM public.partner_purchase_order_lines pl JOIN public.partner_offer_lines ol ON ol.partner_offer_revision_id=v_revision AND ol.line_number=pl.line_number WHERE pl.partner_purchase_order_id=p_po AND (pl.unit_selling_price<>ol.unit_selling_price)) THEN v_diffs:=v_diffs||jsonb_build_array('unit_price'); END IF;
  IF EXISTS(SELECT 1 FROM public.partner_purchase_order_lines pl JOIN public.partner_offer_lines ol ON ol.partner_offer_revision_id=v_revision AND ol.line_number=pl.line_number WHERE pl.partner_purchase_order_id=p_po AND (pl.tax_treatment_code IS DISTINCT FROM ol.tax_treatment_code OR pl.tax_rate IS DISTINCT FROM ol.tax_rate OR pl.tax_amount<>ol.tax_amount)) THEN v_diffs:=v_diffs||jsonb_build_array('tax'); END IF;
  v_outcome:=CASE WHEN jsonb_array_length(v_diffs)=0 THEN 'MATCHED'::"PartnerPurchaseOrderVerificationOutcome" ELSE 'MATERIAL_DIFFERENCE'::"PartnerPurchaseOrderVerificationOutcome" END;
  PERFORM set_config('app.partner_po_gateway','true',true);
  INSERT INTO public.partner_purchase_order_verifications(id,partner_purchase_order_id,accepted_offer_revision_id,outcome,material_differences,verified_by,reason,correlation_id) VALUES(v_verification,p_po,v_revision,v_outcome,v_diffs,p_actor,NULLIF(p_reason,''),NULLIF(p_correlation,'')::uuid);
  UPDATE public.partner_purchase_orders SET status=CASE WHEN v_outcome='MATCHED' THEN 'VERIFIED'::"PartnerPurchaseOrderStatus" ELSE 'MATERIAL_DIFFERENCE'::"PartnerPurchaseOrderStatus" END WHERE id=p_po;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL',CASE WHEN v_outcome='MATCHED' THEN 'partner_po.verified' ELSE 'partner_po.material_difference_detected' END,'PartnerPurchaseOrderVerification',v_verification,jsonb_build_object('outcome',v_outcome,'differenceCodes',v_diffs),NULLIF(p_correlation,'')::uuid);
  RETURN QUERY SELECT v_verification,v_outcome;
END $$;

CREATE FUNCTION public.internal_commercial_commitment_create(p_actor uuid,p_po uuid,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_commitment uuid:=gen_random_uuid(); v_company uuid; v_offer uuid; v_revision uuid; v_currency text; v_excl numeric; v_tax numeric; v_incl numeric; v_payment text; v_delivery text; v_line record;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'commercial_commitment.create') THEN RAISE EXCEPTION 'COMMERCIAL_COMMITMENT_CREATE_FORBIDDEN'; END IF;
  SELECT po.partner_company_id,po.accepted_offer_id,po.accepted_offer_revision_id,po.currency_code,po.total_excl_tax,po.tax_amount,po.total_incl_tax,po.payment_terms,po.delivery_terms INTO v_company,v_offer,v_revision,v_currency,v_excl,v_tax,v_incl,v_payment,v_delivery FROM public.partner_purchase_orders po JOIN public.partner_purchase_order_verifications pv ON pv.partner_purchase_order_id=po.id AND pv.outcome='MATCHED' WHERE po.id=p_po AND po.status='VERIFIED' FOR UPDATE;
  IF v_revision IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_COMMITMENT_NOT_ELIGIBLE'; END IF;
  IF EXISTS(SELECT 1 FROM public.commercial_commitments WHERE accepted_offer_revision_id=v_revision) THEN RAISE EXCEPTION 'COMMERCIAL_COMMITMENT_ALREADY_EXISTS'; END IF;
  PERFORM set_config('app.partner_po_gateway','true',true);
  INSERT INTO public.commercial_commitments(id,partner_company_id,partner_purchase_order_id,accepted_offer_id,accepted_offer_revision_id,commitment_revision_number,currency_code,total_excl_tax,tax_amount,total_incl_tax,payment_terms,delivery_terms,committed_by,correlation_id) VALUES(v_commitment,v_company,p_po,v_offer,v_revision,1,v_currency,v_excl,v_tax,v_incl,v_payment,v_delivery,p_actor,NULLIF(p_correlation,'')::uuid);
  FOR v_line IN SELECT * FROM public.partner_purchase_order_lines WHERE partner_purchase_order_id=p_po ORDER BY line_number LOOP
    INSERT INTO public.commercial_commitment_lines(commercial_commitment_id,line_number,product_identity_id,product_description,quantity,unit_id,unit_selling_price,tax_treatment_code,tax_rate,tax_amount,amount_excl_tax,amount_incl_tax) VALUES(v_commitment,v_line.line_number,v_line.product_identity_id,v_line.product_description,v_line.quantity,v_line.unit_id,v_line.unit_selling_price,v_line.tax_treatment_code,v_line.tax_rate,v_line.tax_amount,v_line.amount_excl_tax,v_line.amount_incl_tax);
  END LOOP;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','commercial_commitment.created','CommercialCommitment',v_commitment,jsonb_build_object('partnerPurchaseOrderId',p_po,'offerRevisionId',v_revision),NULLIF(p_correlation,'')::uuid);
  RETURN v_commitment;
END $$;

CREATE FUNCTION public.partner_purchase_order_projection(p_actor uuid,p_company uuid,p_po uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE v jsonb; BEGIN IF current_setting('app.tenant_id',true) IS DISTINCT FROM p_company::text OR NOT public.partner_po_capability(p_actor,p_company,'partner_po.read') THEN RETURN NULL; END IF; SELECT jsonb_build_object('id',po.id,'offerId',po.accepted_offer_id,'offerRevisionId',po.accepted_offer_revision_id,'reference',po.po_reference,'poDate',po.po_date,'currency',po.currency_code,'totalExclTax',po.total_excl_tax,'taxAmount',po.tax_amount,'totalInclTax',po.total_incl_tax,'paymentTerms',po.payment_terms,'deliveryTerms',po.delivery_terms,'status',po.status,'verification',COALESCE((SELECT jsonb_build_object('outcome',v.outcome,'materialDifferences',v.material_differences) FROM public.partner_purchase_order_verifications v WHERE v.partner_purchase_order_id=po.id),'{}'::jsonb),'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object('lineNumber',l.line_number,'productIdentityId',l.product_identity_id,'description',l.product_description,'quantity',l.quantity,'unitId',l.unit_id,'unitSellingPrice',l.unit_selling_price,'taxTreatmentCode',l.tax_treatment_code,'taxRate',l.tax_rate,'taxAmount',l.tax_amount,'amountExclTax',l.amount_excl_tax,'amountInclTax',l.amount_incl_tax) ORDER BY l.line_number) FROM public.partner_purchase_order_lines l WHERE l.partner_purchase_order_id=po.id),'[]'::jsonb)) INTO v FROM public.partner_purchase_orders po WHERE po.id=p_po AND po.partner_company_id=p_company; RETURN v; END $$;

CREATE FUNCTION public.commercial_commitment_projection(p_actor uuid,p_company uuid,p_commitment uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE v jsonb; BEGIN IF current_setting('app.tenant_id',true) IS DISTINCT FROM p_company::text OR NOT public.partner_po_capability(p_actor,p_company,'commercial_commitment.read') THEN RETURN NULL; END IF; SELECT jsonb_build_object('id',c.id,'purchaseOrderId',c.partner_purchase_order_id,'offerId',c.accepted_offer_id,'offerRevisionId',c.accepted_offer_revision_id,'revisionNumber',c.commitment_revision_number,'status',c.status,'currency',c.currency_code,'totalExclTax',c.total_excl_tax,'taxAmount',c.tax_amount,'totalInclTax',c.total_incl_tax,'paymentTerms',c.payment_terms,'deliveryTerms',c.delivery_terms,'committedAt',c.committed_at,'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object('lineNumber',l.line_number,'productIdentityId',l.product_identity_id,'description',l.product_description,'quantity',l.quantity,'unitId',l.unit_id,'unitSellingPrice',l.unit_selling_price,'taxTreatmentCode',l.tax_treatment_code,'taxRate',l.tax_rate,'taxAmount',l.tax_amount,'amountExclTax',l.amount_excl_tax,'amountInclTax',l.amount_incl_tax) ORDER BY l.line_number) FROM public.commercial_commitment_lines l WHERE l.commercial_commitment_id=c.id),'[]'::jsonb)) INTO v FROM public.commercial_commitments c WHERE c.id=p_commitment AND c.partner_company_id=p_company; RETURN v; END $$;

REVOKE ALL ON FUNCTION public.partner_po_submit(uuid,uuid,uuid,uuid,text,date,text,numeric,numeric,numeric,text,text,jsonb,jsonb,text),public.internal_partner_po_verify(uuid,uuid,text,text),public.internal_commercial_commitment_create(uuid,uuid,text),public.partner_purchase_order_projection(uuid,uuid,uuid),public.commercial_commitment_projection(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_po_submit(uuid,uuid,uuid,uuid,text,date,text,numeric,numeric,numeric,text,text,jsonb,jsonb,text),public.partner_purchase_order_projection(uuid,uuid,uuid),public.commercial_commitment_projection(uuid,uuid,uuid) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_partner_po_verify(uuid,uuid,text,text),public.internal_commercial_commitment_create(uuid,uuid,text) TO sco_internal_executor;
