ALTER TABLE documents ADD COLUMN access_scope TEXT NOT NULL DEFAULT 'TENANT' CHECK (access_scope IN ('TENANT','SCO_INTERNAL'));

DROP POLICY document_tenant ON documents;
CREATE POLICY document_tenant ON documents FOR ALL TO sco_runtime
  USING (access_scope='TENANT' AND company_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid)
  WITH CHECK (access_scope='TENANT' AND company_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid);

CREATE TABLE supplier_quote_documents (
  supplier_quote_revision_id UUID PRIMARY KEY REFERENCES supplier_quote_revisions(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE RESTRICT,
  linked_by UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE supplier_quote_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_quote_documents FORCE ROW LEVEL SECURITY;

INSERT INTO "Permission" (id,code,description)
VALUES (gen_random_uuid(),'quote.document.read','Read private supplier quote documents')
ON CONFLICT(code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_supplier_quote_document(p_document_id uuid, p_actor_id uuid)
RETURNS TABLE(filename text, detected_mime_type text, byte_size bigint, storage_key text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.filename, d.detected_mime_type, d.byte_size, d.storage_key
  FROM public.supplier_quote_documents sqd
  JOIN public.documents d ON d.id=sqd.document_id
  WHERE sqd.document_id=p_document_id
    AND EXISTS (
      SELECT 1
      FROM public."CompanyMembership" cm
      JOIN public."Company" c ON c.id=cm."companyId" AND c.type='SCO' AND c.status='ACTIVE'
      JOIN public."MembershipRole" mr ON mr.membership_id=cm.id
      JOIN public."RolePermission" rp ON rp.role_id=mr.role_id
      JOIN public."Permission" p ON p.id=rp.permission_id
      WHERE cm."userId"=p_actor_id AND cm.status='ACTIVE' AND p.code='quote.document.read'
    );
$$;
REVOKE ALL ON FUNCTION public.get_supplier_quote_document(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_supplier_quote_document(uuid,uuid) TO sco_internal_executor;
