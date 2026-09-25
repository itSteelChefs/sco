CREATE OR REPLACE FUNCTION public.internal_supplier_po_commercial_document_verify(p_actor uuid,p_document uuid,p_facts jsonb,p_correlation text)
RETURNS TABLE(id uuid,result text,mismatch_reasons text[]) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_doc record;
  v_po_line record;
  v_reasons text[] := '{}';
  v_expected numeric;
  v_lines jsonb;
  v_line_fact jsonb;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'supplier_po.commercial_document.verify') THEN RAISE EXCEPTION 'SUPPLIER_PO_COMMERCIAL_DOCUMENT_VERIFY_FORBIDDEN'; END IF;
  SELECT commercial_doc.*, purchase_order.purchase_source_id, purchase_order.currency_code INTO v_doc
  FROM supplier_po_commercial_documents commercial_doc
  JOIN supplier_purchase_orders purchase_order ON purchase_order.id=commercial_doc.supplier_purchase_order_id
  WHERE commercial_doc.id=p_document AND purchase_order.status='ISSUED';
  IF v_doc.id IS NULL THEN RAISE EXCEPTION 'SUPPLIER_PO_COMMERCIAL_DOCUMENT_NOT_ISSUABLE'; END IF;
  IF NOT (public.internal_has_capability(p_actor,'supplier_po.read_all') OR EXISTS(SELECT 1 FROM supplier_purchase_order_lines po_line JOIN product_identities product ON product.id=po_line.product_identity_id JOIN procurement_engineer_scope_assignments scope_assignment ON scope_assignment.actor_user_id=p_actor AND scope_assignment.purchase_source_id=v_doc.purchase_source_id AND scope_assignment.product_category_id=product.category_id AND scope_assignment.status='ACTIVE' WHERE po_line.supplier_purchase_order_id=v_doc.supplier_purchase_order_id) OR EXISTS(SELECT 1 FROM supplier_po_line_responsibilities responsibility JOIN supplier_purchase_order_lines po_line ON po_line.id=responsibility.supplier_purchase_order_line_id WHERE responsibility.actor_user_id=p_actor AND po_line.supplier_purchase_order_id=v_doc.supplier_purchase_order_id)) THEN RAISE EXCEPTION 'SUPPLIER_PO_COMMERCIAL_DOCUMENT_SCOPE_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM document_versions version_row WHERE version_row.id=v_doc.document_version_id AND version_row.document_id=v_doc.document_id) THEN RAISE EXCEPTION 'SUPPLIER_PO_DOCUMENT_VERSION_INVALID'; END IF;
  IF p_facts->>'purchaseSourceId' IS NULL OR p_facts->>'currency' IS NULL OR jsonb_typeof(p_facts->'lines')<>'array' OR p_facts->>'totalAmount' IS NULL THEN v_reasons:=array_append(v_reasons,'OTHER'); END IF;
  IF p_facts->>'purchaseSourceId' IS DISTINCT FROM v_doc.purchase_source_id::text THEN v_reasons:=array_append(v_reasons,'OTHER'); END IF;
  IF p_facts->>'currency' IS DISTINCT FROM v_doc.currency_code THEN v_reasons:=array_append(v_reasons,'CURRENCY'); END IF;
  IF COALESCE(p_facts->>'commercialBasis','')<>'PO_PURCHASE_COST' THEN v_reasons:=array_append(v_reasons,'COMMERCIAL_TERMS_OR_BASIS'); END IF;
  SELECT COALESCE(sum(po_line.ordered_quantity*po_line.actual_unit_purchase_cost),0) INTO v_expected FROM supplier_purchase_order_lines po_line WHERE po_line.supplier_purchase_order_id=v_doc.supplier_purchase_order_id;
  IF (p_facts->>'totalAmount')::numeric IS DISTINCT FROM v_expected THEN v_reasons:=array_append(v_reasons,'AMOUNT'); END IF;
  v_lines:=p_facts->'lines';
  FOR v_po_line IN SELECT * FROM supplier_purchase_order_lines po_line WHERE po_line.supplier_purchase_order_id=v_doc.supplier_purchase_order_id LOOP
    SELECT fact INTO v_line_fact FROM jsonb_array_elements(v_lines) fact WHERE fact->>'lineId'=v_po_line.id::text LIMIT 1;
    IF v_line_fact IS NULL THEN v_reasons:=array_append(v_reasons,'LINE'); CONTINUE; END IF;
    IF (v_line_fact->>'productIdentityId')::uuid IS DISTINCT FROM v_po_line.product_identity_id THEN v_reasons:=array_append(v_reasons,'PRODUCT_IDENTITY'); END IF;
    IF (v_line_fact->>'unitId')::uuid IS DISTINCT FROM v_po_line.unit_id THEN v_reasons:=array_append(v_reasons,'OTHER'); END IF;
    IF (v_line_fact->>'quantity')::numeric IS DISTINCT FROM v_po_line.ordered_quantity THEN v_reasons:=array_append(v_reasons,'QUANTITY'); END IF;
    IF (v_line_fact->>'unitPurchaseCost')::numeric IS DISTINCT FROM v_po_line.actual_unit_purchase_cost THEN v_reasons:=array_append(v_reasons,'AMOUNT'); END IF;
  END LOOP;
  IF COALESCE((p_facts->>'taxAmount')::numeric,0)<>0 THEN v_reasons:=array_append(v_reasons,'TAX_OR_APPROVED_CHARGES'); END IF;
  INSERT INTO supplier_po_commercial_document_verifications(commercial_document_id,document_version_id,supplier_purchase_order_id,result,declared_facts,compared_facts,mismatch_reasons,mismatch_details,verified_by,correlation_id) VALUES(p_document,v_doc.document_version_id,v_doc.supplier_purchase_order_id,CASE WHEN cardinality(v_reasons)=0 THEN 'MATCHED' ELSE 'MISMATCH' END,p_facts,jsonb_build_object('purchaseSourceId',v_doc.purchase_source_id,'currency',v_doc.currency_code,'expectedTotal',v_expected),v_reasons,jsonb_build_object('reasons',v_reasons),p_actor,NULLIF(p_correlation,'')::uuid) RETURNING supplier_po_commercial_document_verifications.id, supplier_po_commercial_document_verifications.result, supplier_po_commercial_document_verifications.mismatch_reasons INTO id,result,mismatch_reasons;
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.commercial_document.verified','SupplierPOCommercialDocumentVerification',id,jsonb_build_object('result',result,'documentVersionId',v_doc.document_version_id,'mismatchReasons',mismatch_reasons),NULLIF(p_correlation,'')::uuid);
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.internal_supplier_po_commercial_document_verify(uuid,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_po_commercial_document_verify(uuid,uuid,jsonb,text) TO sco_internal_executor;
