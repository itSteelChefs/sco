ALTER TABLE procurement_funding_allocations
  ADD CONSTRAINT procurement_funding_allocation_source_ck CHECK (
    (allocation_type='CUSTOMER_VERIFIED' AND customer_payment_receipt_id IS NOT NULL AND internal_funding_authorization_id IS NULL)
    OR (allocation_type='SCO_INTERNAL' AND customer_payment_receipt_id IS NULL AND internal_funding_authorization_id IS NOT NULL)
  );
CREATE UNIQUE INDEX procurement_funding_customer_source_once ON procurement_funding_allocations(customer_payment_receipt_id) WHERE allocation_type='CUSTOMER_VERIFIED';
CREATE UNIQUE INDEX procurement_funding_internal_source_once ON procurement_funding_allocations(internal_funding_authorization_id) WHERE allocation_type='SCO_INTERNAL';
CREATE INDEX procurement_funding_allocations_release_idx ON procurement_funding_allocations(release_id);
CREATE INDEX procurement_funding_deallocations_allocation_idx ON procurement_funding_deallocations(allocation_id);

CREATE OR REPLACE FUNCTION public.internal_procurement_release_execute(p_actor uuid,p_commitment uuid,p_lines jsonb,p_correlation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 v_release uuid:=gen_random_uuid(); v_company uuid; v_currency text; v_req uuid; v_eval record; v_line jsonb; v_commit_line record; v_snapshot record; v_source record; v_reconfirm record; v_qty numeric; v_total numeric:=0; v_customer numeric:=0; v_internal numeric:=0; v_available numeric:=0; v_need numeric; v_alloc numeric; v_allocated numeric; v_receipt record; v_auth record;
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
   IF NULLIF(v_line->>'supplierReconfirmationId','') IS NOT NULL THEN
     SELECT * INTO v_reconfirm FROM supplier_reconfirmations WHERE id=(v_line->>'supplierReconfirmationId')::uuid AND purchase_source_id=v_snapshot.purchase_source_id AND product_identity_id=v_commit_line.product_identity_id FOR SHARE;
     IF v_reconfirm.id IS NULL OR v_reconfirm.confirmed_purchase_price<>v_snapshot.unit_purchase_cost OR v_reconfirm.currency_code<>v_snapshot.currency_code OR v_reconfirm.confirmed_available_quantity<v_qty OR (v_reconfirm.valid_until IS NOT NULL AND v_reconfirm.valid_until<current_date) THEN RAISE EXCEPTION 'SUPPLIER_RECONFIRMATION_INVALID'; END IF;
   ELSIF EXISTS(SELECT 1 FROM supplier_quote_revisions sqr WHERE sqr.id=v_snapshot.supplier_quote_revision_id AND sqr.valid_until IS NOT NULL AND sqr.valid_until<current_date) THEN
     RAISE EXCEPTION 'SUPPLIER_BASIS_EXPIRED';
   END IF;
   v_total:=v_total+(v_qty*v_snapshot.unit_purchase_cost);
 END LOOP;
 SELECT COALESCE(sum(r.amount),0)-COALESCE(sum(a.amount),0)+COALESCE(sum(d.amount),0) INTO v_available
   FROM customer_payment_receipts r LEFT JOIN procurement_funding_allocations a ON a.customer_payment_receipt_id=r.id LEFT JOIN procurement_funding_deallocations d ON d.allocation_id=a.id
  WHERE r.commercial_commitment_id=p_commitment AND r.status='VERIFIED' AND r.currency_code=v_currency;
 v_customer:=LEAST(v_total,GREATEST(v_available,0)); v_internal:=v_total-v_customer;
 IF v_internal>0 AND NOT EXISTS(SELECT 1 FROM internal_funding_authorizations a WHERE a.supplier_funding_requirement_id=v_req AND a.status='AUTHORIZED' AND a.currency_code=v_currency AND a.amount_approved>=v_internal) THEN RAISE EXCEPTION 'PROCUREMENT_FUNDING_NOT_AVAILABLE'; END IF;
 PERFORM set_config('app.procurement_release_gateway','true',true);
 INSERT INTO procurement_releases(id,commercial_commitment_id,partner_company_id,status,total_required,currency_code,executed_by,executed_at,correlation_id) VALUES(v_release,p_commitment,v_company,'PROCUREMENT_RELEASED',v_total,v_currency,p_actor,now(),NULLIF(p_correlation,'')::uuid);
 FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
   SELECT * INTO v_snapshot FROM approved_purchase_cost_snapshots WHERE id=(v_line->>'approvedPurchaseCostSnapshotId')::uuid;
   INSERT INTO procurement_release_lines(release_id,commercial_commitment_line_id,product_identity_id,released_quantity,unit_id,approved_purchase_cost_snapshot_id,purchase_source_id,supplier_company_id,supplier_reconfirmation_id,currency_code,unit_purchase_cost) VALUES(v_release,(v_line->>'commercialCommitmentLineId')::uuid,(v_line->>'productIdentityId')::uuid,(v_line->>'quantity')::numeric,(v_line->>'unitId')::uuid,v_snapshot.id,v_snapshot.purchase_source_id,v_snapshot.supplier_company_id,NULLIF(v_line->>'supplierReconfirmationId','')::uuid,v_snapshot.currency_code,v_snapshot.unit_purchase_cost);
 END LOOP;
 v_need:=v_customer;
 FOR v_receipt IN SELECT r.id,r.amount FROM customer_payment_receipts r WHERE r.commercial_commitment_id=p_commitment AND r.status='VERIFIED' AND r.currency_code=v_currency ORDER BY r.id FOR UPDATE LOOP
   EXIT WHEN v_need<=0;
   SELECT COALESCE(sum(a.amount),0)-COALESCE(sum(d.amount),0) INTO v_allocated FROM procurement_funding_allocations a LEFT JOIN procurement_funding_deallocations d ON d.allocation_id=a.id WHERE a.customer_payment_receipt_id=v_receipt.id;
   v_alloc:=LEAST(v_need,GREATEST(v_receipt.amount-v_allocated,0));
   IF v_alloc>0 THEN INSERT INTO procurement_funding_allocations(release_id,allocation_type,customer_payment_receipt_id,amount,currency_code) VALUES(v_release,'CUSTOMER_VERIFIED',v_receipt.id,v_alloc,v_currency); v_need:=v_need-v_alloc; END IF;
 END LOOP;
 IF v_need>0 THEN RAISE EXCEPTION 'PROCUREMENT_FUNDING_NOT_AVAILABLE'; END IF;
 v_need:=v_internal;
 FOR v_auth IN SELECT a.id,a.amount_approved FROM internal_funding_authorizations a WHERE a.supplier_funding_requirement_id=v_req AND a.status='AUTHORIZED' AND a.currency_code=v_currency ORDER BY a.id FOR UPDATE LOOP
   EXIT WHEN v_need<=0;
   SELECT COALESCE(sum(x.amount),0)-COALESCE(sum(d.amount),0) INTO v_allocated FROM procurement_funding_allocations x LEFT JOIN procurement_funding_deallocations d ON d.allocation_id=x.id WHERE x.internal_funding_authorization_id=v_auth.id;
   v_alloc:=LEAST(v_need,GREATEST(v_auth.amount_approved-v_allocated,0));
   IF v_alloc>0 THEN INSERT INTO procurement_funding_allocations(release_id,allocation_type,internal_funding_authorization_id,amount,currency_code) VALUES(v_release,'SCO_INTERNAL',v_auth.id,v_alloc,v_currency); v_need:=v_need-v_alloc; END IF;
 END LOOP;
 IF v_need>0 THEN RAISE EXCEPTION 'PROCUREMENT_FUNDING_NOT_AVAILABLE'; END IF;
 INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','procurement_release.executed','ProcurementRelease',v_release,jsonb_build_object('commitmentId',p_commitment,'totalRequired',v_total),NULLIF(p_correlation,'')::uuid);
 RETURN v_release;
END $$;

CREATE OR REPLACE FUNCTION public.internal_procurement_release_withdraw(p_actor uuid,p_release uuid,p_reason text,p_correlation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE v_status "ProcurementReleaseStatus"; v_alloc record; BEGIN IF NOT public.internal_has_capability(p_actor,'procurement_release.withdraw') THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_WITHDRAW_FORBIDDEN'; END IF; IF btrim(COALESCE(p_reason,''))='' THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_WITHDRAW_REASON_REQUIRED'; END IF; SELECT status INTO v_status FROM procurement_releases WHERE id=p_release FOR UPDATE; IF v_status IS NULL THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_NOT_FOUND'; END IF; IF v_status<>'PROCUREMENT_RELEASED' THEN RAISE EXCEPTION 'PROCUREMENT_RELEASE_NOT_WITHDRAWABLE'; END IF; PERFORM set_config('app.procurement_release_gateway','true',true); UPDATE procurement_releases SET status='WITHDRAWN',withdrawn_by=p_actor,withdrawn_at=now(),withdrawal_reason=p_reason WHERE id=p_release; FOR v_alloc IN SELECT * FROM procurement_funding_allocations WHERE release_id=p_release ORDER BY id FOR UPDATE LOOP IF NOT EXISTS(SELECT 1 FROM procurement_funding_deallocations WHERE allocation_id=v_alloc.id) THEN INSERT INTO procurement_funding_deallocations(allocation_id,release_id,amount,reason,deallocated_by,correlation_id) VALUES(v_alloc.id,p_release,v_alloc.amount,p_reason,p_actor,NULLIF(p_correlation,'')::uuid); END IF; END LOOP; INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','procurement_release.withdrawn','ProcurementRelease',p_release,jsonb_build_object('reason',p_reason),NULLIF(p_correlation,'')::uuid); END $$;
