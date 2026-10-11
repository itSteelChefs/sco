-- Post-Stage016 launch core: partner admission review, document center read gateways,
-- and the operational Verify result projection. Existing canonical tables and gateways
-- remain authoritative. This migration does not modify 0108/0109.

ALTER TYPE "QualificationStatus" ADD VALUE IF NOT EXISTS 'ACTION_REQUIRED';

ALTER TABLE public.qualification_applications
  ADD COLUMN IF NOT EXISTS partner_action_required_reason TEXT;

ALTER TABLE public.qualification_application_events
  DROP CONSTRAINT IF EXISTS qualification_application_events_from_status_check,
  DROP CONSTRAINT IF EXISTS qualification_application_events_to_status_check;
ALTER TABLE public.qualification_application_events
  ADD CONSTRAINT qualification_application_events_from_status_check
    CHECK (from_status IS NULL OR from_status IN ('DRAFT','APPLICATION','SUBMITTED','UNDER_REVIEW','ACTION_REQUIRED','APPROVED','REJECTED')),
  ADD CONSTRAINT qualification_application_events_to_status_check
    CHECK (to_status IN ('DRAFT','APPLICATION','SUBMITTED','UNDER_REVIEW','ACTION_REQUIRED','APPROVED','REJECTED'));

-- Partner-safe qualification projection. Internal reviewer identity and internal-only
-- decision fields are deliberately not part of this return contract.
DROP FUNCTION IF EXISTS public.partner_qualification_current(UUID, UUID);
CREATE FUNCTION public.partner_qualification_current(p_actor UUID, p_company UUID)
RETURNS TABLE(
  id UUID, status TEXT, review_state TEXT, action_required BOOLEAN, action_required_reason TEXT,
  legal_name TEXT, commercial_identifier TEXT, responsible_person TEXT, contact_email TEXT,
  city TEXT, sector TEXT, need_type TEXT, procurement_size TEXT, procurement_frequency TEXT,
  submitted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.partner_qualification_write_allowed(p_actor, p_company)
     AND NOT EXISTS (
       SELECT 1
       FROM public."User" u
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
  SELECT q.id, q.status::TEXT, q.status::TEXT,
         (q.status::TEXT = 'ACTION_REQUIRED'),
         CASE WHEN q.status::TEXT = 'ACTION_REQUIRED' THEN q.partner_action_required_reason ELSE NULL END,
         q.legal_name, q.commercial_identifier, q.responsible_person, q.contact_email,
         q.city, q.sector, q.need_type, q.procurement_size, q.procurement_frequency,
         CASE WHEN q.status::TEXT IN ('SUBMITTED','UNDER_REVIEW','ACTION_REQUIRED','APPROVED','REJECTED') THEN q.updated_at ELSE NULL END,
         q.updated_at
    FROM public.qualification_applications q
   WHERE q.company_id = p_company
   ORDER BY q.created_at DESC
   LIMIT 1;
END;
$$;

-- ACTION_REQUIRED is a controlled return-to-partner state. Saving a correction
-- returns the application to DRAFT and clears the partner-visible reason; submit
-- then uses the existing canonical submit gateway.
CREATE OR REPLACE FUNCTION public.partner_qualification_draft_upsert(
  p_actor UUID, p_company UUID,
  p_legal_name TEXT, p_commercial_identifier TEXT, p_responsible_person TEXT, p_contact_email TEXT,
  p_city TEXT, p_sector TEXT, p_need_type TEXT, p_procurement_size TEXT, p_procurement_frequency TEXT,
  p_correlation UUID
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
  previous_status TEXT;
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

  SELECT * INTO existing FROM public.qualification_applications
   WHERE company_id=p_company ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    previous_status := existing.status::TEXT;
    IF previous_status NOT IN ('DRAFT','APPLICATION','ACTION_REQUIRED') THEN
      RAISE EXCEPTION 'QUALIFICATION_ALREADY_SUBMITTED';
    END IF;
    UPDATE public.qualification_applications SET
      legal_name=legal, commercial_identifier=commercial, responsible_person=person, contact_email=contact,
      city=city_v, sector=sector_v, need_type=need_v, procurement_size=size_v, procurement_frequency=freq_v,
      status='DRAFT', partner_action_required_reason=NULL, updated_at=clock_timestamp()
     WHERE id=existing.id;
    IF previous_status <> 'DRAFT' THEN
      INSERT INTO public.qualification_application_events(
        id, qualification_application_id, company_id, from_status, to_status, actor_user_id, reason, correlation_id
      ) VALUES (gen_random_uuid(), existing.id, p_company, previous_status, 'DRAFT', p_actor, 'PARTNER_CORRECTION_SUBMITTED', COALESCE(p_correlation, gen_random_uuid()));
    END IF;
    INSERT INTO public.audit_logs(company_id, actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
    VALUES (p_company, p_actor, 'TENANT', 'qualification.draft_saved', 'QualificationApplication', existing.id,
      jsonb_build_object('status','DRAFT','fromStatus',previous_status), p_correlation);
    RETURN existing.id;
  END IF;

  new_id := gen_random_uuid();
  INSERT INTO public.qualification_applications(
    id, company_id, legal_name, contact_email, status, submitted_by,
    commercial_identifier, responsible_person, city, sector, need_type, procurement_size, procurement_frequency
  ) VALUES (new_id, p_company, legal, contact, 'DRAFT', p_actor, commercial, person, city_v, sector_v, need_v, size_v, freq_v);
  INSERT INTO public.qualification_application_events(id, qualification_application_id, company_id, from_status, to_status, actor_user_id, correlation_id)
  VALUES (gen_random_uuid(), new_id, p_company, NULL, 'DRAFT', p_actor, COALESCE(p_correlation, gen_random_uuid()));
  INSERT INTO public.audit_logs(company_id, actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_company, p_actor, 'TENANT', 'qualification.draft_created', 'QualificationApplication', new_id, jsonb_build_object('status','DRAFT'), p_correlation);
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.internal_qualification_transition(
  p_actor UUID, p_id UUID, p_status TEXT, p_reason TEXT, p_correlation UUID
)
RETURNS TABLE(id UUID, status TEXT, "decisionReason" TEXT, "actionRequiredReason" TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE application public.qualification_applications%ROWTYPE;
  correlation UUID := COALESCE(p_correlation, gen_random_uuid());
  old_status TEXT;
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'qualification.manage') THEN RAISE EXCEPTION 'QUALIFICATION_MANAGE_FORBIDDEN'; END IF;
  IF p_status NOT IN ('UNDER_REVIEW','ACTION_REQUIRED','APPROVED','REJECTED') OR btrim(COALESCE(p_reason,'')) = '' THEN
    RAISE EXCEPTION 'INVALID_QUALIFICATION_DECISION';
  END IF;
  SELECT * INTO application FROM public.qualification_applications WHERE qualification_applications.id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUALIFICATION_NOT_FOUND'; END IF;
  old_status := application.status::TEXT;
  IF old_status = p_status THEN
    RETURN QUERY SELECT application.id, old_status, application.decision_reason, application.partner_action_required_reason;
    RETURN;
  END IF;
  IF (p_status='UNDER_REVIEW' AND old_status NOT IN ('APPLICATION','SUBMITTED'))
     OR (p_status='ACTION_REQUIRED' AND old_status NOT IN ('SUBMITTED','UNDER_REVIEW'))
     OR (p_status IN ('APPROVED','REJECTED') AND old_status NOT IN ('APPLICATION','SUBMITTED','UNDER_REVIEW')) THEN
    RAISE EXCEPTION 'QUALIFICATION_STATE_INVALID';
  END IF;
  UPDATE public.qualification_applications SET
    status=p_status::"QualificationStatus", reviewed_by=p_actor, reviewed_at=clock_timestamp(),
    decision_reason=p_reason,
    partner_action_required_reason=CASE WHEN p_status='ACTION_REQUIRED' THEN p_reason ELSE NULL END,
    updated_at=clock_timestamp()
   WHERE qualification_applications.id=p_id;
  INSERT INTO public.qualification_application_events(
    id, qualification_application_id, company_id, from_status, to_status, actor_user_id, reason, correlation_id
  ) VALUES (gen_random_uuid(), application.id, application.company_id, old_status, p_status, p_actor, p_reason, correlation);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, authorization_decision)
  VALUES (p_actor, application.company_id, 'SCO_INTERNAL', CASE WHEN p_status='UNDER_REVIEW' THEN 'qualification.review_started' ELSE 'qualification.' || lower(p_status) END, 'QualificationApplication', p_id,
    jsonb_build_object('fromStatus', old_status, 'toStatus', p_status, 'reason', p_reason), correlation, 'PUR-03', 'ALLOWED');
  RETURN QUERY SELECT updated.id, updated.status::TEXT, updated.decision_reason, updated.partner_action_required_reason
    FROM public.qualification_applications updated WHERE updated.id=p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.internal_qualification_decide(p_actor UUID, p_id UUID, p_status TEXT, p_reason TEXT)
RETURNS TABLE(id UUID, status TEXT, "decisionReason" TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_status NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'INVALID_QUALIFICATION_DECISION'; END IF;
  RETURN QUERY SELECT t.id, t.status, t."decisionReason"
    FROM public.internal_qualification_transition(p_actor, p_id, p_status, p_reason, gen_random_uuid()) t;
END;
$$;

ALTER FUNCTION public.partner_qualification_current(UUID,UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.partner_qualification_draft_upsert(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID) OWNER TO sco_partner_admission_gateway_owner;
ALTER FUNCTION public.internal_qualification_transition(UUID,UUID,TEXT,TEXT,UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_qualification_decide(UUID,UUID,TEXT,TEXT) OWNER TO sco_internal_gateway_owner;
REVOKE ALL ON FUNCTION public.partner_qualification_current(UUID,UUID), public.partner_qualification_draft_upsert(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID), public.internal_qualification_transition(UUID,UUID,TEXT,TEXT,UUID), public.internal_qualification_decide(UUID,UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_qualification_current(UUID,UUID), public.partner_qualification_draft_upsert(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_qualification_transition(UUID,UUID,TEXT,TEXT,UUID), public.internal_qualification_decide(UUID,UUID,TEXT,TEXT) TO sco_internal_executor;

-- Internal document-center metadata read. The function is SECURITY DEFINER and the
-- internal gateway owner is SELECT-only on document metadata; storage keys never leave it.
CREATE OR REPLACE FUNCTION public.internal_document_list(p_actor UUID, p_limit INTEGER, p_offset INTEGER)
RETURNS TABLE(
  id UUID, company_id UUID, filename TEXT, detected_mime_type TEXT, byte_size BIGINT,
  status TEXT, document_category TEXT, retention_class TEXT, linked_entity_type TEXT,
  linked_entity_id UUID, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'document.policy.manage')
     AND NOT public.internal_has_capability(p_actor, 'qualification.manage')
     AND NOT public.internal_has_capability(p_actor, 'verify.analyst') THEN
    RAISE EXCEPTION 'DOCUMENT_READ_FORBIDDEN';
  END IF;
  RETURN QUERY SELECT d.id, d.company_id, d.filename, d.detected_mime_type, d.byte_size,
      d.status::TEXT, d.document_category, d.retention_class, d.linked_entity_type,
      d.linked_entity_id, d.created_at, d.updated_at
    FROM public.documents d
   ORDER BY d.created_at DESC, d.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;
ALTER FUNCTION public.internal_document_list(UUID,INTEGER,INTEGER) OWNER TO sco_internal_gateway_owner;
REVOKE ALL ON FUNCTION public.internal_document_list(UUID,INTEGER,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_document_list(UUID,INTEGER,INTEGER) TO sco_internal_executor;
GRANT SELECT ON public.documents TO sco_internal_gateway_owner;
DROP POLICY IF EXISTS documents_internal_gateway_read ON public.documents;
CREATE POLICY documents_internal_gateway_read ON public.documents FOR SELECT TO sco_internal_gateway_owner USING (true);

-- Immutable operational result preparation. Coverage and classification are still
-- computed exclusively from captured run scope; user-provided fields are a typed
-- operational annotation, not a substitute for the computed result.
CREATE OR REPLACE FUNCTION public.internal_verify_result_prepare_operational(
  p_actor UUID, p_run UUID, p_offer_value JSONB, p_verified_reference_scope JSONB,
  p_gap JSONB, p_confidence JSONB, p_proposed_action TEXT, p_exclusions JSONB,
  p_supersedes UUID, p_correlation TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result_id UUID; action TEXT := NULLIF(btrim(COALESCE(p_proposed_action,'')), '');
  run_record RECORD; per_currency JSONB; total_verified INT; total_excluded_or_insufficient INT;
  classification TEXT; exclusions JSONB;
BEGIN
  IF action IS NULL OR length(action) > 120 OR action IN ('ORDER','BUY','REJECT') THEN
    RAISE EXCEPTION 'VERIFY_PROPOSED_ACTION_INVALID';
  END IF;
  IF NULLIF(current_setting('app.actor_id', true), '') IS DISTINCT FROM p_actor::TEXT
     OR NOT public.internal_has_capability(p_actor, 'verify.analyst') THEN
    RAISE EXCEPTION 'VERIFY_ANALYST_FORBIDDEN';
  END IF;
  SELECT id, methodology_version, status INTO run_record FROM public.verify_runs WHERE id=p_run;
  IF NOT FOUND OR run_record.status <> 'COMPLETED' THEN RAISE EXCEPTION 'VERIFY_RESULT_NOT_PREPARABLE'; END IF;
  SELECT jsonb_object_agg(currency_rows.currency_code, currency_rows.currency_stats) INTO per_currency
    FROM (
      SELECT scope.captured_currency_code AS currency_code,
        jsonb_build_object(
          'totalLineCount', count(*),
          'verifiedLineCount', count(*) FILTER (WHERE lr.outcome='VERIFIED'),
          'excludedLineCount', count(*) FILTER (WHERE lr.outcome='EXCLUDED'),
          'insufficientEvidenceLineCount', count(*) FILTER (WHERE lr.outcome='INSUFFICIENT_EVIDENCE'),
          'lineCoveragePercent', CASE WHEN count(*)=0 THEN 0 ELSE ROUND(100.0*count(*) FILTER (WHERE lr.outcome='VERIFIED')/count(*),4) END,
          'totalValue', COALESCE(sum(scope.captured_attributable_value),0),
          'verifiedValue', COALESCE(sum(scope.captured_attributable_value) FILTER (WHERE lr.outcome='VERIFIED'),0),
          'valueCoveragePercent', CASE WHEN COALESCE(sum(scope.captured_attributable_value),0)=0 THEN 0 ELSE ROUND(100.0*COALESCE(sum(scope.captured_attributable_value) FILTER (WHERE lr.outcome='VERIFIED'),0)/sum(scope.captured_attributable_value),4) END
        ) AS currency_stats
      FROM public.verify_run_line_scope scope
      JOIN public.verify_line_results lr ON lr.verify_run_id=scope.verify_run_id AND lr.verify_quote_line_id=scope.verify_quote_line_id
      WHERE scope.verify_run_id=p_run AND scope.is_applicable
      GROUP BY scope.captured_currency_code
    ) currency_rows;
  SELECT count(*) FILTER (WHERE lr.outcome='VERIFIED'), count(*) FILTER (WHERE lr.outcome IN ('EXCLUDED','INSUFFICIENT_EVIDENCE'))
    INTO total_verified, total_excluded_or_insufficient
    FROM public.verify_run_line_scope scope
    JOIN public.verify_line_results lr ON lr.verify_run_id=scope.verify_run_id AND lr.verify_quote_line_id=scope.verify_quote_line_id
   WHERE scope.verify_run_id=p_run AND scope.is_applicable;
  IF COALESCE(total_verified,0)=0 THEN classification='INSUFFICIENT_FOR_RESULT';
  ELSIF COALESCE(total_excluded_or_insufficient,0)>0 THEN classification='PARTIAL';
  ELSE classification='FULL'; END IF;
  SELECT jsonb_agg(jsonb_build_object('lineId',lr.verify_quote_line_id,'outcome',lr.outcome,'reason',lr.exclusion_reason)) INTO exclusions
    FROM public.verify_line_results lr WHERE lr.verify_run_id=p_run AND lr.outcome IN ('EXCLUDED','INSUFFICIENT_EVIDENCE');
  result_id := public.internal_verify_result_prepare(
    p_actor, p_run, classification,
    jsonb_build_object('offerValue',COALESCE(p_offer_value,'{}'::jsonb),'gap',COALESCE(p_gap,'{}'::jsonb),'confidence',COALESCE(p_confidence,'{}'::jsonb),'proposedAction',action),
    COALESCE(per_currency,'{}'::jsonb) || jsonb_build_object('verifiedReferenceScope',COALESCE(p_verified_reference_scope,'{}'::jsonb)),
    COALESCE(p_confidence,'{}'::jsonb), '{}', COALESCE(p_exclusions,jsonb_build_object('exclusions',COALESCE(exclusions,'[]'::jsonb))), p_supersedes, p_correlation
  );
  RETURN result_id;
END;
$$;
ALTER FUNCTION public.internal_verify_result_prepare_operational(UUID,UUID,JSONB,JSONB,JSONB,JSONB,TEXT,JSONB,UUID,TEXT) OWNER TO sco_verify_gateway_owner;
REVOKE ALL ON FUNCTION public.internal_verify_result_prepare_operational(UUID,UUID,JSONB,JSONB,JSONB,JSONB,TEXT,JSONB,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_verify_result_prepare_operational(UUID,UUID,JSONB,JSONB,JSONB,JSONB,TEXT,JSONB,UUID,TEXT) TO sco_internal_executor;

-- Partner result projection extends the existing safe result contract without exposing
-- raw quote content, document storage, reviewer identity, or internal notes.
DROP FUNCTION IF EXISTS public.partner_verify_result_get(UUID, UUID, UUID);
CREATE FUNCTION public.partner_verify_result_get(p_actor UUID, p_company UUID, p_request UUID)
RETURNS TABLE(
  request_id UUID, revision_id UUID, run_id UUID, result_id UUID, status TEXT, classification TEXT,
  finalized_at TIMESTAMPTZ, coverage JSONB, offer_value JSONB, verified_reference_scope JSONB,
  gap JSONB, confidence JSONB, proposed_action TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE candidate_count INT;
BEGIN
  IF NOT public.verify_partner_read_authorized(p_actor, p_company) THEN RAISE EXCEPTION 'PARTNER_VERIFY_READ_FORBIDDEN'; END IF;
  SELECT count(*) INTO candidate_count
    FROM public.verify_requests request_record
    JOIN public.verify_quote_revisions revision_record ON revision_record.id=request_record.current_submitted_revision_id AND revision_record.verify_request_id=request_record.id
    JOIN public.verify_runs run_record ON run_record.verify_quote_revision_id=revision_record.id AND run_record.status='COMPLETED'
    JOIN public.verify_results result_record ON result_record.verify_run_id=run_record.id AND result_record.status='FINAL'
   WHERE request_record.id=p_request AND request_record.company_id=p_company AND request_record.status='COMPLETED';
  IF candidate_count <> 1 THEN RETURN; END IF;
  RETURN QUERY
  SELECT request_record.id, revision_record.id, run_record.id, result_record.id, result_record.status,
    result_record.classification, result_record.finalised_at,
    (SELECT jsonb_agg(jsonb_build_object(
      'currency', e.key, 'totalLineCount', (e.value->>'totalLineCount')::int,
      'verifiedLineCount', (e.value->>'verifiedLineCount')::int,
      'excludedLineCount', (e.value->>'excludedLineCount')::int,
      'insufficientLineCount', (e.value->>'insufficientEvidenceLineCount')::int,
      'lineCoveragePercent', (e.value->>'lineCoveragePercent')::numeric,
      'valueCoveragePercent', (e.value->>'valueCoveragePercent')::numeric
    ) ORDER BY e.key) FROM jsonb_each(result_record.per_currency_scopes) e WHERE e.key <> 'verifiedReferenceScope'),
    result_record.coverage->'offerValue', result_record.per_currency_scopes->'verifiedReferenceScope',
    result_record.coverage->'gap', result_record.coverage->'confidence',
    result_record.coverage->>'proposedAction'
  FROM public.verify_requests request_record
  JOIN public.verify_quote_revisions revision_record ON revision_record.id=request_record.current_submitted_revision_id AND revision_record.verify_request_id=request_record.id
  JOIN public.verify_runs run_record ON run_record.verify_quote_revision_id=revision_record.id AND run_record.status='COMPLETED'
  JOIN public.verify_results result_record ON result_record.verify_run_id=run_record.id AND result_record.status='FINAL'
  WHERE request_record.id=p_request AND request_record.company_id=p_company AND request_record.status='COMPLETED';
END;
$$;
ALTER FUNCTION public.partner_verify_result_get(UUID,UUID,UUID) OWNER TO sco_verify_partner_read_owner;
REVOKE ALL ON FUNCTION public.partner_verify_result_get(UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_verify_result_get(UUID,UUID,UUID) TO sco_runtime;

-- Bounded internal Verify queue. It is a read-only projection of canonical request,
-- revision, run and result state; it does not expose raw document content.
CREATE FUNCTION public.internal_verify_queue(p_actor UUID, p_limit INTEGER, p_offset INTEGER, p_status TEXT DEFAULT NULL)
RETURNS TABLE(
  request_id UUID, company_id UUID, revision_id UUID, run_id UUID, result_id UUID,
  request_status TEXT, run_status TEXT, result_status TEXT, classification TEXT, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'verify.analyst')
     AND NOT public.internal_has_capability(p_actor, 'verify.approver') THEN
    RAISE EXCEPTION 'VERIFY_QUEUE_FORBIDDEN';
  END IF;
  RETURN QUERY
  SELECT request_record.id, request_record.company_id, revision_record.id, run_record.id, result_record.id,
    request_record.status, run_record.status, result_record.status, result_record.classification, request_record.updated_at
  FROM public.verify_requests request_record
  LEFT JOIN public.verify_quote_revisions revision_record ON revision_record.id=request_record.current_submitted_revision_id
  LEFT JOIN public.verify_runs run_record ON run_record.verify_quote_revision_id=revision_record.id
    AND run_record.id = (SELECT r2.id FROM public.verify_runs r2 WHERE r2.verify_quote_revision_id=revision_record.id ORDER BY r2.created_at DESC LIMIT 1)
  LEFT JOIN public.verify_results result_record ON result_record.verify_run_id=run_record.id
  WHERE (p_status IS NULL OR request_record.status=p_status OR run_record.status=p_status OR result_record.status=p_status)
  ORDER BY request_record.updated_at DESC, request_record.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,50),1),100)
  OFFSET GREATEST(COALESCE(p_offset,0),0);
END;
$$;
ALTER FUNCTION public.internal_verify_queue(UUID,INTEGER,INTEGER,TEXT) OWNER TO sco_verify_gateway_owner;
REVOKE ALL ON FUNCTION public.internal_verify_queue(UUID,INTEGER,INTEGER,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_verify_queue(UUID,INTEGER,INTEGER,TEXT) TO sco_internal_executor;
GRANT SELECT ON public.verify_results TO sco_verify_gateway_owner;
DROP POLICY IF EXISTS verify_results_gateway_owner ON public.verify_results;
CREATE POLICY verify_results_gateway_owner ON public.verify_results FOR SELECT TO sco_verify_gateway_owner USING (true);
