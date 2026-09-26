CREATE TYPE public."SupplierFutureDemandFrameworkRevisionStatus" AS ENUM (
  'DRAFT', 'INTERNAL_APPROVED', 'OFFERED', 'ACCEPTED', 'SUPERSEDED', 'TERMINATED'
);

CREATE TYPE public."SupplierFutureDemandFrameworkEventType" AS ENUM (
  'INTERNAL_APPROVED', 'OFFERED', 'ACCEPTED', 'SUPERSEDED', 'TERMINATED'
);

CREATE TABLE public.supplier_future_demand_frameworks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_reference TEXT NOT NULL CHECK (btrim(internal_reference) <> ''),
  supplier_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  supplier_partnership_id UUID NOT NULL REFERENCES public.company_partnerships(id) ON DELETE RESTRICT,
  purchase_source_id UUID NOT NULL REFERENCES public.purchase_sources(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_fingerprint TEXT NOT NULL CHECK (btrim(request_fingerprint) <> ''),
  correlation_id UUID,
  terminated_at TIMESTAMPTZ,
  terminated_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  termination_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supplier_future_demand_framework_reference_unique UNIQUE (internal_reference),
  CONSTRAINT supplier_future_demand_framework_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT supplier_future_demand_framework_termination_complete CHECK (
    (terminated_at IS NULL AND terminated_by IS NULL AND termination_reason IS NULL)
    OR (terminated_at IS NOT NULL AND terminated_by IS NOT NULL AND btrim(COALESCE(termination_reason, '')) <> '')
  )
);

CREATE TABLE public.supplier_future_demand_framework_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id UUID NOT NULL REFERENCES public.supplier_future_demand_frameworks(id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  status public."SupplierFutureDemandFrameworkRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  effective_from DATE NOT NULL,
  effective_until DATE NOT NULL,
  supersedes_revision_id UUID REFERENCES public.supplier_future_demand_framework_revisions(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_fingerprint TEXT NOT NULL CHECK (btrim(request_fingerprint) <> ''),
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supplier_future_demand_framework_revision_number_unique UNIQUE (framework_id, revision_number),
  CONSTRAINT supplier_future_demand_framework_revision_idempotency_unique UNIQUE (framework_id, idempotency_key),
  CONSTRAINT supplier_future_demand_framework_revision_validity CHECK (effective_until >= effective_from)
);

CREATE TABLE public.supplier_future_demand_framework_scope_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id UUID NOT NULL REFERENCES public.supplier_future_demand_framework_revisions(id) ON DELETE RESTRICT,
  product_identity_id UUID NOT NULL REFERENCES public.product_identities(id) ON DELETE RESTRICT,
  unit_id UUID NOT NULL REFERENCES public.unit_definitions(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supplier_future_demand_framework_scope_grain_unique UNIQUE (revision_id, product_identity_id, unit_id)
);

CREATE TABLE public.supplier_future_demand_framework_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id UUID NOT NULL REFERENCES public.supplier_future_demand_frameworks(id) ON DELETE RESTRICT,
  revision_id UUID REFERENCES public.supplier_future_demand_framework_revisions(id) ON DELETE RESTRICT,
  event_type public."SupplierFutureDemandFrameworkEventType" NOT NULL,
  supplier_acceptance_document_id UUID REFERENCES public.documents(id) ON DELETE RESTRICT,
  supplier_acceptance_document_version_id UUID REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  supplier_acceptance_reference TEXT,
  reason TEXT,
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_fingerprint TEXT NOT NULL CHECK (btrim(request_fingerprint) <> ''),
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supplier_future_demand_framework_acceptance_evidence_complete CHECK (
    (supplier_acceptance_document_id IS NULL AND supplier_acceptance_document_version_id IS NULL)
    OR (supplier_acceptance_document_id IS NOT NULL AND supplier_acceptance_document_version_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX supplier_future_demand_framework_event_idempotency_unique
  ON public.supplier_future_demand_framework_lifecycle_events(
    framework_id, event_type, COALESCE(revision_id, '00000000-0000-0000-0000-000000000000'::uuid), idempotency_key
  );
CREATE INDEX supplier_future_demand_framework_revision_framework_idx
  ON public.supplier_future_demand_framework_revisions(framework_id, revision_number);
CREATE INDEX supplier_future_demand_framework_scope_revision_idx
  ON public.supplier_future_demand_framework_scope_lines(revision_id);
CREATE INDEX supplier_future_demand_framework_event_revision_idx
  ON public.supplier_future_demand_framework_lifecycle_events(revision_id, created_at);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'supplier_future_demand_frameworks',
    'supplier_future_demand_framework_revisions',
    'supplier_future_demand_framework_scope_lines',
    'supplier_future_demand_framework_lifecycle_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, sco_runtime, sco_internal_executor', t);
  END LOOP;
END $$;

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'supplier_future_demand_framework.create', 'Create Supplier Future-Demand Framework drafts'),
  (gen_random_uuid(), 'supplier_future_demand_framework.read', 'Read Supplier Future-Demand Frameworks internally'),
  (gen_random_uuid(), 'supplier_future_demand_framework.approve', 'Approve Supplier Future-Demand Framework revisions internally'),
  (gen_random_uuid(), 'supplier_future_demand_framework.offer', 'Record Supplier Future-Demand Framework offers'),
  (gen_random_uuid(), 'supplier_future_demand_framework.accept', 'Record Supplier Future-Demand Framework acceptance evidence'),
  (gen_random_uuid(), 'supplier_future_demand_framework.supersede', 'Supersede Supplier Future-Demand Framework revisions'),
  (gen_random_uuid(), 'supplier_future_demand_framework.terminate', 'Terminate Supplier Future-Demand Frameworks')
ON CONFLICT (code) DO NOTHING;

CREATE FUNCTION public.prevent_supplier_future_demand_framework_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.supplier_future_demand_framework_gateway', true) <> 'true' THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_IMMUTABLE';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;

CREATE TRIGGER supplier_future_demand_framework_header_immutable
  BEFORE UPDATE OR DELETE ON public.supplier_future_demand_frameworks
  FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_future_demand_framework_mutation();
CREATE TRIGGER supplier_future_demand_framework_revision_immutable
  BEFORE UPDATE OR DELETE ON public.supplier_future_demand_framework_revisions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_future_demand_framework_mutation();
CREATE TRIGGER supplier_future_demand_framework_scope_immutable
  BEFORE UPDATE OR DELETE ON public.supplier_future_demand_framework_scope_lines
  FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_future_demand_framework_mutation();
CREATE TRIGGER supplier_future_demand_framework_event_immutable
  BEFORE UPDATE OR DELETE ON public.supplier_future_demand_framework_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_future_demand_framework_mutation();

CREATE FUNCTION public.supplier_future_demand_framework_actor_allowed(p_actor UUID, p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_actor IS NOT NULL
     AND EXISTS (SELECT 1 FROM public."User" u WHERE u.id = p_actor AND u.status = 'ACTIVE')
     AND (NULLIF(current_setting('app.actor_id', true), '') IS NULL OR current_setting('app.actor_id', true) = p_actor::TEXT)
     AND public.internal_has_capability(p_actor, p_permission)
$$;

CREATE FUNCTION public.supplier_future_demand_framework_supplier_scope_valid(
  p_supplier_company UUID,
  p_supplier_partnership UUID,
  p_purchase_source UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.purchase_sources ps
      JOIN public.company_partnerships cp ON cp.id = ps.supplier_partnership_id
      JOIN public."Company" c ON c.id = ps.supplier_company_id
     WHERE ps.id = p_purchase_source
       AND ps.supplier_company_id = p_supplier_company
       AND ps.supplier_partnership_id = p_supplier_partnership
       AND ps.status = 'ACTIVE'
       AND cp.type = 'SUPPLIER_PARTNERSHIP'
       AND cp.status = 'ACTIVE'
       AND c.status = 'ACTIVE'
  )
$$;

CREATE FUNCTION public.supplier_future_demand_framework_scope_insert(
  p_revision UUID,
  p_actor UUID,
  p_scope_lines JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_line JSONB;
BEGIN
  IF jsonb_typeof(p_scope_lines) <> 'array' OR jsonb_array_length(p_scope_lines) = 0 THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_SCOPE_INVALID';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_scope_lines) LOOP
    IF NULLIF(v_line->>'productIdentityId', '') IS NULL
       OR NULLIF(v_line->>'unitId', '') IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.product_identities pi
         JOIN public.unit_definitions u ON u.id = (v_line->>'unitId')::UUID AND u.active
          WHERE pi.id = (v_line->>'productIdentityId')::UUID AND pi.status = 'ACTIVE'
       ) THEN
      RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_SCOPE_INVALID';
    END IF;
    INSERT INTO public.supplier_future_demand_framework_scope_lines(revision_id, product_identity_id, unit_id, created_by)
    VALUES (p_revision, (v_line->>'productIdentityId')::UUID, (v_line->>'unitId')::UUID, p_actor);
  END LOOP;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_SCOPE_INVALID';
END
$$;

CREATE FUNCTION public.supplier_future_demand_framework_event_record(
  p_framework UUID,
  p_revision UUID,
  p_type public."SupplierFutureDemandFrameworkEventType",
  p_actor UUID,
  p_document UUID,
  p_document_version UUID,
  p_reference TEXT,
  p_reason TEXT,
  p_idempotency_key TEXT,
  p_fingerprint TEXT,
  p_correlation TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_existing RECORD; v_id UUID; v_key TEXT := btrim(COALESCE(p_idempotency_key, ''));
BEGIN
  IF v_key = '' THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_INVALID'; END IF;
  SELECT * INTO v_existing
    FROM public.supplier_future_demand_framework_lifecycle_events
   WHERE framework_id = p_framework AND event_type = p_type
     AND revision_id IS NOT DISTINCT FROM p_revision AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> p_fingerprint THEN
      RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_existing.id;
  END IF;
  INSERT INTO public.supplier_future_demand_framework_lifecycle_events(
    framework_id, revision_id, event_type, supplier_acceptance_document_id,
    supplier_acceptance_document_version_id, supplier_acceptance_reference,
    reason, actor_user_id, idempotency_key, request_fingerprint, correlation_id
  ) VALUES (
    p_framework, p_revision, p_type, p_document, p_document_version, NULLIF(btrim(p_reference), ''),
    NULLIF(btrim(p_reason), ''), p_actor, v_key, p_fingerprint, NULLIF(p_correlation, '')::UUID
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

CREATE FUNCTION public.internal_supplier_future_demand_framework_create(
  p_actor UUID,
  p_reference TEXT,
  p_supplier_company UUID,
  p_supplier_partnership UUID,
  p_purchase_source UUID,
  p_effective_from DATE,
  p_effective_until DATE,
  p_scope_lines JSONB,
  p_idempotency_key TEXT,
  p_correlation TEXT
)
RETURNS TABLE(framework_id UUID, revision_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_framework UUID := gen_random_uuid(); v_revision UUID := gen_random_uuid(); v_existing RECORD;
  v_key TEXT := btrim(COALESCE(p_idempotency_key, ''));
  v_reference TEXT := btrim(COALESCE(p_reference, ''));
  v_fingerprint TEXT := md5(concat_ws('|', btrim(COALESCE(p_reference, '')), p_supplier_company::TEXT, p_supplier_partnership::TEXT, p_purchase_source::TEXT, p_effective_from::TEXT, p_effective_until::TEXT, COALESCE(p_scope_lines::TEXT, '')));
BEGIN
  IF NOT public.supplier_future_demand_framework_actor_allowed(p_actor, 'supplier_future_demand_framework.create') THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_FORBIDDEN';
  END IF;
  IF v_reference = '' OR v_key = '' OR p_effective_from IS NULL OR p_effective_until IS NULL OR p_effective_until < p_effective_from
     OR NOT public.supplier_future_demand_framework_supplier_scope_valid(p_supplier_company, p_supplier_partnership, p_purchase_source) THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('supplier-future-demand-framework:' || v_key));
  SELECT f.id, r.id AS revision_id, f.request_fingerprint INTO v_existing
    FROM public.supplier_future_demand_frameworks f
    JOIN public.supplier_future_demand_framework_revisions r ON r.framework_id = f.id AND r.revision_number = 1
   WHERE f.idempotency_key = v_key FOR UPDATE OF f;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.revision_id; RETURN;
  END IF;
  PERFORM set_config('app.supplier_future_demand_framework_gateway', 'true', true);
  INSERT INTO public.supplier_future_demand_frameworks(
    id, internal_reference, supplier_company_id, supplier_partnership_id, purchase_source_id,
    created_by, idempotency_key, request_fingerprint, correlation_id
  ) VALUES (
    v_framework, v_reference, p_supplier_company, p_supplier_partnership, p_purchase_source,
    p_actor, v_key, v_fingerprint, NULLIF(p_correlation, '')::UUID
  );
  INSERT INTO public.supplier_future_demand_framework_revisions(
    id, framework_id, revision_number, effective_from, effective_until, created_by,
    idempotency_key, request_fingerprint, correlation_id
  ) VALUES (
    v_revision, v_framework, 1, p_effective_from, p_effective_until, p_actor,
    v_key, md5(v_fingerprint || '|revision'), NULLIF(p_correlation, '')::UUID
  );
  PERFORM public.supplier_future_demand_framework_scope_insert(v_revision, p_actor, p_scope_lines);
  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, 'SCO_INTERNAL', 'supplier_future_demand_framework.created', 'SupplierFutureDemandFramework', v_framework,
    jsonb_build_object('revisionId', v_revision, 'supplierCompanyId', p_supplier_company, 'purchaseSourceId', p_purchase_source, 'outcome', 'DRAFT'), NULLIF(p_correlation, '')::UUID);
  RETURN QUERY SELECT v_framework, v_revision;
END
$$;

CREATE FUNCTION public.internal_supplier_future_demand_framework_revision_create(
  p_actor UUID, p_framework UUID, p_effective_from DATE, p_effective_until DATE,
  p_scope_lines JSONB, p_idempotency_key TEXT, p_correlation TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_framework RECORD; v_existing RECORD; v_id UUID := gen_random_uuid(); v_number INTEGER;
  v_key TEXT := btrim(COALESCE(p_idempotency_key, ''));
  v_fingerprint TEXT := md5(concat_ws('|', p_framework::TEXT, p_effective_from::TEXT, p_effective_until::TEXT, COALESCE(p_scope_lines::TEXT, '')));
BEGIN
  IF NOT public.supplier_future_demand_framework_actor_allowed(p_actor, 'supplier_future_demand_framework.create') THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_FORBIDDEN'; END IF;
  IF v_key = '' OR p_effective_from IS NULL OR p_effective_until IS NULL OR p_effective_until < p_effective_from THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_INVALID'; END IF;
  SELECT * INTO v_framework FROM public.supplier_future_demand_frameworks WHERE id = p_framework FOR UPDATE;
  IF NOT FOUND OR v_framework.terminated_at IS NOT NULL OR NOT public.supplier_future_demand_framework_supplier_scope_valid(v_framework.supplier_company_id, v_framework.supplier_partnership_id, v_framework.purchase_source_id) THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_FORBIDDEN';
  END IF;
  SELECT * INTO v_existing FROM public.supplier_future_demand_framework_revisions WHERE framework_id = p_framework AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN v_existing.id;
  END IF;
  SELECT COALESCE(max(revision_number), 0) + 1 INTO v_number FROM public.supplier_future_demand_framework_revisions WHERE framework_id = p_framework;
  PERFORM set_config('app.supplier_future_demand_framework_gateway', 'true', true);
  INSERT INTO public.supplier_future_demand_framework_revisions(id, framework_id, revision_number, effective_from, effective_until, created_by, idempotency_key, request_fingerprint, correlation_id)
  VALUES (v_id, p_framework, v_number, p_effective_from, p_effective_until, p_actor, v_key, v_fingerprint, NULLIF(p_correlation, '')::UUID);
  PERFORM public.supplier_future_demand_framework_scope_insert(v_id, p_actor, p_scope_lines);
  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, 'SCO_INTERNAL', 'supplier_future_demand_framework.revision_created', 'SupplierFutureDemandFrameworkRevision', v_id,
    jsonb_build_object('frameworkId', p_framework, 'revisionNumber', v_number, 'outcome', 'DRAFT'), NULLIF(p_correlation, '')::UUID);
  RETURN v_id;
END
$$;

CREATE FUNCTION public.internal_supplier_future_demand_framework_approve(p_actor UUID, p_revision UUID, p_idempotency_key TEXT, p_correlation TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v RECORD; v_fingerprint TEXT := md5(concat_ws('|', p_revision::TEXT, 'INTERNAL_APPROVED'));
BEGIN
  IF NOT public.supplier_future_demand_framework_actor_allowed(p_actor, 'supplier_future_demand_framework.approve') THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_FORBIDDEN'; END IF;
  SELECT r.*, f.terminated_at INTO v FROM public.supplier_future_demand_framework_revisions r JOIN public.supplier_future_demand_frameworks f ON f.id = r.framework_id WHERE r.id = p_revision FOR UPDATE OF r, f;
  IF NOT FOUND OR v.terminated_at IS NOT NULL OR v.status <> 'DRAFT' THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_TRANSITION_INVALID'; END IF;
  PERFORM set_config('app.supplier_future_demand_framework_gateway', 'true', true);
  PERFORM public.supplier_future_demand_framework_event_record(v.framework_id, p_revision, 'INTERNAL_APPROVED', p_actor, NULL, NULL, NULL, NULL, p_idempotency_key, v_fingerprint, p_correlation);
  UPDATE public.supplier_future_demand_framework_revisions SET status = 'INTERNAL_APPROVED' WHERE id = p_revision;
  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, 'SCO_INTERNAL', 'supplier_future_demand_framework.internally_approved', 'SupplierFutureDemandFrameworkRevision', p_revision, jsonb_build_object('frameworkId', v.framework_id), NULLIF(p_correlation, '')::UUID);
END
$$;

CREATE FUNCTION public.internal_supplier_future_demand_framework_offer(p_actor UUID, p_revision UUID, p_idempotency_key TEXT, p_correlation TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v RECORD; v_fingerprint TEXT := md5(concat_ws('|', p_revision::TEXT, 'OFFERED'));
BEGIN
  IF NOT public.supplier_future_demand_framework_actor_allowed(p_actor, 'supplier_future_demand_framework.offer') THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_FORBIDDEN'; END IF;
  SELECT r.*, f.terminated_at INTO v FROM public.supplier_future_demand_framework_revisions r JOIN public.supplier_future_demand_frameworks f ON f.id = r.framework_id WHERE r.id = p_revision FOR UPDATE OF r, f;
  IF NOT FOUND OR v.terminated_at IS NOT NULL OR v.status <> 'INTERNAL_APPROVED' THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_TRANSITION_INVALID'; END IF;
  PERFORM set_config('app.supplier_future_demand_framework_gateway', 'true', true);
  PERFORM public.supplier_future_demand_framework_event_record(v.framework_id, p_revision, 'OFFERED', p_actor, NULL, NULL, NULL, NULL, p_idempotency_key, v_fingerprint, p_correlation);
  UPDATE public.supplier_future_demand_framework_revisions SET status = 'OFFERED' WHERE id = p_revision;
  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, 'SCO_INTERNAL', 'supplier_future_demand_framework.offered', 'SupplierFutureDemandFrameworkRevision', p_revision, jsonb_build_object('frameworkId', v.framework_id), NULLIF(p_correlation, '')::UUID);
END
$$;

CREATE FUNCTION public.internal_supplier_future_demand_framework_accept(
  p_actor UUID, p_revision UUID, p_document UUID, p_document_version UUID, p_reference TEXT,
  p_idempotency_key TEXT, p_correlation TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v RECORD; v_reference TEXT := NULLIF(btrim(p_reference), '');
  v_fingerprint TEXT := md5(concat_ws('|', p_revision::TEXT, 'ACCEPTED', p_document::TEXT, p_document_version::TEXT, NULLIF(btrim(p_reference), '')));
BEGIN
  IF NOT public.supplier_future_demand_framework_actor_allowed(p_actor, 'supplier_future_demand_framework.accept') THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_FORBIDDEN'; END IF;
  IF ((p_document IS NULL) <> (p_document_version IS NULL)) OR (p_document IS NULL AND v_reference IS NULL) THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_ACCEPTANCE_EVIDENCE_INVALID'; END IF;
  SELECT r.*, f.terminated_at INTO v FROM public.supplier_future_demand_framework_revisions r JOIN public.supplier_future_demand_frameworks f ON f.id = r.framework_id WHERE r.id = p_revision FOR UPDATE OF r, f;
  IF NOT FOUND OR v.terminated_at IS NOT NULL OR v.status <> 'OFFERED' THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_TRANSITION_INVALID'; END IF;
  IF p_document IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.documents d JOIN public.document_versions dv ON dv.document_id = d.id
     WHERE d.id = p_document AND dv.id = p_document_version AND d.access_scope = 'SCO_INTERNAL' AND d.status = 'AVAILABLE'
  ) THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_ACCEPTANCE_EVIDENCE_INVALID'; END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_future_demand_framework_revisions r WHERE r.framework_id = v.framework_id AND r.status = 'ACCEPTED') THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_CURRENT_REVISION_EXISTS';
  END IF;
  PERFORM set_config('app.supplier_future_demand_framework_gateway', 'true', true);
  PERFORM public.supplier_future_demand_framework_event_record(v.framework_id, p_revision, 'ACCEPTED', p_actor, p_document, p_document_version, v_reference, NULL, p_idempotency_key, v_fingerprint, p_correlation);
  UPDATE public.supplier_future_demand_framework_revisions SET status = 'ACCEPTED' WHERE id = p_revision;
  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, 'SCO_INTERNAL', 'supplier_future_demand_framework.accepted', 'SupplierFutureDemandFrameworkRevision', p_revision,
    jsonb_build_object('frameworkId', v.framework_id, 'evidenceDocumentAttached', p_document IS NOT NULL), NULLIF(p_correlation, '')::UUID);
END
$$;

CREATE FUNCTION public.internal_supplier_future_demand_framework_supersede(p_actor UUID, p_revision UUID, p_idempotency_key TEXT, p_correlation TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v RECORD; v_fingerprint TEXT := md5(concat_ws('|', p_revision::TEXT, 'SUPERSEDED'));
BEGIN
  IF NOT public.supplier_future_demand_framework_actor_allowed(p_actor, 'supplier_future_demand_framework.supersede') THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_FORBIDDEN'; END IF;
  SELECT r.*, f.terminated_at INTO v FROM public.supplier_future_demand_framework_revisions r JOIN public.supplier_future_demand_frameworks f ON f.id = r.framework_id WHERE r.id = p_revision FOR UPDATE OF r, f;
  IF NOT FOUND OR v.terminated_at IS NOT NULL OR v.status <> 'ACCEPTED' THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_TRANSITION_INVALID'; END IF;
  PERFORM set_config('app.supplier_future_demand_framework_gateway', 'true', true);
  PERFORM public.supplier_future_demand_framework_event_record(v.framework_id, p_revision, 'SUPERSEDED', p_actor, NULL, NULL, NULL, NULL, p_idempotency_key, v_fingerprint, p_correlation);
  UPDATE public.supplier_future_demand_framework_revisions SET status = 'SUPERSEDED' WHERE id = p_revision;
  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, 'SCO_INTERNAL', 'supplier_future_demand_framework.superseded', 'SupplierFutureDemandFrameworkRevision', p_revision, jsonb_build_object('frameworkId', v.framework_id), NULLIF(p_correlation, '')::UUID);
END
$$;

CREATE FUNCTION public.internal_supplier_future_demand_framework_terminate(p_actor UUID, p_framework UUID, p_reason TEXT, p_idempotency_key TEXT, p_correlation TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v RECORD; v_reason TEXT := NULLIF(btrim(p_reason), ''); v_fingerprint TEXT := md5(concat_ws('|', p_framework::TEXT, 'TERMINATED', NULLIF(btrim(p_reason), '')));
BEGIN
  IF NOT public.supplier_future_demand_framework_actor_allowed(p_actor, 'supplier_future_demand_framework.terminate') THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_FORBIDDEN'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_INVALID'; END IF;
  SELECT * INTO v FROM public.supplier_future_demand_frameworks WHERE id = p_framework FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_FORBIDDEN'; END IF;
  PERFORM set_config('app.supplier_future_demand_framework_gateway', 'true', true);
  IF v.terminated_at IS NOT NULL THEN
    PERFORM public.supplier_future_demand_framework_event_record(p_framework, NULL, 'TERMINATED', p_actor, NULL, NULL, NULL, v_reason, p_idempotency_key, v_fingerprint, p_correlation);
    RETURN;
  END IF;
  PERFORM public.supplier_future_demand_framework_event_record(p_framework, NULL, 'TERMINATED', p_actor, NULL, NULL, NULL, v_reason, p_idempotency_key, v_fingerprint, p_correlation);
  UPDATE public.supplier_future_demand_frameworks SET terminated_at = now(), terminated_by = p_actor, termination_reason = v_reason WHERE id = p_framework;
  INSERT INTO public.audit_logs(actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, 'SCO_INTERNAL', 'supplier_future_demand_framework.terminated', 'SupplierFutureDemandFramework', p_framework, jsonb_build_object('reason', v_reason), NULLIF(p_correlation, '')::UUID);
END
$$;

CREATE FUNCTION public.internal_supplier_future_demand_framework_get(p_actor UUID, p_framework UUID)
RETURNS TABLE(
  framework_id UUID, internal_reference TEXT, supplier_company_id UUID, supplier_partnership_id UUID,
  purchase_source_id UUID, framework_terminated_at TIMESTAMPTZ, revision_id UUID, revision_number INTEGER,
  revision_status TEXT, effective_from DATE, effective_until DATE, derived_state TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT f.id, f.internal_reference, f.supplier_company_id, f.supplier_partnership_id, f.purchase_source_id,
         f.terminated_at, r.id, r.revision_number, r.status::TEXT, r.effective_from, r.effective_until,
         CASE
           WHEN f.terminated_at IS NOT NULL OR r.status IN ('SUPERSEDED', 'TERMINATED') THEN 'INACTIVE'
           WHEN r.effective_until < CURRENT_DATE THEN 'EXPIRED'
           WHEN r.status = 'ACCEPTED' AND r.effective_from <= CURRENT_DATE AND r.effective_until >= CURRENT_DATE
             AND EXISTS (SELECT 1 FROM public.supplier_future_demand_framework_lifecycle_events e WHERE e.revision_id = r.id AND e.event_type = 'ACCEPTED' AND (e.supplier_acceptance_document_id IS NOT NULL OR e.supplier_acceptance_reference IS NOT NULL))
             THEN 'ACTIVE'
           ELSE 'INACTIVE'
         END
    FROM public.supplier_future_demand_frameworks f
    JOIN public.supplier_future_demand_framework_revisions r ON r.framework_id = f.id
   WHERE f.id = p_framework
     AND public.supplier_future_demand_framework_actor_allowed(p_actor, 'supplier_future_demand_framework.read')
   ORDER BY r.revision_number
$$;

REVOKE ALL ON FUNCTION public.prevent_supplier_future_demand_framework_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.supplier_future_demand_framework_actor_allowed(UUID, TEXT), public.supplier_future_demand_framework_supplier_scope_valid(UUID, UUID, UUID), public.supplier_future_demand_framework_scope_insert(UUID, UUID, JSONB), public.supplier_future_demand_framework_event_record(UUID, UUID, public."SupplierFutureDemandFrameworkEventType", UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, sco_runtime, sco_internal_executor;
REVOKE ALL ON FUNCTION public.internal_supplier_future_demand_framework_create(UUID, TEXT, UUID, UUID, UUID, DATE, DATE, JSONB, TEXT, TEXT), public.internal_supplier_future_demand_framework_revision_create(UUID, UUID, DATE, DATE, JSONB, TEXT, TEXT), public.internal_supplier_future_demand_framework_approve(UUID, UUID, TEXT, TEXT), public.internal_supplier_future_demand_framework_offer(UUID, UUID, TEXT, TEXT), public.internal_supplier_future_demand_framework_accept(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT), public.internal_supplier_future_demand_framework_supersede(UUID, UUID, TEXT, TEXT), public.internal_supplier_future_demand_framework_terminate(UUID, UUID, TEXT, TEXT, TEXT), public.internal_supplier_future_demand_framework_get(UUID, UUID) FROM PUBLIC, sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_supplier_future_demand_framework_create(UUID, TEXT, UUID, UUID, UUID, DATE, DATE, JSONB, TEXT, TEXT), public.internal_supplier_future_demand_framework_revision_create(UUID, UUID, DATE, DATE, JSONB, TEXT, TEXT), public.internal_supplier_future_demand_framework_approve(UUID, UUID, TEXT, TEXT), public.internal_supplier_future_demand_framework_offer(UUID, UUID, TEXT, TEXT), public.internal_supplier_future_demand_framework_accept(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT), public.internal_supplier_future_demand_framework_supersede(UUID, UUID, TEXT, TEXT), public.internal_supplier_future_demand_framework_terminate(UUID, UUID, TEXT, TEXT, TEXT), public.internal_supplier_future_demand_framework_get(UUID, UUID) TO sco_internal_executor;