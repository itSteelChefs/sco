-- Wave2 partner functional core: qualification self-serve, document upload metadata, agreement launch types.
-- Does not modify 0108/0109. No deletion scheduler.

-- 1) Qualification status extension
ALTER TYPE "QualificationStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "QualificationStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';

-- 2) Launch profile fields on canonical qualification_applications
ALTER TABLE public.qualification_applications
  ADD COLUMN IF NOT EXISTS commercial_identifier TEXT,
  ADD COLUMN IF NOT EXISTS responsible_person TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS sector TEXT,
  ADD COLUMN IF NOT EXISTS need_type TEXT,
  ADD COLUMN IF NOT EXISTS procurement_size TEXT,
  ADD COLUMN IF NOT EXISTS procurement_frequency TEXT;

ALTER TABLE public.qualification_applications
  DROP CONSTRAINT IF EXISTS qualification_applications_sector_check,
  DROP CONSTRAINT IF EXISTS qualification_applications_need_type_check,
  DROP CONSTRAINT IF EXISTS qualification_applications_procurement_size_check,
  DROP CONSTRAINT IF EXISTS qualification_applications_procurement_frequency_check;

ALTER TABLE public.qualification_applications
  ADD CONSTRAINT qualification_applications_sector_check
    CHECK (sector IS NULL OR sector IN ('HVAC_REFRIGERATION','ELECTRICAL','PLUMBING','MULTI')),
  ADD CONSTRAINT qualification_applications_need_type_check
    CHECK (need_type IS NULL OR need_type IN ('VERIFY_QUOTE_CHECK','PROCUREMENT_SUPPORT','BOTH')),
  ADD CONSTRAINT qualification_applications_procurement_size_check
    CHECK (procurement_size IS NULL OR procurement_size IN ('SMALL','MEDIUM','LARGE','PROJECT_BASED')),
  ADD CONSTRAINT qualification_applications_procurement_frequency_check
    CHECK (procurement_frequency IS NULL OR procurement_frequency IN ('OCCASIONAL','MONTHLY','WEEKLY','PROJECT_BASED'));

-- Event status checks must accept new values
ALTER TABLE public.qualification_application_events
  DROP CONSTRAINT IF EXISTS qualification_application_events_from_status_check,
  DROP CONSTRAINT IF EXISTS qualification_application_events_to_status_check;
ALTER TABLE public.qualification_application_events
  ADD CONSTRAINT qualification_application_events_from_status_check
    CHECK (from_status IS NULL OR from_status IN ('DRAFT','APPLICATION','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED')),
  ADD CONSTRAINT qualification_application_events_to_status_check
    CHECK (to_status IN ('DRAFT','APPLICATION','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED'));

-- 3) Permissions
INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'partner.qualification.write', 'Partner create/update/submit own company qualification draft'),
  (gen_random_uuid(), 'partner.document.upload', 'Partner upload tenant documents for qualification/agreements/verify quote')
ON CONFLICT (code) DO NOTHING;

-- 4) Document metadata for Partner upload surface
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS document_category TEXT,
  ADD COLUMN IF NOT EXISTS retention_class TEXT,
  ADD COLUMN IF NOT EXISTS linked_entity_type TEXT,
  ADD COLUMN IF NOT EXISTS linked_entity_id UUID;

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_document_category_check,
  DROP CONSTRAINT IF EXISTS documents_retention_class_check,
  DROP CONSTRAINT IF EXISTS documents_linked_entity_type_check;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_document_category_check
    CHECK (document_category IS NULL OR document_category IN ('QUALIFICATION_SUPPORT','AGREEMENT_ARTIFACT','VERIFY_QUOTE','GENERAL')),
  ADD CONSTRAINT documents_retention_class_check
    CHECK (retention_class IS NULL OR retention_class IN ('PARTNER_ORIGINAL','PROCESSED_DERIVATIVE','VERIFY_RESULT','AUDIT_RECORD')),
  ADD CONSTRAINT documents_linked_entity_type_check
    CHECK (
      (linked_entity_type IS NULL AND linked_entity_id IS NULL)
      OR linked_entity_type IN ('QUALIFICATION_APPLICATION','VERIFY_REQUEST','AGREEMENT_POLICY_VERSION')
    );

COMMENT ON COLUMN public.documents.retention_class IS
  'Wave2 metadata only. Policy: retain while relationship active + 5 years after last activity/termination unless longer legal hold. No auto-delete worker.';

-- 5) Launch agreement types: PARTNERSHIP_TERMS cannot be optional (same posture as Binding Confidentiality)
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'public.partner_agreement_policy_versions'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%BINDING_CONFIDENTIALITY%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.partner_agreement_policy_versions DROP CONSTRAINT %I', cname);
  END IF;
END $$;
ALTER TABLE public.partner_agreement_policy_versions
  ADD CONSTRAINT partner_agreement_policy_versions_launch_required_check
  CHECK (
    agreement_type NOT IN ('BINDING_CONFIDENTIALITY', 'PARTNERSHIP_TERMS')
    OR required = TRUE
  );

-- 6) Partner qualification write gateways
CREATE OR REPLACE FUNCTION public.partner_qualification_write_allowed(p_actor UUID, p_company UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public."User" u
      JOIN public."CompanyMembership" m ON m."userId"=u.id AND m."companyId"=p_company AND m.status='ACTIVE'
      JOIN public."Company" c ON c.id=m."companyId" AND c.type='PARTNER' AND c.status='ACTIVE'
      JOIN public."MembershipRole" mr ON mr.membership_id=m.id
      JOIN public."RolePermission" rp ON rp.role_id=mr.role_id
      JOIN public."Permission" p ON p.id=rp.permission_id AND p.code='partner.qualification.write'
     WHERE u.id=p_actor AND u.status='ACTIVE'
       AND current_setting('app.actor_id', true)=p_actor::TEXT
       AND current_setting('app.tenant_id', true)=p_company::TEXT
  );
$$;

CREATE OR REPLACE FUNCTION public.partner_qualification_current(p_actor UUID, p_company UUID)
RETURNS TABLE(
  id UUID,
  status TEXT,
  legal_name TEXT,
  commercial_identifier TEXT,
  responsible_person TEXT,
  contact_email TEXT,
  city TEXT,
  sector TEXT,
  need_type TEXT,
  procurement_size TEXT,
  procurement_frequency TEXT,
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.partner_qualification_write_allowed(p_actor, p_company)
     AND NOT EXISTS (
       SELECT 1 FROM public."User" u
       JOIN public."CompanyMembership" m ON m."userId"=u.id AND m."companyId"=p_company AND m.status='ACTIVE'
       JOIN public."MembershipRole" mr ON mr.membership_id=m.id
       JOIN public."RolePermission" rp ON rp.role_id=mr.role_id
       JOIN public."Permission" p ON p.id=rp.permission_id AND p.code='partner.admission.read'
       WHERE u.id=p_actor AND u.status='ACTIVE'
         AND current_setting('app.actor_id', true)=p_actor::TEXT
         AND current_setting('app.tenant_id', true)=p_company::TEXT
     ) THEN
    RAISE EXCEPTION 'PARTNER_QUALIFICATION_FORBIDDEN';
  END IF;
  RETURN QUERY
  SELECT q.id, q.status::TEXT, q.legal_name, q.commercial_identifier, q.responsible_person, q.contact_email,
         q.city, q.sector, q.need_type, q.procurement_size, q.procurement_frequency,
         CASE WHEN q.status::TEXT IN ('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED') THEN q.updated_at ELSE NULL END,
         q.updated_at
    FROM public.qualification_applications q
   WHERE q.company_id = p_company
   ORDER BY q.created_at DESC
   LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.partner_qualification_draft_upsert(
  p_actor UUID, p_company UUID,
  p_legal_name TEXT, p_commercial_identifier TEXT, p_responsible_person TEXT, p_contact_email TEXT,
  p_city TEXT, p_sector TEXT, p_need_type TEXT, p_procurement_size TEXT, p_procurement_frequency TEXT,
  p_correlation UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing RECORD;
  new_id UUID;
  legal TEXT := NULLIF(btrim(COALESCE(p_legal_name,'')), '');
  contact TEXT := NULLIF(btrim(COALESCE(p_contact_email,'')), '');
  person TEXT := NULLIF(btrim(COALESCE(p_responsible_person,'')), '');
  city_v TEXT := NULLIF(btrim(COALESCE(p_city,'')), '');
  sector_v TEXT := NULLIF(btrim(COALESCE(p_sector,'')), '');
  need_v TEXT := NULLIF(btrim(COALESCE(p_need_type,'')), '');
  size_v TEXT := NULLIF(btrim(COALESCE(p_procurement_size,'')), '');
  freq_v TEXT := NULLIF(btrim(COALESCE(p_procurement_frequency,'')), '');
  commercial TEXT := NULLIF(btrim(COALESCE(p_commercial_identifier,'')), '');
BEGIN
  IF NOT public.partner_qualification_write_allowed(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_QUALIFICATION_FORBIDDEN';
  END IF;
  IF legal IS NULL OR contact IS NULL OR person IS NULL OR city_v IS NULL OR sector_v IS NULL OR need_v IS NULL OR size_v IS NULL OR freq_v IS NULL THEN
    RAISE EXCEPTION 'QUALIFICATION_VALIDATION_FAILED';
  END IF;
  IF sector_v NOT IN ('HVAC_REFRIGERATION','ELECTRICAL','PLUMBING','MULTI')
     OR need_v NOT IN ('VERIFY_QUOTE_CHECK','PROCUREMENT_SUPPORT','BOTH')
     OR size_v NOT IN ('SMALL','MEDIUM','LARGE','PROJECT_BASED')
     OR freq_v NOT IN ('OCCASIONAL','MONTHLY','WEEKLY','PROJECT_BASED') THEN
    RAISE EXCEPTION 'QUALIFICATION_VALIDATION_FAILED';
  END IF;

  SELECT * INTO existing FROM public.qualification_applications WHERE company_id=p_company ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF existing.status::TEXT NOT IN ('DRAFT','APPLICATION') THEN
      RAISE EXCEPTION 'QUALIFICATION_ALREADY_SUBMITTED';
    END IF;
    UPDATE public.qualification_applications SET
      legal_name=legal, commercial_identifier=commercial, responsible_person=person, contact_email=contact,
      city=city_v, sector=sector_v, need_type=need_v, procurement_size=size_v, procurement_frequency=freq_v,
      status='DRAFT', updated_at=clock_timestamp()
     WHERE id=existing.id;
    INSERT INTO public.audit_logs(company_id, actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
    VALUES (p_company, p_actor, 'TENANT', 'qualification.draft_saved', 'QualificationApplication', existing.id,
      jsonb_build_object('status','DRAFT'), p_correlation);
    RETURN existing.id;
  END IF;

  new_id := gen_random_uuid();
  INSERT INTO public.qualification_applications(
    id, company_id, legal_name, contact_email, status, submitted_by,
    commercial_identifier, responsible_person, city, sector, need_type, procurement_size, procurement_frequency
  ) VALUES (
    new_id, p_company, legal, contact, 'DRAFT', p_actor,
    commercial, person, city_v, sector_v, need_v, size_v, freq_v
  );
  INSERT INTO public.qualification_application_events(id, qualification_application_id, company_id, from_status, to_status, actor_user_id, correlation_id)
  VALUES (gen_random_uuid(), new_id, p_company, NULL, 'DRAFT', p_actor, COALESCE(p_correlation, gen_random_uuid()));
  INSERT INTO public.audit_logs(company_id, actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_company, p_actor, 'TENANT', 'qualification.draft_created', 'QualificationApplication', new_id,
    jsonb_build_object('status','DRAFT'), p_correlation);
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.partner_qualification_submit(p_actor UUID, p_company UUID, p_correlation UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE existing RECORD;
BEGIN
  IF NOT public.partner_qualification_write_allowed(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_QUALIFICATION_FORBIDDEN';
  END IF;
  SELECT * INTO existing FROM public.qualification_applications WHERE company_id=p_company ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUALIFICATION_NOT_FOUND'; END IF;
  IF existing.status::TEXT = 'SUBMITTED' THEN
    RETURN existing.id; -- idempotent converge
  END IF;
  IF existing.status::TEXT NOT IN ('DRAFT','APPLICATION') THEN
    RAISE EXCEPTION 'QUALIFICATION_ALREADY_SUBMITTED';
  END IF;
  IF NULLIF(btrim(existing.legal_name),'') IS NULL OR NULLIF(btrim(existing.contact_email),'') IS NULL
     OR NULLIF(btrim(COALESCE(existing.responsible_person,'')),'') IS NULL
     OR NULLIF(btrim(COALESCE(existing.city,'')),'') IS NULL
     OR NULLIF(btrim(COALESCE(existing.sector,'')),'') IS NULL
     OR NULLIF(btrim(COALESCE(existing.need_type,'')),'') IS NULL
     OR NULLIF(btrim(COALESCE(existing.procurement_size,'')),'') IS NULL
     OR NULLIF(btrim(COALESCE(existing.procurement_frequency,'')),'') IS NULL THEN
    RAISE EXCEPTION 'QUALIFICATION_VALIDATION_FAILED';
  END IF;
  UPDATE public.qualification_applications
     SET status='SUBMITTED', submitted_by=p_actor, updated_at=clock_timestamp()
   WHERE id=existing.id;
  INSERT INTO public.qualification_application_events(id, qualification_application_id, company_id, from_status, to_status, actor_user_id, correlation_id)
  VALUES (gen_random_uuid(), existing.id, p_company, existing.status::TEXT, 'SUBMITTED', p_actor, COALESCE(p_correlation, gen_random_uuid()));
  INSERT INTO public.audit_logs(company_id, actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_company, p_actor, 'TENANT', 'qualification.submitted', 'QualificationApplication', existing.id,
    jsonb_build_object('fromStatus', existing.status::TEXT, 'toStatus', 'SUBMITTED'), p_correlation);
  RETURN existing.id;
END;
$$;

-- Allow SCO decide from SUBMITTED as well as APPLICATION/UNDER_REVIEW (preserve return shape)
CREATE OR REPLACE FUNCTION public.internal_qualification_decide(p_actor UUID, p_id UUID, p_status TEXT, p_reason TEXT)
RETURNS TABLE(id UUID, status TEXT, "decisionReason" TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE application public.qualification_applications%ROWTYPE; correlation UUID := gen_random_uuid();
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'qualification.manage') THEN RAISE EXCEPTION 'QUALIFICATION_MANAGE_FORBIDDEN'; END IF;
  IF p_status NOT IN ('APPROVED','REJECTED') OR btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_QUALIFICATION_DECISION';
  END IF;
  SELECT * INTO application FROM public.qualification_applications WHERE qualification_applications.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUALIFICATION_NOT_FOUND'; END IF;
  IF application.status::TEXT = p_status THEN
    RETURN QUERY SELECT application.id, application.status::TEXT, application.decision_reason;
    RETURN;
  END IF;
  IF application.status::TEXT NOT IN ('APPLICATION','SUBMITTED','UNDER_REVIEW') THEN RAISE EXCEPTION 'QUALIFICATION_STATE_INVALID'; END IF;
  UPDATE public.qualification_applications
     SET status = p_status::"QualificationStatus", reviewed_by = p_actor, reviewed_at = clock_timestamp(),
         decision_reason = p_reason, updated_at = clock_timestamp()
   WHERE qualification_applications.id = p_id;
  INSERT INTO public.qualification_application_events (
    qualification_application_id, company_id, from_status, to_status, actor_user_id, reason, correlation_id
  ) VALUES (application.id, application.company_id, application.status::TEXT, p_status, p_actor, p_reason, correlation);
  INSERT INTO public.audit_logs (
    actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision
  ) VALUES (
    p_actor, application.company_id, 'SCO_INTERNAL', 'qualification.' || lower(p_status),
    'QualificationApplication', p_id, jsonb_build_object('reason', p_reason), correlation, 'PUR-03', 'ALLOWED'
  );
  RETURN QUERY SELECT updated.id, updated.status::TEXT, updated.decision_reason
    FROM public.qualification_applications updated WHERE updated.id = p_id;
END $$;

-- Mark eligible price-bearing lines READY for a draft revision (Partner write path helper)
DROP FUNCTION IF EXISTS public.partner_verify_revision_mark_ready(UUID, UUID, UUID, UUID);
CREATE OR REPLACE FUNCTION public.partner_verify_revision_mark_ready(
  p_actor UUID, p_company UUID, p_revision UUID, p_correlation TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE line_id UUID; marked INTEGER := 0;
BEGIN
  IF NOT public.verify_partner_lifecycle_authorized(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_FORBIDDEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.verify_quote_revisions revision
    JOIN public.verify_requests request_record ON request_record.id = revision.verify_request_id
   WHERE revision.id = p_revision
     AND request_record.company_id = p_company
     AND revision.status = 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_NOT_AVAILABLE';
  END IF;
  FOR line_id IN
    SELECT line.id FROM public.verify_quote_lines line
     WHERE line.verify_quote_revision_id = p_revision
       AND line.is_price_bearing
       AND NOT line.is_informational
  LOOP
    BEGIN
      PERFORM public.partner_verify_line_readiness_set(
        p_actor, p_company, line_id, 'READY_FOR_VERIFICATION', NULL, p_correlation
      );
      marked := marked + 1;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%VERIFY_QUOTE_LINE_NOT_READY%' THEN RAISE; END IF;
    END;
  END LOOP;
  RETURN marked;
END;
$$;
REVOKE ALL ON FUNCTION public.partner_verify_revision_mark_ready(UUID,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_verify_revision_mark_ready(UUID,UUID,UUID,TEXT) TO sco_runtime;

-- Partner submit with quote-document requirement + idempotent re-submit
CREATE OR REPLACE FUNCTION public.partner_verify_request_submit_checked(
  p_actor UUID, p_company UUID, p_request UUID, p_revision UUID, p_correlation TEXT
) RETURNS TABLE(request_id UUID, revision_id UUID, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE request_record RECORD; revision_record RECORD;
BEGIN
  IF NOT public.verify_partner_lifecycle_authorized(p_actor, p_company) THEN
    RAISE EXCEPTION 'PARTNER_VERIFY_FORBIDDEN';
  END IF;
  SELECT * INTO request_record FROM public.verify_requests WHERE id = p_request AND company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PARTNER_VERIFY_NOT_AVAILABLE'; END IF;
  IF request_record.status = 'SUBMITTED' AND request_record.current_submitted_revision_id IS NOT DISTINCT FROM p_revision THEN
    RETURN QUERY SELECT p_request, p_revision, 'SUBMITTED'::TEXT;
    RETURN;
  END IF;
  IF request_record.status = 'SUBMITTED' THEN
    RAISE EXCEPTION 'VERIFY_ALREADY_SUBMITTED';
  END IF;
  SELECT * INTO revision_record FROM public.verify_quote_revisions WHERE id = p_revision AND verify_request_id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PARTNER_VERIFY_NOT_SUBMITTABLE'; END IF;
  IF revision_record.raw_content_document_id IS NULL THEN
    RAISE EXCEPTION 'VERIFY_QUOTE_REQUIRED';
  END IF;
  PERFORM public.partner_verify_request_submit(p_actor, p_company, p_request, p_revision, p_correlation);
  RETURN QUERY SELECT p_request, p_revision, 'SUBMITTED'::TEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.partner_verify_request_submit_checked(UUID,UUID,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_verify_request_submit_checked(UUID,UUID,UUID,UUID,TEXT) TO sco_runtime;

ALTER FUNCTION public.partner_qualification_write_allowed(UUID,UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.partner_qualification_current(UUID,UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.partner_qualification_draft_upsert(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.partner_qualification_submit(UUID,UUID,UUID) OWNER TO sco_partner_admission_gateway_owner;

REVOKE ALL ON FUNCTION public.partner_qualification_write_allowed(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_qualification_current(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_qualification_draft_upsert(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_qualification_submit(UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_qualification_current(UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.partner_qualification_draft_upsert(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.partner_qualification_submit(UUID,UUID,UUID) TO sco_runtime;
