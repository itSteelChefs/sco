-- Close the remaining buy-side trust-boundary path inherited from Migration 0011.
-- Purchase-source eligibility and exact-source reads remain available only through
-- the purpose-specific SECURITY DEFINER gateways introduced by Migration 0021.

REVOKE SELECT, INSERT, UPDATE ON TABLE
  public.purchase_source_type_definitions,
  public.supplier_qualifications,
  public.supplier_category_capabilities,
  public.purchase_sources,
  public.purchase_source_contacts
FROM sco_runtime;

DROP POLICY IF EXISTS purchase_source_type_definitions_internal
  ON public.purchase_source_type_definitions;
DROP POLICY IF EXISTS supplier_qualifications_internal
  ON public.supplier_qualifications;
DROP POLICY IF EXISTS supplier_category_capabilities_internal
  ON public.supplier_category_capabilities;
DROP POLICY IF EXISTS purchase_sources_internal
  ON public.purchase_sources;
DROP POLICY IF EXISTS purchase_source_contacts_internal
  ON public.purchase_source_contacts;

ALTER TABLE public.purchase_source_type_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_qualifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_category_capabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_source_contacts FORCE ROW LEVEL SECURITY;
