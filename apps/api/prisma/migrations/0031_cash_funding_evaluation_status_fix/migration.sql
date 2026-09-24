CREATE OR REPLACE FUNCTION public.internal_cash_funding_evaluate(p_actor uuid,p_requirement uuid,p_correlation text) RETURNS TABLE(evaluation_id uuid,status "CashFundingEvaluationStatus",funding_gap numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid:=gen_random_uuid(); v_commitment uuid; v_currency text; v_required numeric; v_verified numeric:=0; v_unverified numeric:=0; v_internal numeric:=0; v_gap numeric; v_status "CashFundingEvaluationStatus"; v_number integer;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'funding.evaluate') THEN RAISE EXCEPTION 'FUNDING_EVALUATION_FORBIDDEN'; END IF;
  SELECT sfr.commercial_commitment_id,sfr.currency_code,sfr.amount_required INTO v_commitment,v_currency,v_required FROM public.supplier_funding_requirements sfr WHERE sfr.id=p_requirement AND sfr.status<>'CANCELLED' FOR UPDATE;
  IF v_commitment IS NULL THEN RAISE EXCEPTION 'SUPPLIER_FUNDING_NOT_FOUND'; END IF;
  IF EXISTS(SELECT 1 FROM public.customer_payment_receipts cpr WHERE cpr.commercial_commitment_id=v_commitment AND cpr.status='VERIFIED' AND cpr.currency_code<>v_currency) OR EXISTS(SELECT 1 FROM public.internal_funding_authorizations ifa WHERE ifa.supplier_funding_requirement_id=p_requirement AND ifa.status='AUTHORIZED' AND ifa.currency_code<>v_currency) THEN v_status:='NOT_COMPARABLE';
  ELSE
    SELECT COALESCE(sum(CASE WHEN cpr.status='VERIFIED' AND cpr.currency_code=v_currency THEN cpr.amount ELSE 0 END),0),COALESCE(sum(CASE WHEN cpr.status='RECORDED' AND cpr.currency_code=v_currency THEN cpr.amount ELSE 0 END),0) INTO v_verified,v_unverified FROM public.customer_payment_receipts cpr WHERE cpr.commercial_commitment_id=v_commitment;
    SELECT COALESCE(sum(ifa.amount_approved),0) INTO v_internal FROM public.internal_funding_authorizations ifa WHERE ifa.supplier_funding_requirement_id=p_requirement AND ifa.status='AUTHORIZED';
    v_gap:=v_required-v_verified-v_internal; v_status:=CASE WHEN v_gap<=0 THEN 'FUNDED'::"CashFundingEvaluationStatus" ELSE 'NOT_FUNDED'::"CashFundingEvaluationStatus" END;
  END IF;
  IF v_status='NOT_COMPARABLE' THEN v_gap:=NULL; END IF;
  SELECT COALESCE(max(cfe.evaluation_number),0)+1 INTO v_number FROM public.cash_funding_evaluations cfe WHERE cfe.supplier_funding_requirement_id=p_requirement;
  PERFORM set_config('app.payment_funding_gateway','true',true);
  INSERT INTO public.cash_funding_evaluations(id,supplier_funding_requirement_id,evaluation_number,currency_code,customer_verified_amount,customer_unverified_amount,supplier_funding_required,approved_internal_funding,funding_gap,status,evaluated_by,correlation_id) VALUES(v_id,p_requirement,v_number,v_currency,v_verified,v_unverified,v_required,v_internal,v_gap,v_status,p_actor,NULLIF(p_correlation,'')::uuid);
  IF v_status='FUNDED' THEN UPDATE public.supplier_funding_requirements SET status='FUNDED' WHERE id=p_requirement; END IF;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','funding.evaluated','CashFundingEvaluation',v_id,jsonb_build_object('status',v_status,'fundingGap',v_gap),NULLIF(p_correlation,'')::uuid);
  IF v_status='FUNDED' THEN INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','funding.condition_satisfied','SupplierFundingRequirement',p_requirement,jsonb_build_object('evaluationId',v_id),NULLIF(p_correlation,'')::uuid); END IF;
  RETURN QUERY SELECT v_id,v_status,v_gap;
END $$;
