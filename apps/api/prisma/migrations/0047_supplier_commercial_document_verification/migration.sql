CREATE TABLE supplier_po_commercial_document_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_document_id UUID NOT NULL REFERENCES supplier_po_commercial_documents(id),
  document_version_id UUID NOT NULL REFERENCES document_versions(id),
  supplier_purchase_order_id UUID NOT NULL REFERENCES supplier_purchase_orders(id),
  result TEXT NOT NULL CHECK(result IN ('MATCHED','MISMATCH')),
  declared_facts JSONB NOT NULL,
  compared_facts JSONB NOT NULL,
  mismatch_reasons TEXT[] NOT NULL DEFAULT '{}',
  mismatch_details JSONB NOT NULL DEFAULT '{}',
  verified_by UUID NOT NULL REFERENCES "User"(id),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID
);
CREATE INDEX supplier_po_document_verification_doc_idx ON supplier_po_commercial_document_verifications(commercial_document_id,verified_at);
ALTER TABLE supplier_po_commercial_document_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_po_commercial_document_verifications FORCE ROW LEVEL SECURITY;
REVOKE ALL ON supplier_po_commercial_document_verifications FROM sco_runtime,sco_internal_executor;
INSERT INTO "Permission"(id,code,description) SELECT gen_random_uuid(),'supplier_po.commercial_document.verify','Verify supplier commercial documents' WHERE NOT EXISTS(SELECT 1 FROM "Permission" WHERE code='supplier_po.commercial_document.verify');
CREATE OR REPLACE FUNCTION public.prevent_supplier_po_document_verification_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SUPPLIER_PO_DOCUMENT_VERIFICATION_IMMUTABLE'; END $$;
CREATE TRIGGER supplier_po_document_verification_immutable BEFORE UPDATE OR DELETE ON supplier_po_commercial_document_verifications FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_po_document_verification_mutation();

CREATE OR REPLACE FUNCTION public.internal_supplier_po_commercial_document_verify(p_actor uuid,p_document uuid,p_facts jsonb,p_correlation text)
RETURNS TABLE(id uuid,result text,mismatch_reasons text[]) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d record; l record; v_reasons text[]:='{}'; v_expected numeric; v_lines jsonb; v_line jsonb; v_found boolean;
BEGIN
 IF NOT public.internal_has_capability(p_actor,'supplier_po.commercial_document.verify') THEN RAISE EXCEPTION 'SUPPLIER_PO_COMMERCIAL_DOCUMENT_VERIFY_FORBIDDEN'; END IF;
 SELECT d.*,p.purchase_source_id,p.currency_code INTO d FROM supplier_po_commercial_documents d JOIN supplier_purchase_orders p ON p.id=d.supplier_purchase_order_id WHERE d.id=p_document AND p.status='ISSUED';
 IF d.id IS NULL THEN RAISE EXCEPTION 'SUPPLIER_PO_COMMERCIAL_DOCUMENT_NOT_ISSUABLE'; END IF;
 IF NOT (public.internal_has_capability(p_actor,'supplier_po.read_all') OR EXISTS(SELECT 1 FROM supplier_purchase_order_lines l JOIN product_identities pi ON pi.id=l.product_identity_id JOIN procurement_engineer_scope_assignments s ON s.actor_user_id=p_actor AND s.purchase_source_id=d.purchase_source_id AND s.product_category_id=pi.category_id AND s.status='ACTIVE' WHERE l.supplier_purchase_order_id=d.supplier_purchase_order_id) OR EXISTS(SELECT 1 FROM supplier_po_line_responsibilities r JOIN supplier_purchase_order_lines l ON l.id=r.supplier_purchase_order_line_id WHERE r.actor_user_id=p_actor AND l.supplier_purchase_order_id=d.supplier_purchase_order_id)) THEN RAISE EXCEPTION 'SUPPLIER_PO_COMMERCIAL_DOCUMENT_SCOPE_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM document_versions v WHERE v.id=d.document_version_id AND v.document_id=d.document_id) THEN RAISE EXCEPTION 'SUPPLIER_PO_DOCUMENT_VERSION_INVALID'; END IF;
 IF p_facts->>'purchaseSourceId' IS NULL OR p_facts->>'currency' IS NULL OR jsonb_typeof(p_facts->'lines')<>'array' OR p_facts->>'totalAmount' IS NULL THEN v_reasons:=array_append(v_reasons,'OTHER'); END IF;
 IF p_facts->>'purchaseSourceId' IS DISTINCT FROM d.purchase_source_id::text THEN v_reasons:=array_append(v_reasons,'OTHER'); END IF;
 IF p_facts->>'currency' IS DISTINCT FROM d.currency_code THEN v_reasons:=array_append(v_reasons,'CURRENCY'); END IF;
 IF COALESCE(p_facts->>'commercialBasis','')<>'PO_PURCHASE_COST' THEN v_reasons:=array_append(v_reasons,'COMMERCIAL_TERMS_OR_BASIS'); END IF;
 SELECT COALESCE(sum(l.ordered_quantity*l.actual_unit_purchase_cost),0) INTO v_expected FROM supplier_purchase_order_lines l WHERE l.supplier_purchase_order_id=d.supplier_purchase_order_id;
 IF (p_facts->>'totalAmount')::numeric IS DISTINCT FROM v_expected THEN v_reasons:=array_append(v_reasons,'AMOUNT'); END IF;
 v_lines:=p_facts->'lines';
 FOR l IN SELECT * FROM supplier_purchase_order_lines WHERE supplier_purchase_order_id=d.supplier_purchase_order_id LOOP
   SELECT x INTO v_line FROM jsonb_array_elements(v_lines) x WHERE x->>'lineId'=l.id::text LIMIT 1;
   IF v_line IS NULL THEN v_reasons:=array_append(v_reasons,'LINE'); CONTINUE; END IF;
   IF (v_line->>'productIdentityId')::uuid IS DISTINCT FROM l.product_identity_id THEN v_reasons:=array_append(v_reasons,'PRODUCT_IDENTITY'); END IF;
   IF (v_line->>'unitId')::uuid IS DISTINCT FROM l.unit_id THEN v_reasons:=array_append(v_reasons,'OTHER'); END IF;
   IF (v_line->>'quantity')::numeric IS DISTINCT FROM l.ordered_quantity THEN v_reasons:=array_append(v_reasons,'QUANTITY'); END IF;
   IF (v_line->>'unitPurchaseCost')::numeric IS DISTINCT FROM l.actual_unit_purchase_cost THEN v_reasons:=array_append(v_reasons,'AMOUNT'); END IF;
 END LOOP;
 IF COALESCE((p_facts->>'taxAmount')::numeric,0)<>0 THEN v_reasons:=array_append(v_reasons,'TAX_OR_APPROVED_CHARGES'); END IF;
 INSERT INTO supplier_po_commercial_document_verifications(commercial_document_id,document_version_id,supplier_purchase_order_id,result,declared_facts,compared_facts,mismatch_reasons,mismatch_details,verified_by,correlation_id) VALUES(p_document,d.document_version_id,d.supplier_purchase_order_id,CASE WHEN cardinality(v_reasons)=0 THEN 'MATCHED' ELSE 'MISMATCH' END,p_facts,jsonb_build_object('purchaseSourceId',d.purchase_source_id,'currency',d.currency_code,'expectedTotal',v_expected),v_reasons,jsonb_build_object('reasons',v_reasons),p_actor,NULLIF(p_correlation,'')::uuid) RETURNING supplier_po_commercial_document_verifications.id, supplier_po_commercial_document_verifications.result, supplier_po_commercial_document_verifications.mismatch_reasons INTO id,result,mismatch_reasons;
 INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.commercial_document.verified','SupplierPOCommercialDocumentVerification',id,jsonb_build_object('result',result,'documentVersionId',d.document_version_id,'mismatchReasons',mismatch_reasons),NULLIF(p_correlation,'')::uuid);
 RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.internal_supplier_po_commercial_document_verify(uuid,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_po_commercial_document_verify(uuid,uuid,jsonb,text) TO sco_internal_executor;
