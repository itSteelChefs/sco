-- Capability F corrective closure: bind idempotency replay to actor and canonical payload.
-- Existing 0117 is immutable; this migration is safe for upgrade and fresh chains.

ALTER TABLE public.engineering_requests
  ADD COLUMN IF NOT EXISTS idempotency_fingerprint TEXT;

UPDATE public.engineering_requests
   SET idempotency_fingerprint = md5('legacy-engineering-request:' || id::text)
 WHERE idempotency_key IS NOT NULL
   AND idempotency_fingerprint IS NULL;

ALTER TABLE public.engineering_d_handoffs
  ADD COLUMN IF NOT EXISTS idempotency_actor_user_id UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS idempotency_fingerprint TEXT;

UPDATE public.engineering_d_handoffs
   SET idempotency_actor_user_id = handed_off_by,
       idempotency_fingerprint = md5('legacy-engineering-handoff:' || id::text)
 WHERE idempotency_actor_user_id IS NULL
    OR idempotency_fingerprint IS NULL;

CREATE OR REPLACE FUNCTION public.partner_engineering_request_create(
  p_actor UUID, p_company UUID,
  p_title TEXT, p_sector TEXT, p_description TEXT, p_request_type TEXT,
  p_project_reference TEXT, p_idempotency_key TEXT, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id UUID; v_existing RECORD; v_fingerprint TEXT;
BEGIN
  IF current_setting('app.actor_id', true) IS DISTINCT FROM p_actor::text
     OR current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::text THEN
    RAISE EXCEPTION 'ENGINEERING_FORBIDDEN';
  END IF;
  IF NOT public.engineering_partner_eligible(p_actor, p_company) THEN
    RAISE EXCEPTION 'ENGINEERING_INELIGIBLE';
  END IF;
  v_fingerprint := md5(jsonb_build_object(
    'title', btrim(p_title), 'sector', p_sector,
    'description', NULLIF(btrim(COALESCE(p_description,'')), ''),
    'requestType', COALESCE(NULLIF(btrim(COALESCE(p_request_type,'')), ''), 'BOQ_PREPARATION'),
    'projectReference', NULLIF(btrim(COALESCE(p_project_reference,'')), '')
  )::text);
  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('engineering.request:' || p_company::text || ':' || btrim(p_idempotency_key), 0));
    SELECT id, created_by, idempotency_fingerprint INTO v_existing
      FROM public.engineering_requests
     WHERE company_id = p_company AND idempotency_key = btrim(p_idempotency_key);
    IF v_existing.id IS NOT NULL THEN
      IF v_existing.created_by = p_actor AND v_existing.idempotency_fingerprint = v_fingerprint THEN
        RETURN v_existing.id;
      END IF;
      RAISE EXCEPTION 'ENGINEERING_IDEMPOTENCY_CONFLICT';
    END IF;
  END IF;
  v_id := gen_random_uuid();
  INSERT INTO public.engineering_requests(
    id, company_id, created_by, title, sector, description, request_type, project_reference,
    idempotency_key, idempotency_fingerprint, status
  ) VALUES (
    v_id, p_company, p_actor, btrim(p_title), p_sector,
    NULLIF(btrim(COALESCE(p_description,'')), ''),
    COALESCE(NULLIF(btrim(COALESCE(p_request_type,'')), ''), 'BOQ_PREPARATION'),
    NULLIF(btrim(COALESCE(p_project_reference,'')), ''),
    NULLIF(btrim(COALESCE(p_idempotency_key,'')), ''),
    CASE WHEN NULLIF(btrim(COALESCE(p_idempotency_key,'')), '') IS NULL THEN NULL ELSE v_fingerprint END,
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

CREATE OR REPLACE FUNCTION public.internal_engineering_d_handoff(
  p_actor UUID, p_version UUID, p_delivery_location TEXT, p_idempotency_key TEXT, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v RECORD; r RECORD; v_handoff RECORD; v_handoff_id UUID; v_req UUID; v_line RECORD; v_line_id UUID; v_key TEXT;
  v_fingerprint TEXT; v_n INT := 0;
BEGIN
  IF NOT public.engineering_internal_capability(p_actor, 'engineering.boq.approve') THEN
    RAISE EXCEPTION 'ENGINEERING_HANDOFF_FORBIDDEN';
  END IF;
  IF btrim(COALESCE(p_idempotency_key,'')) = '' THEN RAISE EXCEPTION 'ENGINEERING_IDEMPOTENCY_REQUIRED'; END IF;
  IF btrim(COALESCE(p_delivery_location,'')) = '' THEN RAISE EXCEPTION 'ENGINEERING_HANDOFF_DELIVERY_REQUIRED'; END IF;
  v_fingerprint := md5(jsonb_build_object(
    'boqVersionId', p_version, 'deliveryLocation', btrim(p_delivery_location)
  )::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('engineering.d-handoff:' || btrim(p_idempotency_key), 0));
  SELECT id, idempotency_actor_user_id, idempotency_fingerprint INTO v_handoff
    FROM public.engineering_d_handoffs WHERE idempotency_key = btrim(p_idempotency_key);
  IF v_handoff.id IS NOT NULL THEN
    IF v_handoff.idempotency_actor_user_id = p_actor AND v_handoff.idempotency_fingerprint = v_fingerprint THEN
      RETURN v_handoff.id;
    END IF;
    RAISE EXCEPTION 'ENGINEERING_IDEMPOTENCY_CONFLICT';
  END IF;

  SELECT * INTO v FROM public.engineering_boq_versions WHERE id = p_version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENGINEERING_BOQ_NOT_FOUND'; END IF;
  IF v.status <> 'APPROVED' THEN RAISE EXCEPTION 'ENGINEERING_HANDOFF_UNAPPROVED'; END IF;
  SELECT id INTO v_handoff_id FROM public.engineering_d_handoffs WHERE boq_version_id = p_version;
  IF v_handoff_id IS NOT NULL THEN RETURN v_handoff_id; END IF;

  SELECT * INTO r FROM public.engineering_requests WHERE id = v.request_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_partnerships cp
     JOIN public."Company" c ON c.id = cp.company_id AND c.type = 'PARTNER' AND c.status = 'ACTIVE'
    WHERE cp.company_id = r.company_id AND cp.type = 'BUYER_PARTNERSHIP' AND cp.status = 'ACTIVE'
  ) OR NOT public.partner_required_agreements_satisfied(r.company_id) THEN
    RAISE EXCEPTION 'ENGINEERING_HANDOFF_PARTNER_INELIGIBLE';
  END IF;

  v_req := gen_random_uuid();
  INSERT INTO public.procurement_requirements(
    id, company_id, created_by, title, reference_code, sector, project_reference,
    delivery_location, notes, status
  ) VALUES (
    v_req, r.company_id, p_actor, left('ENG: ' || r.title, 240),
    'F-' || upper(substr(replace(p_version::text,'-',''),1,10)),
    r.sector, r.project_reference, btrim(p_delivery_location),
    'Created from engineering BOQ v' || v.version_number::text || ' request ' || r.id::text, 'DRAFT'
  );
  INSERT INTO public.procurement_requirement_events(requirement_id, company_id, from_status, to_status, actor_user_id, correlation_id)
  VALUES (v_req, r.company_id, NULL, 'DRAFT', p_actor, p_correlation);
  FOR v_line IN SELECT * FROM public.engineering_boq_lines WHERE boq_version_id = p_version ORDER BY sort_order, description LOOP
    v_n := v_n + 1; v_line_id := gen_random_uuid(); v_key := COALESCE(NULLIF(btrim(v_line.line_key),''), 'L' || v_n::text);
    INSERT INTO public.procurement_requirement_lines(
      id, requirement_id, company_id, line_key, description, specification, quantity, unit_id,
      brand_preference, model_preference, technical_notes, sort_order
    ) VALUES (
      v_line_id, v_req, r.company_id, v_key, v_line.description, v_line.specification,
      v_line.quantity, v_line.unit_id, v_line.brand_preference, v_line.model_preference,
      v_line.partner_visible_notes, v_line.sort_order
    );
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'ENGINEERING_HANDOFF_EMPTY_BOQ'; END IF;
  v_handoff_id := gen_random_uuid();
  INSERT INTO public.engineering_d_handoffs(
    id, request_id, company_id, boq_version_id, procurement_requirement_id, handed_off_by,
    idempotency_key, idempotency_actor_user_id, idempotency_fingerprint, correlation_id
  ) VALUES (
    v_handoff_id, r.id, r.company_id, p_version, v_req, p_actor, btrim(p_idempotency_key),
    p_actor, v_fingerprint, p_correlation
  );
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, r.company_id, 'SCO_INTERNAL', 'engineering.d_handoff.created', 'EngineeringDHandoff', v_handoff_id,
          jsonb_build_object('boqVersionId', p_version, 'procurementRequirementId', v_req, 'lineCount', v_n), p_correlation);
  RETURN v_handoff_id;
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
  IF p_unit IS NULL OR NOT EXISTS (SELECT 1 FROM public.unit_definitions WHERE id = p_unit AND active) THEN
    RAISE EXCEPTION 'ENGINEERING_UNIT_REQUIRED';
  END IF;
  IF p_source_document IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.engineering_request_documents rd
      JOIN public.documents d ON d.id = rd.document_id
     WHERE rd.request_id = v.request_id AND rd.document_id = p_source_document
       AND rd.company_id = v.company_id AND d.company_id = v.company_id AND d.status = 'AVAILABLE'
  ) THEN
    RAISE EXCEPTION 'ENGINEERING_SOURCE_DOCUMENT_INVALID';
  END IF;
  IF p_line IS NOT NULL THEN
    SELECT id INTO v_id FROM public.engineering_boq_lines WHERE id = p_line AND boq_version_id = p_version;
    IF v_id IS NULL THEN RAISE EXCEPTION 'ENGINEERING_LINE_NOT_FOUND'; END IF;
    UPDATE public.engineering_boq_lines SET
      description=btrim(p_description), specification=NULLIF(btrim(COALESCE(p_specification,'')), ''), discipline=p_discipline,
      quantity=p_quantity, unit_id=p_unit, brand_preference=NULLIF(btrim(COALESCE(p_brand,'')), ''),
      model_preference=NULLIF(btrim(COALESCE(p_model,'')), ''), engineering_notes=NULLIF(btrim(COALESCE(p_engineering_notes,'')), ''),
      partner_visible_notes=NULLIF(btrim(COALESCE(p_partner_notes,'')), ''), source_document_id=p_source_document,
      source_reference=NULLIF(btrim(COALESCE(p_source_reference,'')), ''), sort_order=COALESCE(p_sort,sort_order), updated_at=clock_timestamp()
    WHERE id=v_id;
  ELSE
    v_id:=gen_random_uuid(); v_key:='L-' || replace(v_id::text,'-','');
    INSERT INTO public.engineering_boq_lines(
      id,boq_version_id,request_id,company_id,line_key,description,specification,discipline,unit_id,quantity,
      brand_preference,model_preference,engineering_notes,partner_visible_notes,source_document_id,source_reference,sort_order
    ) VALUES (
      v_id,p_version,v.request_id,v.company_id,v_key,btrim(p_description),NULLIF(btrim(COALESCE(p_specification,'')),''),p_discipline,p_unit,p_quantity,
      NULLIF(btrim(COALESCE(p_brand,'')),''),NULLIF(btrim(COALESCE(p_model,'')),''),NULLIF(btrim(COALESCE(p_engineering_notes,'')),''),
      NULLIF(btrim(COALESCE(p_partner_notes,'')),''),p_source_document,NULLIF(btrim(COALESCE(p_source_reference,'')),''),COALESCE(p_sort,0)
    );
  END IF;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id,company_id,scope,action,entity_type,entity_id,metadata,correlation_id)
  VALUES (p_actor,v.company_id,'SCO_INTERNAL','engineering.boq.line_upserted','EngineeringBoqLine',v_id,
          jsonb_build_object('boqVersionId',p_version,'requestId',v.request_id),p_correlation);
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
     OR current_setting('app.tenant_id', true) IS DISTINCT FROM p_company::text THEN RAISE EXCEPTION 'ENGINEERING_FORBIDDEN'; END IF;
  IF NOT public.engineering_partner_eligible(p_actor, p_company) THEN RAISE EXCEPTION 'ENGINEERING_INELIGIBLE'; END IF;
  SELECT * INTO r FROM public.engineering_requests WHERE id=p_id AND company_id=p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENGINEERING_REQUEST_NOT_FOUND'; END IF;
  IF r.status NOT IN ('DRAFT','ACTION_REQUIRED') THEN RAISE EXCEPTION 'ENGINEERING_REQUEST_NOT_EDITABLE'; END IF;
  UPDATE public.engineering_requests SET
    title=btrim(p_title), sector=p_sector, description=NULLIF(btrim(COALESCE(p_description,'')),''),
    request_type=COALESCE(NULLIF(btrim(COALESCE(p_request_type,'')),''),request_type),
    project_reference=NULLIF(btrim(COALESCE(p_project_reference,'')),''), updated_at=clock_timestamp()
  WHERE id=p_id;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id,company_id,scope,action,entity_type,entity_id,metadata,correlation_id)
  VALUES(p_actor,p_company,'TENANT','engineering.request.draft_updated','EngineeringRequest',p_id,
         jsonb_build_object('status',r.status),p_correlation);
  RETURN p_id;
END $$;
