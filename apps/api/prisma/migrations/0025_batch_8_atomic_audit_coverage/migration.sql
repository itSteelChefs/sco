-- Make each implemented Batch 8 commercial mutation and its minimized audit
-- evidence one atomic database operation. Applied migrations remain unchanged.

REVOKE ALL ON FUNCTION public.internal_rfq_create(uuid,uuid[],timestamptz,text) FROM PUBLIC, sco_internal_executor;
REVOKE ALL ON FUNCTION public.internal_rfq_transition(uuid,uuid,"RFQStatus") FROM PUBLIC, sco_internal_executor;
REVOKE ALL ON FUNCTION public.internal_rfq_add_recipient(uuid,uuid,uuid) FROM PUBLIC, sco_internal_executor;
REVOKE ALL ON FUNCTION public.internal_quote_record(uuid,uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC, sco_internal_executor;
REVOKE ALL ON FUNCTION public.internal_quote_revise(uuid,uuid,text,text,jsonb) FROM PUBLIC, sco_internal_executor;
REVOKE ALL ON FUNCTION public.internal_alternative_product_review(uuid,uuid,text,text) FROM PUBLIC, sco_internal_executor;

DROP FUNCTION public.internal_rfq_create(uuid,uuid[],timestamptz,text);
DROP FUNCTION public.internal_rfq_transition(uuid,uuid,"RFQStatus");
DROP FUNCTION public.internal_rfq_add_recipient(uuid,uuid,uuid);
DROP FUNCTION public.internal_quote_record(uuid,uuid,uuid,uuid,text,text,jsonb);
DROP FUNCTION public.internal_quote_revise(uuid,uuid,text,text,jsonb);
DROP FUNCTION public.internal_alternative_product_review(uuid,uuid,text,text);

CREATE FUNCTION public.internal_rfq_create(
  p_actor uuid, p_execution_items uuid[], p_expires timestamptz,
  p_notes text, p_correlation text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'rfq.create') THEN RAISE EXCEPTION 'RFQ_CREATE_FORBIDDEN'; END IF;
  IF p_execution_items IS NULL OR cardinality(p_execution_items)=0 THEN RAISE EXCEPTION 'RFQ_ITEMS_REQUIRED'; END IF;
  INSERT INTO public.rfqs(id,created_by,expires_at,internal_notes) VALUES(v_id,p_actor,p_expires,p_notes);
  INSERT INTO public.rfq_items(rfq_id,execution_item_id,company_id,project_id,procurement_need_id,product_identity_id,requested_quantity,unit_id)
    SELECT v_id,e.id,e.company_id,e.project_id,e.procurement_need_id,e.product_identity_id,e.remaining_quantity,e.unit_id
      FROM public.procurement_execution_items e
     WHERE e.id=ANY(p_execution_items) AND e.remaining_quantity>0;
  IF (SELECT count(*) FROM public.rfq_items WHERE rfq_id=v_id)<>cardinality(p_execution_items) THEN RAISE EXCEPTION 'RFQ_EXECUTION_ITEM_INVALID'; END IF;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id)
    VALUES(p_actor,'SCO_INTERNAL','rfq.created','RFQ',v_id,
      jsonb_build_object('executionItemCount',cardinality(p_execution_items)),NULLIF(p_correlation,'')::uuid);
  RETURN v_id;
END $$;

CREATE FUNCTION public.internal_rfq_transition(
  p_actor uuid, p_id uuid, p_next "RFQStatus", p_reason text, p_correlation text
) RETURNS TABLE(id uuid,status "RFQStatus")
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_from "RFQStatus"; v_status "RFQStatus";
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'rfq.manage') THEN RAISE EXCEPTION 'RFQ_MANAGE_FORBIDDEN'; END IF;
  SELECT r.status INTO v_from FROM public.rfqs r WHERE r.id=p_id FOR UPDATE;
  IF v_from IS NULL THEN RAISE EXCEPTION 'RFQ_NOT_FOUND'; END IF;
  IF NOT ((v_from='DRAFT' AND p_next IN ('READY_TO_SEND','CANCELLED')) OR
          (v_from='READY_TO_SEND' AND p_next IN ('ISSUED','CANCELLED')) OR
          (v_from='ISSUED' AND p_next IN ('RESPONSES_PENDING','CANCELLED')) OR
          (v_from='RESPONSES_PENDING' AND p_next IN ('EVALUATION','EXPIRED','CANCELLED')) OR
          (v_from='EVALUATION' AND p_next IN ('CLOSED','CANCELLED'))) THEN RAISE EXCEPTION 'INVALID_RFQ_TRANSITION'; END IF;
  UPDATE public.rfqs r SET status=p_next,updated_at=now(),
    issued_by=CASE WHEN p_next='ISSUED' THEN p_actor ELSE r.issued_by END,
    issued_at=CASE WHEN p_next='ISSUED' THEN now() ELSE r.issued_at END
    WHERE r.id=p_id RETURNING r.status INTO v_status;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id)
    VALUES(p_actor,'SCO_INTERNAL','rfq.'||lower(p_next::text),'RFQ',p_id,
      jsonb_build_object('fromStatus',v_from,'toStatus',p_next,'reason',p_reason),NULLIF(p_correlation,'')::uuid);
  RETURN QUERY SELECT p_id,v_status;
END $$;

CREATE FUNCTION public.internal_rfq_add_recipient(
  p_actor uuid, p_rfq uuid, p_source uuid, p_correlation text
) RETURNS TABLE(id uuid,status "RFQRecipientStatus")
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_supplier uuid; v_id uuid; v_status "RFQRecipientStatus";
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'rfq.manage') THEN RAISE EXCEPTION 'RFQ_MANAGE_FORBIDDEN'; END IF;
  SELECT ps.supplier_company_id INTO v_supplier
    FROM public.rfqs r
    JOIN public.rfq_items ri ON ri.rfq_id=r.id
    JOIN public.product_identities pi ON pi.id=ri.product_identity_id
    JOIN public.purchase_sources ps ON ps.id=p_source AND ps.status='ACTIVE'
    JOIN public.company_partnerships sp ON sp.id=ps.supplier_partnership_id AND sp.type='SUPPLIER_PARTNERSHIP' AND sp.status='ACTIVE'
    JOIN public.supplier_qualifications sq ON sq.supplier_partnership_id=sp.id AND sq.status='ACTIVE'
    JOIN public.supplier_category_capabilities scc ON scc.supplier_partnership_id=sp.id AND scc.category_id=pi.category_id AND scc.status='ACTIVE'
   WHERE r.id=p_rfq AND r.status<>'CLOSED' LIMIT 1;
  IF v_supplier IS NULL THEN RAISE EXCEPTION 'SOURCE_NOT_ELIGIBLE'; END IF;
  INSERT INTO public.rfq_recipients(rfq_id,purchase_source_id,supplier_company_id)
    VALUES(p_rfq,p_source,v_supplier) RETURNING rfq_recipients.id,rfq_recipients.status INTO v_id,v_status;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id)
    VALUES(p_actor,'SCO_INTERNAL','rfq.recipient_added','RFQRecipient',v_id,
      jsonb_build_object('rfqId',p_rfq,'purchaseSourceId',p_source),NULLIF(p_correlation,'')::uuid);
  RETURN QUERY SELECT v_id,v_status;
END $$;

CREATE FUNCTION public.internal_quote_record(
  p_actor uuid, p_rfq uuid, p_source uuid, p_supplier uuid, p_reference text,
  p_currency text, p_items jsonb, p_correlation text
) RETURNS TABLE(quote_id uuid,revision_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE q uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); x jsonb;
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'quote.record') THEN RAISE EXCEPTION 'QUOTE_RECORD_FORBIDDEN'; END IF;
  INSERT INTO public.supplier_quotes(id,rfq_id,purchase_source_id,supplier_company_id,quote_reference,created_by)
    VALUES(q,p_rfq,p_source,p_supplier,p_reference,p_actor);
  INSERT INTO public.supplier_quote_revisions(id,supplier_quote_id,revision_number,initiated_by,currency_code)
    VALUES(r,q,1,p_actor,p_currency);
  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.supplier_quote_items(revision_id,rfq_item_id,product_identity_id,quoted_quantity,unit_price_excl_tax)
      VALUES(r,(x->>'rfqItemId')::uuid,(x->>'productIdentityId')::uuid,(x->>'quantity')::numeric,(x->>'unitPrice')::numeric);
  END LOOP;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id)
    VALUES(p_actor,'SCO_INTERNAL','quote.recorded','SupplierQuote',q,
      jsonb_build_object('rfqId',p_rfq,'revisionId',r,'purchaseSourceId',p_source,'itemCount',jsonb_array_length(p_items)),NULLIF(p_correlation,'')::uuid);
  RETURN QUERY SELECT q,r;
END $$;

CREATE FUNCTION public.internal_quote_revise(
  p_actor uuid, p_quote uuid, p_currency text, p_reason text, p_items jsonb,
  p_correlation text
) RETURNS TABLE(id uuid,revision_number int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE prior record; r uuid:=gen_random_uuid(); n int; x jsonb;
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'quote.revise') THEN RAISE EXCEPTION 'QUOTE_REVISE_FORBIDDEN'; END IF;
  SELECT qr.id,qr.revision_number INTO prior FROM public.supplier_quote_revisions qr
    WHERE qr.supplier_quote_id=p_quote ORDER BY qr.revision_number DESC LIMIT 1 FOR UPDATE;
  IF prior.id IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;
  n:=prior.revision_number+1;
  INSERT INTO public.supplier_quote_revisions(id,supplier_quote_id,revision_number,supersedes_revision_id,initiated_by,reason,currency_code)
    VALUES(r,p_quote,n,prior.id,p_actor,p_reason,p_currency);
  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.supplier_quote_items(revision_id,rfq_item_id,product_identity_id,quoted_quantity,unit_price_excl_tax)
      VALUES(r,(x->>'rfqItemId')::uuid,(x->>'productIdentityId')::uuid,(x->>'quantity')::numeric,(x->>'unitPrice')::numeric);
  END LOOP;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id)
    VALUES(p_actor,'SCO_INTERNAL','quote.revised','SupplierQuoteRevision',r,
      jsonb_build_object('quoteId',p_quote,'revisionNumber',n,'reason',p_reason,'itemCount',jsonb_array_length(p_items)),NULLIF(p_correlation,'')::uuid);
  RETURN QUERY SELECT r,n;
END $$;

CREATE OR REPLACE FUNCTION public.internal_negotiation_record(
  p_actor uuid, p_rfq uuid, p_revision uuid, p_direction text, p_event text,
  p_reason text, p_metadata jsonb, p_correlation text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE s uuid; e uuid; v_created boolean:=false;
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'negotiation.manage') THEN RAISE EXCEPTION 'NEGOTIATION_MANAGE_FORBIDDEN'; END IF;
  SELECT n.id INTO s FROM public.negotiation_sessions n WHERE n.rfq_id=p_rfq AND n.status='OPEN' LIMIT 1 FOR UPDATE;
  IF s IS NULL THEN
    s:=gen_random_uuid(); v_created:=true;
    INSERT INTO public.negotiation_sessions(id,rfq_id,created_by) VALUES(s,p_rfq,p_actor);
  END IF;
  e:=gen_random_uuid();
  INSERT INTO public.negotiation_events(id,session_id,supplier_quote_revision_id,direction,event_type,reason,metadata,actor_user_id,correlation_id)
    VALUES(e,s,p_revision,p_direction,p_event,p_reason,COALESCE(p_metadata,'{}'),p_actor,p_correlation);
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id)
    VALUES(p_actor,'SCO_INTERNAL','negotiation.event_recorded','NegotiationEvent',e,
      jsonb_build_object('rfqId',p_rfq,'sessionId',s,'revisionId',p_revision,'direction',p_direction,
        'eventType',p_event,'reason',p_reason,'sessionCreated',v_created),NULLIF(p_correlation,'')::uuid);
  RETURN e;
END $$;

CREATE FUNCTION public.internal_alternative_product_review(
  p_actor uuid, p_id uuid, p_decision text, p_reason text, p_correlation text
) RETURNS TABLE(id uuid,status text,reviewed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_status text; v_reviewed timestamptz;
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'alternative_product.review') THEN RAISE EXCEPTION 'ALTERNATIVE_REVIEW_FORBIDDEN'; END IF;
  IF btrim(COALESCE(p_reason,''))='' THEN RAISE EXCEPTION 'REVIEW_REASON_REQUIRED'; END IF;
  IF p_decision NOT IN ('APPROVED','REJECTED','CLARIFICATION_REQUIRED') THEN RAISE EXCEPTION 'ALTERNATIVE_DECISION_INVALID'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.alternative_product_proposals a WHERE a.id=p_id AND a.status='PENDING_REVIEW' FOR UPDATE) THEN RAISE EXCEPTION 'ALTERNATIVE_PROPOSAL_NOT_PENDING'; END IF;
  UPDATE public.alternative_product_proposals a
     SET status=p_decision,reviewed_by=p_actor,reviewed_at=now(),decision_reason=p_reason
   WHERE a.id=p_id RETURNING a.status,a.reviewed_at INTO v_status,v_reviewed;
  INSERT INTO public.audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id)
    VALUES(p_actor,'SCO_INTERNAL','alternative_product.'||lower(p_decision),'AlternativeProductProposal',p_id,
      jsonb_build_object('decision',p_decision,'reason',p_reason),NULLIF(p_correlation,'')::uuid);
  RETURN QUERY SELECT p_id,v_status,v_reviewed;
END $$;

REVOKE ALL ON FUNCTION public.internal_rfq_create(uuid,uuid[],timestamptz,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_rfq_transition(uuid,uuid,"RFQStatus",text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_rfq_add_recipient(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_quote_record(uuid,uuid,uuid,uuid,text,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_quote_revise(uuid,uuid,text,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_negotiation_record(uuid,uuid,uuid,text,text,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_alternative_product_review(uuid,uuid,text,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.internal_rfq_create(uuid,uuid[],timestamptz,text,text) TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.internal_rfq_transition(uuid,uuid,"RFQStatus",text,text) TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.internal_rfq_add_recipient(uuid,uuid,uuid,text) TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.internal_quote_record(uuid,uuid,uuid,uuid,text,text,jsonb,text) TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.internal_quote_revise(uuid,uuid,text,text,jsonb,text) TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.internal_negotiation_record(uuid,uuid,uuid,text,text,text,jsonb,text) TO sco_internal_executor;
GRANT EXECUTE ON FUNCTION public.internal_alternative_product_review(uuid,uuid,text,text,text) TO sco_internal_executor;
