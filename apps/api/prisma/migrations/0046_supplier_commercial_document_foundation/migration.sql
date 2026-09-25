DROP POLICY IF EXISTS document_version_tenant ON document_versions;
CREATE POLICY document_version_tenant ON document_versions FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM documents d WHERE d.id=document_versions.document_id AND d.access_scope='TENANT' AND d.company_id=NULLIF(current_setting('app.tenant_id',true)::text,'')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM documents d WHERE d.id=document_versions.document_id AND d.access_scope='TENANT' AND d.company_id=NULLIF(current_setting('app.tenant_id',true)::text,'')::uuid));

CREATE TABLE supplier_po_commercial_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_purchase_order_id UUID NOT NULL REFERENCES supplier_purchase_orders(id),
  document_id UUID NOT NULL REFERENCES documents(id),
  document_version_id UUID NOT NULL REFERENCES document_versions(id),
  document_type TEXT NOT NULL CHECK(document_type IN ('SUPPLIER_PROFORMA','SUPPLIER_INVOICE','SUPPLIER_COMMERCIAL_SUPPORTING')),
  classification TEXT NOT NULL CHECK(classification IN ('SCO_INTERNAL_PRIVATE','SCO_INTERNAL_SHAREABLE_LATER')),
  registered_by UUID NOT NULL REFERENCES "User"(id),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID,
  UNIQUE(supplier_purchase_order_id,document_version_id)
);

CREATE TABLE supplier_po_commercial_document_line_coverage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_document_id UUID NOT NULL REFERENCES supplier_po_commercial_documents(id),
  supplier_purchase_order_line_id UUID NOT NULL REFERENCES supplier_purchase_order_lines(id),
  covered_quantity NUMERIC(18,4) CHECK(covered_quantity IS NULL OR covered_quantity>0),
  created_by UUID NOT NULL REFERENCES "User"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID,
  UNIQUE(commercial_document_id,supplier_purchase_order_line_id)
);

CREATE INDEX supplier_po_commercial_documents_po_idx ON supplier_po_commercial_documents(supplier_purchase_order_id);
CREATE INDEX supplier_po_commercial_documents_version_idx ON supplier_po_commercial_documents(document_version_id);

INSERT INTO "Permission"(id,code,description)
SELECT gen_random_uuid(),v.code,v.description FROM (VALUES
 ('supplier_po.commercial_document.read','Read scoped supplier commercial documents'),
 ('supplier_po.commercial_document.register','Register supplier commercial documents')
) v(code,description) WHERE NOT EXISTS (SELECT 1 FROM "Permission" p WHERE p.code=v.code);

CREATE OR REPLACE FUNCTION public.prevent_supplier_po_commercial_document_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SUPPLIER_PO_COMMERCIAL_DOCUMENT_IMMUTABLE'; END $$;
CREATE TRIGGER supplier_po_commercial_documents_immutable BEFORE UPDATE OR DELETE ON supplier_po_commercial_documents FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_po_commercial_document_mutation();
CREATE TRIGGER supplier_po_commercial_document_coverage_immutable BEFORE UPDATE OR DELETE ON supplier_po_commercial_document_line_coverage FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_po_commercial_document_mutation();

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['supplier_po_commercial_documents','supplier_po_commercial_document_line_coverage'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t); EXECUTE format('REVOKE ALL ON %I FROM sco_runtime,sco_internal_executor',t); END LOOP; END $$;

CREATE OR REPLACE FUNCTION public.internal_supplier_po_commercial_document_register(p_actor uuid,p_po uuid,p_document uuid,p_version uuid,p_type text,p_classification text,p_correlation text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_source uuid; v_category uuid; v_id uuid;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'supplier_po.commercial_document.register') THEN RAISE EXCEPTION 'SUPPLIER_PO_COMMERCIAL_DOCUMENT_FORBIDDEN'; END IF;
  SELECT p.purchase_source_id,pi.category_id INTO v_source,v_category FROM supplier_purchase_orders p JOIN supplier_purchase_order_lines l ON l.supplier_purchase_order_id=p.id JOIN product_identities pi ON pi.id=l.product_identity_id WHERE p.id=p_po AND p.status='ISSUED' LIMIT 1;
  IF v_source IS NULL OR NOT (EXISTS(SELECT 1 FROM procurement_engineer_scope_assignments s WHERE s.actor_user_id=p_actor AND s.purchase_source_id=v_source AND s.product_category_id=v_category AND s.status='ACTIVE') OR EXISTS(SELECT 1 FROM supplier_po_line_responsibilities r JOIN supplier_purchase_order_lines l ON l.id=r.supplier_purchase_order_line_id WHERE r.actor_user_id=p_actor AND l.supplier_purchase_order_id=p_po) OR public.internal_has_capability(p_actor,'supplier_po.read_all')) THEN RAISE EXCEPTION 'SUPPLIER_PO_COMMERCIAL_DOCUMENT_SCOPE_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM documents d JOIN document_versions v ON v.document_id=d.id WHERE d.id=p_document AND v.id=p_version AND d.access_scope='SCO_INTERNAL') THEN RAISE EXCEPTION 'SUPPLIER_PO_COMMERCIAL_DOCUMENT_PRIVATE_REQUIRED'; END IF;
  IF p_type NOT IN ('SUPPLIER_PROFORMA','SUPPLIER_INVOICE','SUPPLIER_COMMERCIAL_SUPPORTING') OR p_classification NOT IN ('SCO_INTERNAL_PRIVATE','SCO_INTERNAL_SHAREABLE_LATER') THEN RAISE EXCEPTION 'SUPPLIER_PO_COMMERCIAL_DOCUMENT_INVALID'; END IF;
  PERFORM set_config('app.supplier_po_commercial_document_gateway','true',true);
  INSERT INTO supplier_po_commercial_documents(supplier_purchase_order_id,document_id,document_version_id,document_type,classification,registered_by,correlation_id) VALUES(p_po,p_document,p_version,p_type,p_classification,p_actor,NULLIF(p_correlation,'')::uuid) RETURNING id INTO v_id;
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,'SCO_INTERNAL','supplier_po.commercial_document.registered','SupplierPOCommercialDocument',v_id,jsonb_build_object('purchaseOrderId',p_po,'documentType',p_type,'classification',p_classification),NULLIF(p_correlation,'')::uuid);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_supplier_po_commercial_document_coverage_set(p_actor uuid,p_document uuid,p_line uuid,p_quantity numeric,p_correlation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor,'supplier_po.commercial_document.register') THEN RAISE EXCEPTION 'SUPPLIER_PO_COMMERCIAL_DOCUMENT_FORBIDDEN'; END IF;
  IF NOT EXISTS(SELECT 1 FROM supplier_po_commercial_documents d JOIN supplier_purchase_order_lines l ON l.supplier_purchase_order_id=d.supplier_purchase_order_id WHERE d.id=p_document AND l.id=p_line) THEN RAISE EXCEPTION 'SUPPLIER_PO_COMMERCIAL_DOCUMENT_LINE_INVALID'; END IF;
  PERFORM set_config('app.supplier_po_commercial_document_gateway','true',true);
  INSERT INTO supplier_po_commercial_document_line_coverage(commercial_document_id,supplier_purchase_order_line_id,covered_quantity,created_by,correlation_id) VALUES(p_document,p_line,p_quantity,p_actor,NULLIF(p_correlation,'')::uuid);
END $$;

CREATE OR REPLACE FUNCTION public.internal_supplier_po_commercial_document_get(p_actor uuid,p_document uuid) RETURNS TABLE(document_id uuid,document_version_id uuid,supplier_purchase_order_id uuid,document_type text,classification text,covered_line_id uuid,covered_quantity numeric) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT d.document_id,d.document_version_id,d.supplier_purchase_order_id,d.document_type,d.classification,c.supplier_purchase_order_line_id,c.covered_quantity FROM supplier_po_commercial_documents d LEFT JOIN supplier_po_commercial_document_line_coverage c ON c.commercial_document_id=d.id JOIN supplier_purchase_orders p ON p.id=d.supplier_purchase_order_id WHERE d.id=p_document AND public.internal_has_capability(p_actor,'supplier_po.commercial_document.read') AND (public.internal_has_capability(p_actor,'supplier_po.read_all') OR EXISTS(SELECT 1 FROM supplier_purchase_order_lines l JOIN product_identities pi ON pi.id=l.product_identity_id JOIN procurement_engineer_scope_assignments s ON s.actor_user_id=p_actor AND s.purchase_source_id=p.purchase_source_id AND s.product_category_id=pi.category_id AND s.status='ACTIVE' WHERE l.supplier_purchase_order_id=p.id) OR EXISTS(SELECT 1 FROM supplier_po_line_responsibilities r JOIN supplier_purchase_order_lines l ON l.id=r.supplier_purchase_order_line_id WHERE r.actor_user_id=p_actor AND l.supplier_purchase_order_id=p.id))
$$;

REVOKE ALL ON FUNCTION public.internal_supplier_po_commercial_document_register(uuid,uuid,uuid,uuid,text,text,text), public.internal_supplier_po_commercial_document_coverage_set(uuid,uuid,uuid,numeric,text), public.internal_supplier_po_commercial_document_get(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_po_commercial_document_register(uuid,uuid,uuid,uuid,text,text,text), public.internal_supplier_po_commercial_document_coverage_set(uuid,uuid,uuid,numeric,text), public.internal_supplier_po_commercial_document_get(uuid,uuid) TO sco_internal_executor;
