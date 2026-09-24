CREATE OR REPLACE FUNCTION public.internal_supplier_po_issue(p_actor uuid,p_po uuid,p_correlation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_po record; v_line record; v_allocation record; v_release record; v_source record; v_reconfirm record; v_open numeric; v_need numeric; v_bound numeric; v_funding record; v_total numeric:=0; v_limit numeric; v_actual numeric; v_issued_strategic numeric; v_current_qty numeric; v_issued_qty numeric;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'supplier_po.issue') THEN RAISE EXCEPTION 'SUPPLIER_PO_ISSUE_FORBIDDEN'; END IF;
  SELECT * INTO v_po FROM supplier_purchase_orders WHERE id=p_po FOR UPDATE;
  IF v_po.id IS NULL OR v_po.status<>'DRAFT' THEN RAISE EXCEPTION 'SUPPLIER_PO_NOT_ISSUABLE'; END IF;
  IF v_po.currency_code<>'SAR' THEN RAISE EXCEPTION 'SUPPLIER_PO_FINANCIAL_CURRENCY_UNSUPPORTED'; END IF;
  SELECT max_issue_amount_sar INTO v_limit FROM supplier_po_financial_authorities WHERE actor_user_id=p_actor AND active FOR UPDATE;
  IF v_limit IS NULL THEN RAISE EXCEPTION 'SUPPLIER_PO_FINANCIAL_AUTHORITY_REQUIRED'; END IF;
  SELECT s.*,q.id AS qualification_id INTO v_source FROM purchase_sources s JOIN supplier_qualifications q ON q.company_id=s.supplier_company_id AND q.status IN ('APPROVED','ACTIVE') WHERE s.id=v_po.purchase_source_id AND s.status='ACTIVE' FOR SHARE;
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'PURCHASE_SOURCE_NOT_USABLE'; END IF;

  -- Lock every current release line in deterministic order and validate the aggregate set.
  FOR v_release IN
    SELECT rl.id,rl.released_quantity
    FROM procurement_release_lines rl
    JOIN supplier_po_release_line_allocations pa ON pa.procurement_release_line_id=rl.id
    JOIN supplier_purchase_order_lines pl ON pl.id=pa.supplier_purchase_order_line_id
    WHERE pl.supplier_purchase_order_id=p_po
    GROUP BY rl.id,rl.released_quantity
    ORDER BY rl.id
    FOR UPDATE
  LOOP
    SELECT COALESCE(sum(pa.allocated_quantity),0) INTO v_current_qty
      FROM supplier_po_release_line_allocations pa
      JOIN supplier_purchase_order_lines pl ON pl.id=pa.supplier_purchase_order_line_id
      WHERE pl.supplier_purchase_order_id=p_po AND pa.procurement_release_line_id=v_release.id;
    SELECT COALESCE(sum(pa.allocated_quantity),0) INTO v_issued_qty
      FROM supplier_po_release_line_allocations pa
      JOIN supplier_purchase_order_lines pl ON pl.id=pa.supplier_purchase_order_line_id
      JOIN supplier_purchase_orders prior_po ON prior_po.id=pl.supplier_purchase_order_id AND prior_po.status='ISSUED'
      WHERE pa.procurement_release_line_id=v_release.id AND prior_po.id<>p_po;
    IF v_issued_qty+v_current_qty>v_release.released_quantity THEN RAISE EXCEPTION 'SUPPLIER_PO_RELEASE_QUANTITY_EXCEEDED'; END IF;
  END LOOP;

  FOR v_line IN SELECT l.*,pi.category_id FROM supplier_purchase_order_lines l JOIN product_identities pi ON pi.id=l.product_identity_id WHERE l.supplier_purchase_order_id=p_po ORDER BY l.id FOR UPDATE LOOP
    IF NOT EXISTS(SELECT 1 FROM supplier_category_capabilities c WHERE c.supplier_partnership_id=v_source.supplier_partnership_id AND c.category_id=v_line.category_id AND c.status='ACTIVE') THEN RAISE EXCEPTION 'PURCHASE_SOURCE_NOT_CAPABLE'; END IF;
    IF v_line.supplier_reconfirmation_id IS NOT NULL THEN
      SELECT * INTO v_reconfirm FROM supplier_reconfirmations WHERE id=v_line.supplier_reconfirmation_id AND purchase_source_id=v_po.purchase_source_id AND product_identity_id=v_line.product_identity_id FOR SHARE;
      IF v_reconfirm.id IS NULL OR v_reconfirm.currency_code<>v_po.currency_code OR v_reconfirm.confirmed_purchase_price<>v_line.actual_unit_purchase_cost OR v_reconfirm.confirmed_available_quantity<v_line.ordered_quantity OR (v_reconfirm.valid_until IS NOT NULL AND v_reconfirm.valid_until<current_date) THEN RAISE EXCEPTION 'SUPPLIER_PO_PRICE_EVIDENCE_INVALID'; END IF;
    END IF;
    IF v_line.demand_origin='STRATEGIC_OVERBUY' THEN
      IF NOT EXISTS(SELECT 1 FROM strategic_overbuy_authorizations a WHERE a.id=v_line.strategic_overbuy_authorization_id AND a.purchase_source_id=v_po.purchase_source_id AND a.product_identity_id=v_line.product_identity_id AND a.unit_id=v_line.unit_id AND a.currency_code=v_po.currency_code AND a.max_unit_purchase_cost>=v_line.actual_unit_purchase_cost FOR UPDATE) THEN RAISE EXCEPTION 'STRATEGIC_OVERBUY_INVALID'; END IF;
      SELECT COALESCE(sum(x.ordered_quantity) FILTER (WHERE xp.status='ISSUED'),0) INTO v_issued_strategic FROM supplier_purchase_order_lines x JOIN supplier_purchase_orders xp ON xp.id=x.supplier_purchase_order_id WHERE x.strategic_overbuy_authorization_id=v_line.strategic_overbuy_authorization_id;
      IF v_line.ordered_quantity>COALESCE((SELECT authorized_quantity FROM strategic_overbuy_authorizations WHERE id=v_line.strategic_overbuy_authorization_id FOR UPDATE),0)-v_issued_strategic THEN RAISE EXCEPTION 'STRATEGIC_OVERBUY_QUANTITY_EXCEEDED'; END IF;
      v_total:=v_total+v_line.ordered_quantity*v_line.actual_unit_purchase_cost;
      CONTINUE;
    END IF;
    FOR v_allocation IN SELECT * FROM supplier_po_release_line_allocations WHERE supplier_purchase_order_line_id=v_line.id ORDER BY procurement_release_line_id FOR UPDATE LOOP
      SELECT rl.*,r.status AS release_status INTO v_release FROM procurement_release_lines rl JOIN procurement_releases r ON r.id=rl.release_id WHERE rl.id=v_allocation.procurement_release_line_id FOR UPDATE;
      IF v_release.id IS NULL OR v_release.release_status<>'PROCUREMENT_RELEASED' OR v_release.product_identity_id<>v_line.product_identity_id OR v_release.unit_id<>v_line.unit_id THEN RAISE EXCEPTION 'SUPPLIER_PO_RELEASE_LINE_INVALID'; END IF;
      v_open:=v_release.released_quantity-COALESCE((SELECT sum(a.allocated_quantity) FROM supplier_po_release_line_allocations a JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id WHERE a.procurement_release_line_id=v_release.id AND (p.status='ISSUED' OR p.id=p_po)),0)+COALESCE((SELECT sum(a.allocated_quantity) FROM supplier_po_release_line_allocations a JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id WHERE a.procurement_release_line_id=v_release.id AND p.id=p_po),0);
      IF v_allocation.allocated_quantity>v_open THEN RAISE EXCEPTION 'SUPPLIER_PO_RELEASE_QUANTITY_EXCEEDED'; END IF;
      IF v_line.actual_unit_purchase_cost>v_allocation.approved_unit_purchase_cost THEN RAISE EXCEPTION 'SUPPLIER_PO_COST_ABOVE_APPROVED_BASIS'; END IF;
      IF v_line.supplier_reconfirmation_id IS NULL AND (v_po.purchase_source_id<>v_allocation.original_purchase_source_id OR v_line.actual_unit_purchase_cost<>v_allocation.approved_unit_purchase_cost OR EXISTS(SELECT 1 FROM approved_purchase_cost_snapshots s JOIN supplier_quote_revisions q ON q.id=s.supplier_quote_revision_id WHERE s.id=v_allocation.approved_purchase_cost_snapshot_id AND q.valid_until IS NOT NULL AND q.valid_until<current_date)) THEN RAISE EXCEPTION 'SUPPLIER_PO_PRICE_EVIDENCE_REQUIRED'; END IF;
      v_need:=v_allocation.allocated_quantity*v_allocation.approved_unit_purchase_cost;
      FOR v_funding IN SELECT f.* FROM procurement_funding_allocations f WHERE f.release_id=v_release.release_id ORDER BY f.id FOR UPDATE LOOP
        EXIT WHEN v_need<=0;
        SELECT COALESCE(sum(b.bound_amount),0) INTO v_bound FROM supplier_po_coverage_bindings b JOIN supplier_po_release_line_allocations a ON a.id=b.supplier_po_release_line_allocation_id JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id WHERE b.procurement_funding_allocation_id=v_funding.id AND (p.status='ISSUED' OR p.id=p_po);
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

REVOKE ALL ON FUNCTION public.internal_supplier_po_issue(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_po_issue(uuid,uuid,text) TO sco_internal_executor;
