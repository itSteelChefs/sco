-- Capability F — Engineering Workspace V1.
-- Distinct from D procurement BOQ lifecycle. F→D handoff creates D requirement from approved F BOQ.
-- No CAD/BIM/AI/OSS. Next sequence after 0116.

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'engineering.request.write', 'Partner create/edit/submit own engineering requests'),
  (gen_random_uuid(), 'engineering.request.read', 'Partner read own engineering requests and approved results'),
  (gen_random_uuid(), 'engineering.request.review', 'Internal review engineering requests and BOQ'),
  (gen_random_uuid(), 'engineering.request.assign', 'Internal assign primary engineer'),
  (gen_random_uuid(), 'engineering.boq.edit', 'Internal edit engineering BOQ draft versions'),
  (gen_random_uuid(), 'engineering.boq.approve', 'Internal approve engineering BOQ and handoff to D')
ON CONFLICT (code) DO NOTHING;

-- Widen document link allowlist for engineering requests
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_linked_entity_type_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_linked_entity_type_check
  CHECK (
    (linked_entity_type IS NULL AND linked_entity_id IS NULL)
    OR linked_entity_type IN (
      'QUALIFICATION_APPLICATION','VERIFY_REQUEST','AGREEMENT_POLICY_VERSION','ENGINEERING_REQUEST'
    )
  );

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_document_category_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_document_category_check
  CHECK (document_category IS NULL OR document_category IN (
    'QUALIFICATION_SUPPORT','AGREEMENT_ARTIFACT','VERIFY_QUOTE','GENERAL',
    'ENGINEERING_DRAWING','ENGINEERING_SPECIFICATION','ENGINEERING_SCHEDULE',
    'ENGINEERING_SPREADSHEET','ENGINEERING_IMAGE','ENGINEERING_OTHER'
  ));

CREATE TABLE public.engineering_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 240),
  project_reference TEXT,
  project_id UUID REFERENCES public.projects(id) ON DELETE RESTRICT,
  sector TEXT NOT NULL CHECK (sector IN ('HVAC','ELECTRICAL','PLUMBING','MULTI')),
  description TEXT,
  request_type TEXT NOT NULL DEFAULT 'BOQ_PREPARATION'
    CHECK (request_type IN ('BOQ_PREPARATION','DESIGN_REVIEW','SPEC_CLARIFICATION','OTHER')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','SUBMITTED','ASSIGNED','IN_REVIEW','ACTION_REQUIRED','BOQ_IN_PROGRESS',
    'PENDING_APPROVAL','APPROVED','CANCELLED'
  )),
  submitted_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  assigned_engineer_id UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  action_required_message TEXT,
  partner_visible_notes TEXT,
  internal_notes TEXT,
  current_approved_boq_version_id UUID,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (company_id, idempotency_key)
);
CREATE INDEX engineering_requests_company_status_idx
  ON public.engineering_requests(company_id, status, updated_at DESC);
CREATE INDEX engineering_requests_status_idx
  ON public.engineering_requests(status, updated_at DESC);

CREATE TABLE public.engineering_request_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.engineering_requests(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  reason TEXT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.engineering_request_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.engineering_requests(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  classification TEXT NOT NULL CHECK (classification IN (
    'DRAWING','SPECIFICATION','SCHEDULE','SPREADSHEET','IMAGE','OTHER'
  )),
  linked_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (request_id, document_id)
);

CREATE TABLE public.engineering_boq_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.engineering_requests(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','SUPERSEDED')),
  supersedes_version_id UUID REFERENCES public.engineering_boq_versions(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  partner_visible_notes TEXT,
  internal_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (request_id, version_number)
);

ALTER TABLE public.engineering_requests
  ADD CONSTRAINT engineering_requests_current_approved_fk
  FOREIGN KEY (current_approved_boq_version_id)
  REFERENCES public.engineering_boq_versions(id) ON DELETE RESTRICT;

CREATE TABLE public.engineering_boq_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_version_id UUID NOT NULL REFERENCES public.engineering_boq_versions(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL REFERENCES public.engineering_requests(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  line_key TEXT NOT NULL CHECK (btrim(line_key) <> ''),
  description TEXT NOT NULL CHECK (btrim(description) <> '' AND char_length(description) <= 2000),
  specification TEXT,
  discipline TEXT CHECK (discipline IS NULL OR discipline IN ('HVAC','ELECTRICAL','PLUMBING','MULTI','OTHER')),
  unit_id UUID NOT NULL REFERENCES public.unit_definitions(id) ON DELETE RESTRICT,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  brand_preference TEXT,
  model_preference TEXT,
  engineering_notes TEXT,
  partner_visible_notes TEXT,
  source_document_id UUID REFERENCES public.documents(id) ON DELETE RESTRICT,
  source_reference TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (boq_version_id, line_key)
);
CREATE INDEX engineering_boq_lines_version_idx ON public.engineering_boq_lines(boq_version_id, sort_order);

CREATE TABLE public.engineering_d_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.engineering_requests(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  boq_version_id UUID NOT NULL UNIQUE REFERENCES public.engineering_boq_versions(id) ON DELETE RESTRICT,
  procurement_requirement_id UUID NOT NULL UNIQUE REFERENCES public.procurement_requirements(id) ON DELETE RESTRICT,
  handed_off_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  handed_off_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id UUID,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','CANCELLED'))
);

-- RLS
ALTER TABLE public.engineering_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engineering_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY engineering_requests_access ON public.engineering_requests
  FOR ALL TO sco_runtime
  USING (
    company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.sco_internal', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.sco_internal', true) = 'true'
  );

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'engineering_request_events',
    'engineering_request_documents',
    'engineering_boq_versions',
    'engineering_boq_lines',
    'engineering_d_handoffs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_access ON public.%I FOR ALL TO sco_runtime USING (
         company_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid
         OR current_setting(''app.sco_internal'', true) = ''true''
       ) WITH CHECK (
         company_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid
         OR current_setting(''app.sco_internal'', true) = ''true''
       )', t, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON
  public.engineering_requests,
  public.engineering_request_events,
  public.engineering_request_documents,
  public.engineering_boq_versions,
  public.engineering_boq_lines,
  public.engineering_d_handoffs
TO sco_runtime;

CREATE OR REPLACE FUNCTION public.engineering_partner_eligible(p_actor UUID, p_company UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT public.partner_procurement_access_allowed(p_actor, p_company)
     OR (
       EXISTS (
         SELECT 1 FROM public."CompanyMembership" cm
          JOIN public."Company" c ON c.id = cm."companyId"
          JOIN public."MembershipRole" mr ON mr.membership_id = cm.id
          JOIN public."RolePermission" rp ON rp.role_id = mr.role_id
          JOIN public."Permission" p ON p.id = rp.permission_id
         WHERE cm."userId" = p_actor AND cm."companyId" = p_company AND cm.status = 'ACTIVE'
           AND c.type = 'PARTNER' AND c.status = 'ACTIVE'
           AND p.code IN ('engineering.request.write','engineering.request.read','partner.portal.read')
       )
       AND EXISTS (
         SELECT 1 FROM public.company_partnerships cp
          WHERE cp.company_id = p_company AND cp.type = 'BUYER_PARTNERSHIP' AND cp.status = 'ACTIVE'
       )
       AND public.partner_required_agreements_satisfied(p_company)
     );
$$;

-- SECURITY DEFINER: sco_runtime cannot EXECUTE internal_has_capability directly (D pattern).
CREATE OR REPLACE FUNCTION public.engineering_internal_capability(p_actor UUID, p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT public.internal_has_capability(p_actor, p_code)
     OR public.internal_has_capability(p_actor, 'sco.internal.manage');
$$;

CREATE OR REPLACE FUNCTION public.partner_engineering_request_create(
  p_actor UUID, p_company UUID,
  p_title TEXT, p_sector TEXT, p_description TEXT, p_request_type TEXT,
  p_project_reference TEXT, p_idempotency_key TEXT, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id UUID; v_existing UUID;
BEGIN
  IF current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::text
     OR current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::text THEN
    RAISE EXCEPTION 'ENGINEERING_FORBIDDEN';
  END IF;
  IF NOT public.engineering_partner_eligible(p_actor, p_company) THEN
    RAISE EXCEPTION 'ENGINEERING_INELIGIBLE';
  END IF;
  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    SELECT id INTO v_existing FROM public.engineering_requests
     WHERE company_id = p_company AND idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;
  v_id := gen_random_uuid();
  INSERT INTO public.engineering_requests(
    id, company_id, created_by, title, sector, description, request_type, project_reference, idempotency_key, status
  ) VALUES (
    v_id, p_company, p_actor, btrim(p_title), p_sector,
    NULLIF(btrim(COALESCE(p_description,'')), ''),
    COALESCE(NULLIF(btrim(COALESCE(p_request_type,'')), ''), 'BOQ_PREPARATION'),
    NULLIF(btrim(COALESCE(p_project_reference,'')), ''),
    NULLIF(btrim(COALESCE(p_idempotency_key,'')), ''),
    'DRAFT'
  );
  INSERT INTO public.engineering_request_events(request_id, company_id, from_status, to_status, actor_user_id, correlation_id)
  VALUES (v_id, p_company, NULL, 'DRAFT', p_actor, p_correlation);
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, p_company, 'TENANT', 'engineering.request.created', 'EngineeringRequest', v_id,
          jsonb_build_object('status','DRAFT'), p_correlation);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.partner_engineering_request_update_draft(
  p_actor UUID, p_company UUID, p_id UUID,
  p_title TEXT, p_sector TEXT, p_description TEXT, p_request_type TEXT,
  p_project_reference TEXT, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD;
BEGIN
  IF current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::text
     OR current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::text THEN
    RAISE EXCEPTION 'ENGINEERING_FORBIDDEN';
  END IF;
  IF NOT public.engineering_partner_eligible(p_actor, p_company) THEN
    RAISE EXCEPTION 'ENGINEERING_INELIGIBLE';
  END IF;
  SELECT * INTO r FROM public.engineering_requests WHERE id = p_id AND company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENGINEERING_REQUEST_NOT_FOUND'; END IF;
  IF r.status NOT IN ('DRAFT','ACTION_REQUIRED') THEN
    RAISE EXCEPTION 'ENGINEERING_REQUEST_NOT_EDITABLE';
  END IF;
  UPDATE public.engineering_requests SET
    title = btrim(p_title), sector = p_sector,
    description = NULLIF(btrim(COALESCE(p_description,'')), ''),
    request_type = COALESCE(NULLIF(btrim(COALESCE(p_request_type,'')), ''), request_type),
    project_reference = NULLIF(btrim(COALESCE(p_project_reference,'')), ''),
    updated_at = clock_timestamp()
  WHERE id = p_id;
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION public.partner_engineering_request_submit(
  p_actor UUID, p_company UUID, p_id UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD; v_to TEXT;
BEGIN
  IF current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::text
     OR current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::text THEN
    RAISE EXCEPTION 'ENGINEERING_FORBIDDEN';
  END IF;
  IF NOT public.engineering_partner_eligible(p_actor, p_company) THEN
    RAISE EXCEPTION 'ENGINEERING_INELIGIBLE';
  END IF;
  SELECT * INTO r FROM public.engineering_requests WHERE id = p_id AND company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENGINEERING_REQUEST_NOT_FOUND'; END IF;
  IF r.status = 'SUBMITTED' THEN RETURN p_id; END IF;
  IF r.status = 'ACTION_REQUIRED' THEN
    v_to := CASE WHEN r.assigned_engineer_id IS NOT NULL THEN 'IN_REVIEW' ELSE 'SUBMITTED' END;
  ELSIF r.status = 'DRAFT' THEN
    v_to := 'SUBMITTED';
  ELSE
    RAISE EXCEPTION 'ENGINEERING_REQUEST_NOT_SUBMITTABLE';
  END IF;
  UPDATE public.engineering_requests SET
    status = v_to,
    submitted_at = COALESCE(submitted_at, clock_timestamp()),
    submitted_by = p_actor,
    action_required_message = NULL,
    updated_at = clock_timestamp()
  WHERE id = p_id;
  INSERT INTO public.engineering_request_events(request_id, company_id, from_status, to_status, actor_user_id, correlation_id)
  VALUES (p_id, p_company, r.status, v_to, p_actor, p_correlation);
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, p_company, 'TENANT', 'engineering.request.submitted', 'EngineeringRequest', p_id,
          jsonb_build_object('fromStatus', r.status, 'toStatus', v_to), p_correlation);
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION public.partner_engineering_document_link(
  p_actor UUID, p_company UUID, p_request UUID, p_document UUID, p_classification TEXT, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD; v_id UUID; d RECORD;
BEGIN
  IF current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::text
     OR current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::text THEN
    RAISE EXCEPTION 'ENGINEERING_FORBIDDEN';
  END IF;
  IF NOT public.engineering_partner_eligible(p_actor, p_company) THEN
    RAISE EXCEPTION 'ENGINEERING_INELIGIBLE';
  END IF;
  SELECT * INTO r FROM public.engineering_requests WHERE id = p_request AND company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENGINEERING_REQUEST_NOT_FOUND'; END IF;
  IF r.status NOT IN ('DRAFT','ACTION_REQUIRED','SUBMITTED') THEN
    RAISE EXCEPTION 'ENGINEERING_DOCUMENT_LINK_FORBIDDEN';
  END IF;
  SELECT * INTO d FROM public.documents WHERE id = p_document;
  IF NOT FOUND OR d.company_id IS DISTINCT FROM p_company THEN
    RAISE EXCEPTION 'ENGINEERING_DOCUMENT_FOREIGN';
  END IF;
  IF d.status IS DISTINCT FROM 'AVAILABLE' THEN
    RAISE EXCEPTION 'ENGINEERING_DOCUMENT_UNAVAILABLE';
  END IF;
  SELECT id INTO v_id FROM public.engineering_request_documents WHERE request_id = p_request AND document_id = p_document;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_id := gen_random_uuid();
  INSERT INTO public.engineering_request_documents(id, request_id, company_id, document_id, classification, linked_by)
  VALUES (v_id, p_request, p_company, p_document, p_classification, p_actor);
  UPDATE public.documents SET
    linked_entity_type = 'ENGINEERING_REQUEST',
    linked_entity_id = p_request
  WHERE id = p_document;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, p_company, 'TENANT', 'engineering.document.linked', 'EngineeringRequestDocument', v_id,
          jsonb_build_object('requestId', p_request, 'documentId', p_document, 'classification', p_classification), p_correlation);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_engineering_assign(
  p_actor UUID, p_request UUID, p_engineer UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD;
BEGIN
  IF NOT public.engineering_internal_capability(p_actor, 'engineering.request.assign') THEN
    RAISE EXCEPTION 'ENGINEERING_ASSIGN_FORBIDDEN';
  END IF;
  SELECT * INTO r FROM public.engineering_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENGINEERING_REQUEST_NOT_FOUND'; END IF;
  IF r.status NOT IN ('SUBMITTED','ASSIGNED','IN_REVIEW','ACTION_REQUIRED','BOQ_IN_PROGRESS') THEN
    RAISE EXCEPTION 'ENGINEERING_ASSIGN_STATE_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."CompanyMembership" cm
     JOIN public."Company" c ON c.id = cm."companyId"
    WHERE cm."userId" = p_engineer AND cm.status = 'ACTIVE' AND c.type = 'SCO' AND c.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'ENGINEERING_ENGINEER_INVALID';
  END IF;
  UPDATE public.engineering_requests SET
    assigned_engineer_id = p_engineer, assigned_by = p_actor, assigned_at = clock_timestamp(),
    status = CASE WHEN status = 'SUBMITTED' THEN 'ASSIGNED' ELSE status END,
    updated_at = clock_timestamp()
  WHERE id = p_request;
  INSERT INTO public.engineering_request_events(request_id, company_id, from_status, to_status, actor_user_id, correlation_id)
  VALUES (p_request, r.company_id, r.status,
          CASE WHEN r.status = 'SUBMITTED' THEN 'ASSIGNED' ELSE r.status END, p_actor, p_correlation);
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, r.company_id, 'SCO_INTERNAL', 'engineering.request.assigned', 'EngineeringRequest', p_request,
          jsonb_build_object('engineerId', p_engineer), p_correlation);
  RETURN p_request;
END $$;

CREATE OR REPLACE FUNCTION public.internal_engineering_transition(
  p_actor UUID, p_request UUID, p_next TEXT, p_reason TEXT, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD; allowed BOOLEAN := false;
BEGIN
  IF NOT public.engineering_internal_capability(p_actor, 'engineering.request.review') THEN
    RAISE EXCEPTION 'ENGINEERING_REVIEW_FORBIDDEN';
  END IF;
  SELECT * INTO r FROM public.engineering_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENGINEERING_REQUEST_NOT_FOUND'; END IF;
  IF r.status = p_next THEN RETURN p_request; END IF;
  IF (r.status IN ('SUBMITTED','ASSIGNED') AND p_next = 'IN_REVIEW')
     OR (r.status = 'IN_REVIEW' AND p_next IN ('ACTION_REQUIRED','BOQ_IN_PROGRESS','PENDING_APPROVAL'))
     OR (r.status = 'ACTION_REQUIRED' AND p_next IN ('IN_REVIEW','BOQ_IN_PROGRESS'))
     OR (r.status = 'BOQ_IN_PROGRESS' AND p_next IN ('PENDING_APPROVAL','IN_REVIEW'))
     OR (r.status = 'PENDING_APPROVAL' AND p_next IN ('BOQ_IN_PROGRESS','APPROVED')) THEN
    allowed := true;
  END IF;
  IF NOT allowed THEN RAISE EXCEPTION 'ENGINEERING_STATE_INVALID'; END IF;
  UPDATE public.engineering_requests SET
    status = p_next,
    action_required_message = CASE WHEN p_next = 'ACTION_REQUIRED' THEN NULLIF(btrim(COALESCE(p_reason,'')), '') ELSE action_required_message END,
    partner_visible_notes = CASE WHEN p_next = 'ACTION_REQUIRED' THEN NULLIF(btrim(COALESCE(p_reason,'')), '') ELSE partner_visible_notes END,
    updated_at = clock_timestamp()
  WHERE id = p_request;
  INSERT INTO public.engineering_request_events(request_id, company_id, from_status, to_status, actor_user_id, reason, correlation_id)
  VALUES (p_request, r.company_id, r.status, p_next, p_actor, NULLIF(btrim(COALESCE(p_reason,'')), ''), p_correlation);
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, r.company_id, 'SCO_INTERNAL', 'engineering.request.transitioned', 'EngineeringRequest', p_request,
          jsonb_build_object('fromStatus', r.status, 'toStatus', p_next), p_correlation);
  RETURN p_request;
END $$;

CREATE OR REPLACE FUNCTION public.internal_engineering_boq_version_create(
  p_actor UUID, p_request UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD; v_num INT; v_id UUID; v_prev UUID;
BEGIN
  IF NOT public.engineering_internal_capability(p_actor, 'engineering.boq.edit') THEN
    RAISE EXCEPTION 'ENGINEERING_BOQ_EDIT_FORBIDDEN';
  END IF;
  SELECT * INTO r FROM public.engineering_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENGINEERING_REQUEST_NOT_FOUND'; END IF;
  IF r.status NOT IN ('ASSIGNED','IN_REVIEW','BOQ_IN_PROGRESS','PENDING_APPROVAL','ACTION_REQUIRED','APPROVED') THEN
    RAISE EXCEPTION 'ENGINEERING_BOQ_CREATE_STATE_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.engineering_boq_versions WHERE request_id = p_request AND status = 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'ENGINEERING_BOQ_DRAFT_EXISTS';
  END IF;
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_num FROM public.engineering_boq_versions WHERE request_id = p_request;
  SELECT id INTO v_prev FROM public.engineering_boq_versions
   WHERE request_id = p_request AND status = 'APPROVED' ORDER BY version_number DESC LIMIT 1;
  v_id := gen_random_uuid();
  INSERT INTO public.engineering_boq_versions(
    id, request_id, company_id, version_number, status, supersedes_version_id, created_by
  ) VALUES (v_id, p_request, r.company_id, v_num, 'DRAFT', v_prev, p_actor);
  -- copy lines from previous approved if any
  IF v_prev IS NOT NULL THEN
    INSERT INTO public.engineering_boq_lines(
      boq_version_id, request_id, company_id, line_key, description, specification, discipline,
      unit_id, quantity, brand_preference, model_preference, engineering_notes, partner_visible_notes,
      source_document_id, source_reference, sort_order
    )
    SELECT v_id, request_id, company_id, line_key, description, specification, discipline,
           unit_id, quantity, brand_preference, model_preference, engineering_notes, partner_visible_notes,
           source_document_id, source_reference, sort_order
      FROM public.engineering_boq_lines WHERE boq_version_id = v_prev;
  END IF;
  UPDATE public.engineering_requests SET
    status = CASE WHEN status IN ('ASSIGNED','IN_REVIEW','ACTION_REQUIRED','APPROVED') THEN 'BOQ_IN_PROGRESS' ELSE status END,
    updated_at = clock_timestamp()
  WHERE id = p_request;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, r.company_id, 'SCO_INTERNAL', 'engineering.boq.version_created', 'EngineeringBoqVersion', v_id,
          jsonb_build_object('requestId', p_request, 'versionNumber', v_num), p_correlation);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_engineering_boq_line_upsert(
  p_actor UUID, p_version UUID, p_line UUID,
  p_description TEXT, p_specification TEXT, p_discipline TEXT,
  p_quantity NUMERIC, p_unit UUID, p_brand TEXT, p_model TEXT,
  p_engineering_notes TEXT, p_partner_notes TEXT,
  p_source_document UUID, p_source_reference TEXT, p_sort INTEGER, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v RECORD; v_id UUID; v_key TEXT;
BEGIN
  IF NOT public.engineering_internal_capability(p_actor, 'engineering.boq.edit') THEN
    RAISE EXCEPTION 'ENGINEERING_BOQ_EDIT_FORBIDDEN';
  END IF;
  SELECT * INTO v FROM public.engineering_boq_versions WHERE id = p_version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENGINEERING_BOQ_NOT_FOUND'; END IF;
  IF v.status <> 'DRAFT' THEN RAISE EXCEPTION 'ENGINEERING_BOQ_NOT_EDITABLE'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'ENGINEERING_QUANTITY_INVALID'; END IF;
  IF p_unit IS NULL OR NOT EXISTS (SELECT 1 FROM public.unit_definitions WHERE id = p_unit) THEN
    RAISE EXCEPTION 'ENGINEERING_UNIT_REQUIRED';
  END IF;
  IF p_line IS NOT NULL THEN
    SELECT id INTO v_id FROM public.engineering_boq_lines WHERE id = p_line AND boq_version_id = p_version;
    IF v_id IS NULL THEN RAISE EXCEPTION 'ENGINEERING_LINE_NOT_FOUND'; END IF;
    UPDATE public.engineering_boq_lines SET
      description = btrim(p_description), specification = NULLIF(btrim(COALESCE(p_specification,'')), ''),
      discipline = p_discipline, quantity = p_quantity, unit_id = p_unit,
      brand_preference = NULLIF(btrim(COALESCE(p_brand,'')), ''),
      model_preference = NULLIF(btrim(COALESCE(p_model,'')), ''),
      engineering_notes = NULLIF(btrim(COALESCE(p_engineering_notes,'')), ''),
      partner_visible_notes = NULLIF(btrim(COALESCE(p_partner_notes,'')), ''),
      source_document_id = p_source_document,
      source_reference = NULLIF(btrim(COALESCE(p_source_reference,'')), ''),
      sort_order = COALESCE(p_sort, sort_order),
      updated_at = clock_timestamp()
    WHERE id = v_id;
  ELSE
    v_id := gen_random_uuid();
    v_key := 'L-' || replace(v_id::text, '-', '');
    INSERT INTO public.engineering_boq_lines(
      id, boq_version_id, request_id, company_id, line_key, description, specification, discipline,
      unit_id, quantity, brand_preference, model_preference, engineering_notes, partner_visible_notes,
      source_document_id, source_reference, sort_order
    ) VALUES (
      v_id, p_version, v.request_id, v.company_id, v_key, btrim(p_description),
      NULLIF(btrim(COALESCE(p_specification,'')), ''), p_discipline, p_unit, p_quantity,
      NULLIF(btrim(COALESCE(p_brand,'')), ''), NULLIF(btrim(COALESCE(p_model,'')), ''),
      NULLIF(btrim(COALESCE(p_engineering_notes,'')), ''), NULLIF(btrim(COALESCE(p_partner_notes,'')), ''),
      p_source_document, NULLIF(btrim(COALESCE(p_source_reference,'')), ''), COALESCE(p_sort, 0)
    );
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_engineering_boq_approve(
  p_actor UUID, p_version UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v RECORD; r RECORD;
BEGIN
  IF NOT public.engineering_internal_capability(p_actor, 'engineering.boq.approve') THEN
    RAISE EXCEPTION 'ENGINEERING_BOQ_APPROVE_FORBIDDEN';
  END IF;
  SELECT * INTO v FROM public.engineering_boq_versions WHERE id = p_version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENGINEERING_BOQ_NOT_FOUND'; END IF;
  IF v.status = 'APPROVED' THEN RETURN p_version; END IF; -- idempotent
  IF v.status <> 'DRAFT' AND v.status <> 'IN_REVIEW' THEN
    RAISE EXCEPTION 'ENGINEERING_BOQ_NOT_APPROVABLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.engineering_boq_lines WHERE boq_version_id = p_version) THEN
    RAISE EXCEPTION 'ENGINEERING_BOQ_EMPTY';
  END IF;
  SELECT * INTO r FROM public.engineering_requests WHERE id = v.request_id FOR UPDATE;
  -- supersede prior approved
  UPDATE public.engineering_boq_versions SET status = 'SUPERSEDED', updated_at = clock_timestamp()
   WHERE request_id = v.request_id AND status = 'APPROVED' AND id <> p_version;
  UPDATE public.engineering_boq_versions SET
    status = 'APPROVED', approved_by = p_actor, approved_at = clock_timestamp(),
    reviewed_by = COALESCE(reviewed_by, p_actor), updated_at = clock_timestamp()
  WHERE id = p_version;
  UPDATE public.engineering_requests SET
    status = 'APPROVED',
    current_approved_boq_version_id = p_version,
    updated_at = clock_timestamp()
  WHERE id = v.request_id;
  INSERT INTO public.engineering_request_events(request_id, company_id, from_status, to_status, actor_user_id, correlation_id)
  VALUES (v.request_id, v.company_id, r.status, 'APPROVED', p_actor, p_correlation);
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, v.company_id, 'SCO_INTERNAL', 'engineering.boq.approved', 'EngineeringBoqVersion', p_version,
          jsonb_build_object('requestId', v.request_id, 'versionNumber', v.version_number), p_correlation);
  RETURN p_version;
END $$;

-- F→D handoff: creates D procurement requirement + lines from approved F BOQ; never mutates prior handoff
CREATE OR REPLACE FUNCTION public.internal_engineering_d_handoff(
  p_actor UUID, p_version UUID, p_delivery_location TEXT, p_idempotency_key TEXT, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v RECORD; r RECORD; v_existing UUID; v_req UUID; v_line RECORD; v_line_id UUID; v_key TEXT;
  v_n INT := 0;
BEGIN
  IF NOT public.engineering_internal_capability(p_actor, 'engineering.boq.approve') THEN
    RAISE EXCEPTION 'ENGINEERING_HANDOFF_FORBIDDEN';
  END IF;
  IF btrim(COALESCE(p_idempotency_key,'')) = '' THEN RAISE EXCEPTION 'ENGINEERING_IDEMPOTENCY_REQUIRED'; END IF;
  SELECT id INTO v_existing FROM public.engineering_d_handoffs WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT * INTO v FROM public.engineering_boq_versions WHERE id = p_version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENGINEERING_BOQ_NOT_FOUND'; END IF;
  IF v.status <> 'APPROVED' THEN RAISE EXCEPTION 'ENGINEERING_HANDOFF_UNAPPROVED'; END IF;

  SELECT id INTO v_existing FROM public.engineering_d_handoffs WHERE boq_version_id = p_version;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT * INTO r FROM public.engineering_requests WHERE id = v.request_id FOR UPDATE;
  -- Partner company eligibility for D
  IF NOT EXISTS (
    SELECT 1 FROM public.company_partnerships cp
     JOIN public."Company" c ON c.id = cp.company_id AND c.type = 'PARTNER' AND c.status = 'ACTIVE'
    WHERE cp.company_id = r.company_id AND cp.type = 'BUYER_PARTNERSHIP' AND cp.status = 'ACTIVE'
  ) OR NOT public.partner_required_agreements_satisfied(r.company_id) THEN
    RAISE EXCEPTION 'ENGINEERING_HANDOFF_PARTNER_INELIGIBLE';
  END IF;
  IF btrim(COALESCE(p_delivery_location,'')) = '' THEN
    RAISE EXCEPTION 'ENGINEERING_HANDOFF_DELIVERY_REQUIRED';
  END IF;

  v_req := gen_random_uuid();
  INSERT INTO public.procurement_requirements(
    id, company_id, created_by, title, reference_code, sector, project_reference,
    delivery_location, notes, status
  ) VALUES (
    v_req, r.company_id, p_actor,
    left('ENG: ' || r.title, 240),
    'F-' || upper(substr(replace(p_version::text,'-',''),1,10)),
    r.sector, r.project_reference, btrim(p_delivery_location),
    'Created from engineering BOQ v' || v.version_number::text || ' request ' || r.id::text,
    'DRAFT'
  );
  INSERT INTO public.procurement_requirement_events(requirement_id, company_id, from_status, to_status, actor_user_id, correlation_id)
  VALUES (v_req, r.company_id, NULL, 'DRAFT', p_actor, p_correlation);

  FOR v_line IN
    SELECT * FROM public.engineering_boq_lines WHERE boq_version_id = p_version ORDER BY sort_order, description
  LOOP
    v_n := v_n + 1;
    v_line_id := gen_random_uuid();
    v_key := COALESCE(NULLIF(btrim(v_line.line_key),''), 'L' || v_n::text);
    INSERT INTO public.procurement_requirement_lines(
      id, requirement_id, company_id, line_key, description, specification, quantity, unit_id,
      brand_preference, model_preference, technical_notes, sort_order
    ) VALUES (
      v_line_id, v_req, r.company_id, v_key, v_line.description, v_line.specification,
      v_line.quantity, v_line.unit_id, v_line.brand_preference, v_line.model_preference,
      COALESCE(v_line.engineering_notes, v_line.partner_visible_notes),
      v_line.sort_order
    );
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'ENGINEERING_HANDOFF_EMPTY_BOQ'; END IF;

  v_existing := gen_random_uuid();
  INSERT INTO public.engineering_d_handoffs(
    id, request_id, company_id, boq_version_id, procurement_requirement_id,
    handed_off_by, idempotency_key, correlation_id
  ) VALUES (
    v_existing, r.id, r.company_id, p_version, v_req, p_actor, p_idempotency_key, p_correlation
  );

  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, r.company_id, 'SCO_INTERNAL', 'engineering.d_handoff.created', 'EngineeringDHandoff', v_existing,
          jsonb_build_object('boqVersionId', p_version, 'procurementRequirementId', v_req, 'lineCount', v_n), p_correlation);
  RETURN v_existing;
END $$;

CREATE OR REPLACE FUNCTION public.partner_engineering_result_get(
  p_actor UUID, p_company UUID, p_request UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD; v RECORD;
BEGIN
  IF current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::text
     OR current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::text THEN
    RAISE EXCEPTION 'ENGINEERING_FORBIDDEN';
  END IF;
  IF NOT public.engineering_partner_eligible(p_actor, p_company) THEN
    RAISE EXCEPTION 'ENGINEERING_INELIGIBLE';
  END IF;
  SELECT * INTO r FROM public.engineering_requests WHERE id = p_request AND company_id = p_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENGINEERING_REQUEST_NOT_FOUND'; END IF;
  IF r.current_approved_boq_version_id IS NULL THEN
    RETURN jsonb_build_object(
      'requestId', r.id, 'status', r.status, 'title', r.title,
      'actionRequiredMessage', r.action_required_message,
      'partnerVisibleNotes', r.partner_visible_notes,
      'approvedResult', NULL,
      'handoff', (
        SELECT jsonb_build_object(
          'handoffId', h.id, 'procurementRequirementId', h.procurement_requirement_id,
          'boqVersionId', h.boq_version_id, 'handedOffAt', h.handed_off_at
        ) FROM public.engineering_d_handoffs h
         WHERE h.request_id = r.id AND h.status = 'CREATED'
         ORDER BY h.handed_off_at DESC LIMIT 1
      )
    );
  END IF;
  SELECT * INTO v FROM public.engineering_boq_versions WHERE id = r.current_approved_boq_version_id;
  RETURN jsonb_build_object(
    'requestId', r.id,
    'status', r.status,
    'title', r.title,
    'sector', r.sector,
    'projectReference', r.project_reference,
    'actionRequiredMessage', r.action_required_message,
    'partnerVisibleNotes', r.partner_visible_notes,
    'approvedResult', jsonb_build_object(
      'boqVersionId', v.id,
      'versionNumber', v.version_number,
      'status', v.status,
      'approvedAt', v.approved_at,
      'partnerVisibleNotes', v.partner_visible_notes,
      'lines', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', l.id,
          'lineKey', l.line_key,
          'description', l.description,
          'specification', l.specification,
          'discipline', l.discipline,
          'quantity', l.quantity,
          'unitId', l.unit_id,
          'brandPreference', l.brand_preference,
          'modelPreference', l.model_preference,
          'partnerVisibleNotes', l.partner_visible_notes,
          'sourceReference', l.source_reference,
          'sortOrder', l.sort_order
        ) ORDER BY l.sort_order, l.description)
        FROM public.engineering_boq_lines l WHERE l.boq_version_id = v.id
      ), '[]'::jsonb)
    ),
    'handoff', (
      SELECT jsonb_build_object(
        'handoffId', h.id, 'procurementRequirementId', h.procurement_requirement_id,
        'boqVersionId', h.boq_version_id, 'handedOffAt', h.handed_off_at
      ) FROM public.engineering_d_handoffs h
       WHERE h.request_id = r.id AND h.status = 'CREATED'
       ORDER BY h.handed_off_at DESC LIMIT 1
    )
  );
END $$;

-- Grants
REVOKE ALL ON FUNCTION public.engineering_partner_eligible(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.engineering_internal_capability(UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_engineering_request_create(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_engineering_request_update_draft(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_engineering_request_submit(UUID,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_engineering_document_link(UUID,UUID,UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_engineering_assign(UUID,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_engineering_transition(UUID,UUID,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_engineering_boq_version_create(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_engineering_boq_line_upsert(UUID,UUID,UUID,TEXT,TEXT,TEXT,NUMERIC,UUID,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,INTEGER,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_engineering_boq_approve(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_engineering_d_handoff(UUID,UUID,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_engineering_result_get(UUID,UUID,UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.engineering_partner_eligible(UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.engineering_internal_capability(UUID,TEXT) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.partner_engineering_request_create(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.partner_engineering_request_update_draft(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.partner_engineering_request_submit(UUID,UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.partner_engineering_document_link(UUID,UUID,UUID,UUID,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_engineering_assign(UUID,UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_engineering_transition(UUID,UUID,TEXT,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_engineering_boq_version_create(UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_engineering_boq_line_upsert(UUID,UUID,UUID,TEXT,TEXT,TEXT,NUMERIC,UUID,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,INTEGER,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_engineering_boq_approve(UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_engineering_d_handoff(UUID,UUID,TEXT,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.partner_engineering_result_get(UUID,UUID,UUID) TO sco_runtime;
