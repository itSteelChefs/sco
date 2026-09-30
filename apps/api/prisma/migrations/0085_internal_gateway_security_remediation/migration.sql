-- SR-01/SR-02 security remediation: remove app.sco_internal (GUC-only) as a sufficient security boundary for
-- sensitive internal database operations (qualification/partnership, global catalog writes, internal candidate
-- operations, procurement execution, supplier-network + history), replacing sco_runtime's direct DML on those
-- tables with narrow typed SECURITY DEFINER gateways, mirroring the ownership-separation pattern established in
-- migration 0084 (sco_verify_gateway_owner / sco_verify_system_executor) and the capability-checked gateway
-- pattern established in migration 0021 (internal_has_capability, sco_internal_executor).
-- Does not edit or rewrite 0001-0084 history; only adds new objects, narrows existing policies/grants, and
-- CREATE OR REPLACE's mutable enforcement code where a prior migration already defined it.

INSERT INTO "Permission" (id, code, description) VALUES
  (gen_random_uuid(), 'sco.internal.manage', 'Baseline SCO-internal workforce capability required by ScoInternalGuard'),
  (gen_random_uuid(), 'qualification.manage', 'Manage qualification applications'),
  (gen_random_uuid(), 'partnership.manage', 'Manage company partnerships'),
  (gen_random_uuid(), 'candidate.manage', 'Submit and review internal product candidates'),
  (gen_random_uuid(), 'execution.manage', 'Manage procurement cycles and execution assignment')
ON CONFLICT (code) DO NOTHING;

-- Section 1: dedicated restricted-privilege gateway-owner role. NOLOGIN: nothing connects as this role directly;
-- it exists only to own the SECURITY DEFINER functions below (definer functions execute with the OWNER's
-- privileges, not the caller's). sco_internal_executor (created in migration 0015) is reused unchanged as the
-- EXECUTE-only caller role already wired to SCO_INTERNAL_DATABASE_URL/InternalDatabaseService.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_internal_gateway_owner') THEN
    CREATE ROLE sco_internal_gateway_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE sco_internal_gateway_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

REVOKE ALL ON SCHEMA public FROM sco_internal_gateway_owner;
GRANT USAGE ON SCHEMA public TO sco_internal_gateway_owner;

-- Section 2: global catalog tables keep their existing public SELECT (`%I_read`, USING (true)) unchanged; only the
-- app.sco_internal-authorized write policies/grants move off sco_runtime. Gateway-owner privilege/policy below is
-- operation-specific and table-specific, matching exactly what the typed gateways in Section 9 perform: no
-- gateway deletes a catalog row, so DELETE is never granted; unit_definitions, currency_definitions, and
-- product_attribute_values are never read or written by any gateway, so gateway-owner receives no grant/policy
-- on them at all (their existing public sco_runtime SELECT is untouched).
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['product_categories','category_attribute_definitions','unit_definitions','currency_definitions','product_identities','product_attribute_values'] LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM sco_runtime', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_update ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON %I', t, t);
  END LOOP;
END $$;

-- internal_catalog_category_create is the only gateway that writes product_categories, and it only INSERTs.
-- SELECT is required too: every gateway function below uses "RETURNING", and RETURNING requires SELECT
-- privilege on the table for the executing role, independent of the pre-existing public sco_runtime read policy.
GRANT SELECT, INSERT ON product_categories TO sco_internal_gateway_owner;
CREATE POLICY product_categories_gateway_owner_select ON product_categories FOR SELECT TO sco_internal_gateway_owner USING (true);
CREATE POLICY product_categories_gateway_owner_insert ON product_categories FOR INSERT TO sco_internal_gateway_owner WITH CHECK (true);

-- internal_catalog_attribute_create is the only gateway that writes category_attribute_definitions, and it only INSERTs.
GRANT SELECT, INSERT ON category_attribute_definitions TO sco_internal_gateway_owner;
CREATE POLICY category_attribute_definitions_gateway_owner_select ON category_attribute_definitions FOR SELECT TO sco_internal_gateway_owner USING (true);
CREATE POLICY category_attribute_definitions_gateway_owner_insert ON category_attribute_definitions FOR INSERT TO sco_internal_gateway_owner WITH CHECK (true);

-- internal_catalog_product_create and internal_candidate_transition's NEW_PRODUCT_PROPOSED path INSERT
-- product_identities; internal_catalog_product_activate UPDATEs it. No gateway ever deletes it.
GRANT SELECT, INSERT, UPDATE ON product_identities TO sco_internal_gateway_owner;
CREATE POLICY product_identities_gateway_owner_select ON product_identities FOR SELECT TO sco_internal_gateway_owner USING (true);
CREATE POLICY product_identities_gateway_owner_insert ON product_identities FOR INSERT TO sco_internal_gateway_owner WITH CHECK (true);
CREATE POLICY product_identities_gateway_owner_update ON product_identities FOR UPDATE TO sco_internal_gateway_owner USING (true) WITH CHECK (true);

-- Section 3: internal candidate review must remain able to write across candidates regardless of origin/company
-- (both PARTNER-origin and SCO_INTERNAL-origin candidates), but that must no longer be a caller-set GUC bypass on
-- sco_runtime. Partner submit/list (tenant-scoped) keeps working through the narrowed, tenant-only policy.
DROP POLICY product_candidate_scope ON product_candidates;
CREATE POLICY product_candidate_scope ON product_candidates FOR ALL TO sco_runtime
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
DROP POLICY match_assessment_scope ON product_match_assessments;
CREATE POLICY match_assessment_scope ON product_match_assessments FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM product_candidates c WHERE c.id = candidate_id AND c.company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM product_candidates c WHERE c.id = candidate_id AND c.company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
DROP POLICY candidate_history_scope ON product_candidate_history;
CREATE POLICY candidate_history_scope ON product_candidate_history FOR ALL TO sco_runtime
  USING (EXISTS (SELECT 1 FROM product_candidates c WHERE c.id = candidate_id AND c.company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM product_candidates c WHERE c.id = candidate_id AND c.company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

GRANT SELECT, INSERT, UPDATE ON product_candidates, product_match_assessments, product_candidate_history TO sco_internal_gateway_owner;
CREATE POLICY product_candidates_gateway_owner ON product_candidates FOR ALL TO sco_internal_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY product_match_assessments_gateway_owner ON product_match_assessments FOR ALL TO sco_internal_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY product_candidate_history_gateway_owner ON product_candidate_history FOR ALL TO sco_internal_gateway_owner USING (true) WITH CHECK (true);

-- Section 4: qualification_applications has no legitimate partner/tenant path at all; sco_runtime loses all access.
REVOKE ALL ON qualification_applications FROM sco_runtime;
DROP POLICY qualification_sco_internal_only ON qualification_applications;
GRANT SELECT, INSERT, UPDATE ON qualification_applications TO sco_internal_gateway_owner;
CREATE POLICY qualification_applications_gateway_owner ON qualification_applications FOR ALL TO sco_internal_gateway_owner USING (true) WITH CHECK (true);

-- Section 5: company_partnerships keeps its legitimate active-tenant read/write path (used by
-- MembershipEligibilityService and future partner self-service); only the sco_internal bypass is removed.
DROP POLICY partnership_sco_internal_or_active_tenant ON company_partnerships;
CREATE POLICY partnership_active_tenant ON company_partnerships FOR ALL TO sco_runtime
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON company_partnerships TO sco_internal_gateway_owner;
CREATE POLICY company_partnerships_gateway_owner ON company_partnerships FOR ALL TO sco_internal_gateway_owner USING (true) WITH CHECK (true);

-- Section 6: procurement_cycles/procurement_executions have no tenant path at all; sco_runtime loses all access.
-- procurement_execution_items/ready_allocation_events/procurement_cycle_exceptions/execution_change_requests keep
-- their legitimate tenant read (e.g. ExecutionService.partnerStatus); only the sco_internal bypass is removed.
REVOKE ALL ON procurement_cycles, procurement_executions FROM sco_runtime;
DROP POLICY cycles_internal ON procurement_cycles;
DROP POLICY executions_internal ON procurement_executions;
GRANT SELECT, INSERT, UPDATE ON procurement_cycles, procurement_executions TO sco_internal_gateway_owner;
CREATE POLICY procurement_cycles_gateway_owner ON procurement_cycles FOR ALL TO sco_internal_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY procurement_executions_gateway_owner ON procurement_executions FOR ALL TO sco_internal_gateway_owner USING (true) WITH CHECK (true);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['procurement_execution_items','ready_allocation_events','procurement_cycle_exceptions','execution_change_requests'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_tenant ON %I FOR ALL TO sco_runtime USING (company_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (company_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO sco_internal_gateway_owner', t);
    EXECUTE format('CREATE POLICY %I_gateway_owner ON %I FOR ALL TO sco_internal_gateway_owner USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- internal_execution_assign reads procurement_needs (with a row lock, which requires UPDATE privilege even though
-- the gateway itself never writes to it) and projects (read-only); both are tenant-scoped FORCE RLS tables with no
-- prior gateway-owner grant/policy at all.
GRANT SELECT, UPDATE ON public.procurement_needs TO sco_internal_gateway_owner;
GRANT SELECT ON public.projects TO sco_internal_gateway_owner;
CREATE POLICY procurement_needs_gateway_owner ON procurement_needs FOR ALL TO sco_internal_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY projects_gateway_owner ON projects FOR SELECT TO sco_internal_gateway_owner USING (true);

-- Section 7: supplier-network + history tables have no legitimate partner/tenant path at all (Supplier Identity,
-- Purchase Source, and supplier network structure remain SCO-internal commercial facts); sco_runtime loses all access.
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_source_type_definitions','supplier_qualifications','supplier_category_capabilities','purchase_sources','purchase_source_contacts','supplier_network_history'] LOOP
    EXECUTE format('REVOKE ALL ON %I FROM sco_runtime', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_internal ON %I', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO sco_internal_gateway_owner', t);
    EXECUTE format('CREATE POLICY %I_gateway_owner ON %I FOR ALL TO sco_internal_gateway_owner USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- Section 8: internal_has_capability (SECURITY INVOKER) runs as whichever role is current_user; called from
-- within our SECURITY DEFINER wrappers that role is sco_internal_gateway_owner, so it needs read access to the
-- RBAC tables it joins, plus the same narrow bootstrap-style read policies migration 0084 grants its own
-- gateway-owner role (CompanyMembership/MembershipRole/RolePermission are FORCE RLS and this role is not sco_runtime).
GRANT SELECT ON "CompanyMembership", "Company", "MembershipRole", "RolePermission", "Permission" TO sco_internal_gateway_owner;
GRANT EXECUTE ON FUNCTION public.internal_has_capability(UUID, TEXT) TO sco_internal_gateway_owner;
CREATE POLICY company_membership_internal_gateway_read ON "CompanyMembership" FOR SELECT TO sco_internal_gateway_owner USING (true);
CREATE POLICY membership_role_internal_gateway_read ON "MembershipRole" FOR SELECT TO sco_internal_gateway_owner USING (true);
CREATE POLICY role_permission_internal_gateway_read ON "RolePermission" FOR SELECT TO sco_internal_gateway_owner USING (true);

-- Section 9: typed gateways. Each validates the trusted actor's explicit capability before any read/write; none
-- accept a caller-controlled authorization primitive (no GUC, no generic executor, no bypass).

CREATE FUNCTION public.internal_catalog_category_create(p_actor UUID, p_code TEXT, p_name TEXT, p_parent_id UUID)
RETURNS TABLE(id UUID, code TEXT, name TEXT, "parentId" UUID, active BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'catalog.manage') THEN RAISE EXCEPTION 'CATALOG_MANAGE_FORBIDDEN'; END IF;
  RETURN QUERY INSERT INTO public.product_categories (code, name, parent_id) VALUES (p_code, p_name, p_parent_id)
    RETURNING product_categories.id, product_categories.code, product_categories.name, product_categories.parent_id, product_categories.active;
END $$;

CREATE FUNCTION public.internal_catalog_attribute_create(p_actor UUID, p_category_id UUID, p_key TEXT, p_display_name TEXT, p_data_type TEXT, p_required BOOLEAN, p_unit_applicability JSONB, p_validation_metadata JSONB)
RETURNS TABLE(id UUID, "categoryId" UUID, key TEXT, "displayName" TEXT, "dataType" TEXT, required BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'catalog.manage') THEN RAISE EXCEPTION 'CATALOG_MANAGE_FORBIDDEN'; END IF;
  RETURN QUERY INSERT INTO public.category_attribute_definitions (category_id, key, display_name, data_type, required, unit_applicability, validation_metadata)
    VALUES (p_category_id, p_key, p_display_name, p_data_type::"CatalogAttributeType", p_required, p_unit_applicability, p_validation_metadata)
    RETURNING category_attribute_definitions.id, category_attribute_definitions.category_id, category_attribute_definitions.key, category_attribute_definitions.display_name, category_attribute_definitions.data_type::TEXT, category_attribute_definitions.required;
END $$;

CREATE FUNCTION public.internal_catalog_product_create(p_actor UUID, p_category_id UUID, p_brand TEXT, p_manufacturer TEXT, p_model_reference TEXT, p_public_specification JSONB, p_unit_id UUID, p_warranty_type TEXT, p_warranty_period_months INT, p_warranty_provider TEXT)
RETURNS TABLE(id UUID, "categoryId" UUID, brand TEXT, manufacturer TEXT, "modelReference" TEXT, "publicSpecification" JSONB, "unitId" UUID, "warrantyType" TEXT, "warrantyPeriodMonths" INT, "warrantyProvider" TEXT, status TEXT, version INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'catalog.manage') THEN RAISE EXCEPTION 'CATALOG_MANAGE_FORBIDDEN'; END IF;
  RETURN QUERY INSERT INTO public.product_identities (category_id, brand, manufacturer, model_reference, public_specification, unit_id, warranty_type, warranty_period_months, warranty_provider, created_by)
    VALUES (p_category_id, p_brand, p_manufacturer, p_model_reference, p_public_specification, p_unit_id, p_warranty_type, p_warranty_period_months, p_warranty_provider, p_actor)
    RETURNING product_identities.id, product_identities.category_id, product_identities.brand, product_identities.manufacturer, product_identities.model_reference, product_identities.public_specification, product_identities.unit_id, product_identities.warranty_type, product_identities.warranty_period_months, product_identities.warranty_provider, product_identities.status::TEXT, product_identities.version;
END $$;

CREATE FUNCTION public.internal_catalog_product_activate(p_actor UUID, p_id UUID)
RETURNS TABLE(id UUID, status TEXT, version INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'catalog.approve') THEN RAISE EXCEPTION 'CATALOG_APPROVE_FORBIDDEN'; END IF;
  RETURN QUERY UPDATE public.product_identities SET status = 'ACTIVE', activated_by = p_actor, activated_at = now(), updated_at = now()
    WHERE product_identities.id = p_id AND product_identities.status = 'DRAFT'
    RETURNING product_identities.id, product_identities.status::TEXT, product_identities.version;
END $$;

CREATE FUNCTION public.internal_candidate_submit(p_actor UUID, p_submitted_name TEXT, p_requested_category_id UUID, p_brand TEXT, p_manufacturer TEXT, p_model_reference TEXT, p_submitted_specification JSONB, p_unit_id UUID)
RETURNS TABLE(id UUID, status TEXT, "submittedName" TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'candidate.manage') THEN RAISE EXCEPTION 'CANDIDATE_MANAGE_FORBIDDEN'; END IF;
  INSERT INTO public.product_candidates (submitted_by, origin, submitted_name, requested_category_id, brand, manufacturer, model_reference, submitted_specification, unit_id)
    VALUES (p_actor, 'SCO_INTERNAL', p_submitted_name, p_requested_category_id, p_brand, p_manufacturer, p_model_reference, p_submitted_specification, p_unit_id)
    RETURNING product_candidates.id INTO v_id;
  INSERT INTO public.product_candidate_history (candidate_id, to_status, actor_user_id) VALUES (v_id, 'SUBMITTED', p_actor);
  RETURN QUERY SELECT product_candidates.id, product_candidates.status::TEXT, product_candidates.submitted_name FROM public.product_candidates WHERE product_candidates.id = v_id;
END $$;

CREATE FUNCTION public.internal_candidate_transition(p_actor UUID, p_id UUID, p_to_status TEXT, p_reason TEXT, p_product_identity_id UUID, p_explanation TEXT, p_matched_attributes JSONB, p_differing_attributes JSONB, p_missing_attributes JSONB)
RETURNS TABLE(id UUID, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE current_record RECORD; allowed TEXT[]; linked_product_id UUID := p_product_identity_id; decision TEXT; decided TIMESTAMPTZ;
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'candidate.manage') THEN RAISE EXCEPTION 'CANDIDATE_MANAGE_FORBIDDEN'; END IF;
  IF p_to_status NOT IN ('NORMALIZED','CLARIFICATION_REQUIRED','MATCH_REVIEW','LINKED','NEW_PRODUCT_PROPOSED','REJECTED') THEN
    RAISE EXCEPTION 'INVALID_CANDIDATE_TRANSITION';
  END IF;

  SELECT c.id, c.status::TEXT AS status, c.requested_category_id, c.brand, c.manufacturer, c.model_reference, c.submitted_specification, c.unit_id
    INTO current_record FROM public.product_candidates c WHERE c.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CANDIDATE_TRANSITION'; END IF;

  allowed := CASE current_record.status
    WHEN 'SUBMITTED' THEN ARRAY['NORMALIZED','CLARIFICATION_REQUIRED']
    WHEN 'NORMALIZED' THEN ARRAY['MATCH_REVIEW','CLARIFICATION_REQUIRED']
    WHEN 'MATCH_REVIEW' THEN ARRAY['LINKED','NEW_PRODUCT_PROPOSED','CLARIFICATION_REQUIRED','REJECTED']
    ELSE ARRAY[]::TEXT[]
  END;
  IF NOT (p_to_status = ANY(allowed)) THEN RAISE EXCEPTION 'INVALID_CANDIDATE_TRANSITION'; END IF;
  IF p_to_status = 'REJECTED' AND btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'REJECTION_REASON_REQUIRED'; END IF;

  IF p_to_status = 'NEW_PRODUCT_PROPOSED' THEN
    IF current_record.requested_category_id IS NULL THEN RAISE EXCEPTION 'CATEGORY_REQUIRED_FOR_NEW_PRODUCT'; END IF;
    INSERT INTO public.product_identities (category_id, brand, manufacturer, model_reference, public_specification, unit_id, created_by)
      VALUES (current_record.requested_category_id, current_record.brand, current_record.manufacturer, current_record.model_reference, current_record.submitted_specification, current_record.unit_id, p_actor)
      RETURNING product_identities.id INTO linked_product_id;
  END IF;

  IF p_to_status IN ('MATCH_REVIEW','LINKED','NEW_PRODUCT_PROPOSED','CLARIFICATION_REQUIRED','REJECTED') THEN
    decision := CASE WHEN p_to_status IN ('LINKED','NEW_PRODUCT_PROPOSED','CLARIFICATION_REQUIRED','REJECTED') THEN p_to_status ELSE NULL END;
    decided := CASE WHEN decision IS NULL THEN NULL ELSE now() END;
    INSERT INTO public.product_match_assessments (candidate_id, product_identity_id, matched_attributes, differing_attributes, missing_attributes, explanation, decision, status, reviewed_by, decided_at)
      VALUES (p_id, linked_product_id, p_matched_attributes, p_differing_attributes, p_missing_attributes, COALESCE(p_explanation, p_reason, 'Review recorded'), decision::"MatchDecision", 'DECIDED', p_actor, decided);
  END IF;

  UPDATE public.product_candidates SET status = p_to_status::"CandidateStatus",
      normalized_specification = CASE WHEN p_to_status = 'NORMALIZED' THEN submitted_specification ELSE normalized_specification END,
      updated_at = now()
    WHERE product_candidates.id = p_id;

  INSERT INTO public.product_candidate_history (candidate_id, from_status, to_status, actor_user_id, reason)
    VALUES (p_id, current_record.status::"CandidateStatus", p_to_status::"CandidateStatus", p_actor, p_reason);

  RETURN QUERY SELECT product_candidates.id, product_candidates.status::TEXT FROM public.product_candidates WHERE product_candidates.id = p_id;
END $$;

CREATE FUNCTION public.internal_qualification_create(p_actor UUID, p_legal_name TEXT, p_contact_email TEXT)
RETURNS TABLE(id UUID, "legalName" TEXT, "contactEmail" TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'qualification.manage') THEN RAISE EXCEPTION 'QUALIFICATION_MANAGE_FORBIDDEN'; END IF;
  RETURN QUERY INSERT INTO public.qualification_applications (legal_name, contact_email, submitted_by)
    VALUES (p_legal_name, p_contact_email, p_actor)
    RETURNING qualification_applications.id, qualification_applications.legal_name, qualification_applications.contact_email, qualification_applications.status::TEXT;
END $$;

CREATE FUNCTION public.internal_qualification_decide(p_actor UUID, p_id UUID, p_status TEXT, p_reason TEXT)
RETURNS TABLE(id UUID, status TEXT, "decisionReason" TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'qualification.manage') THEN RAISE EXCEPTION 'QUALIFICATION_MANAGE_FORBIDDEN'; END IF;
  IF p_status NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'INVALID_QUALIFICATION_DECISION'; END IF;
  RETURN QUERY UPDATE public.qualification_applications SET status = p_status::"QualificationStatus", reviewed_by = p_actor, reviewed_at = now(), decision_reason = p_reason, updated_at = now()
    WHERE qualification_applications.id = p_id AND qualification_applications.status IN ('APPLICATION','UNDER_REVIEW')
    RETURNING qualification_applications.id, qualification_applications.status::TEXT, qualification_applications.decision_reason;
END $$;

CREATE FUNCTION public.internal_qualification_list(p_actor UUID)
RETURNS TABLE(id UUID, "legalName" TEXT, "contactEmail" TEXT, status TEXT, "createdAt" TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'qualification.manage') THEN RAISE EXCEPTION 'QUALIFICATION_MANAGE_FORBIDDEN'; END IF;
  RETURN QUERY SELECT qualification_applications.id, qualification_applications.legal_name, qualification_applications.contact_email, qualification_applications.status::TEXT, qualification_applications.created_at
    FROM public.qualification_applications ORDER BY qualification_applications.created_at DESC;
END $$;

CREATE FUNCTION public.internal_partnership_create(p_actor UUID, p_company_id UUID, p_type TEXT)
RETURNS TABLE(id UUID, "companyId" UUID, type TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'partnership.manage') THEN RAISE EXCEPTION 'PARTNERSHIP_MANAGE_FORBIDDEN'; END IF;
  -- ON CONFLICT ON CONSTRAINT (not a bare (company_id, type) column list) avoids the RETURNS TABLE OUT parameter
  -- named "type" being ambiguous with the company_partnerships.type column in the conflict target.
  RETURN QUERY INSERT INTO public.company_partnerships (company_id, type) VALUES (p_company_id, p_type::"PartnershipType")
    ON CONFLICT ON CONSTRAINT company_partnerships_company_id_type_key DO NOTHING
    RETURNING company_partnerships.id, company_partnerships.company_id, company_partnerships.type::TEXT, company_partnerships.status::TEXT;
END $$;

CREATE FUNCTION public.internal_partnership_activate(p_actor UUID, p_id UUID)
RETURNS TABLE(id UUID, "companyId" UUID, type TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'partnership.manage') THEN RAISE EXCEPTION 'PARTNERSHIP_MANAGE_FORBIDDEN'; END IF;
  RETURN QUERY UPDATE public.company_partnerships SET status = 'ACTIVE', approved_by = p_actor, approved_at = now(), active_from = now(), updated_at = now()
    WHERE company_partnerships.id = p_id AND company_partnerships.status IN ('APPROVED','UNDER_REVIEW')
    RETURNING company_partnerships.id, company_partnerships.company_id, company_partnerships.type::TEXT, company_partnerships.status::TEXT;
END $$;

CREATE FUNCTION public.internal_execution_cycle_create(p_actor UUID, p_code TEXT, p_name TEXT, p_opens_at TIMESTAMPTZ, p_closes_at TIMESTAMPTZ)
RETURNS TABLE(id UUID, "cycleCode" TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'execution.manage') THEN RAISE EXCEPTION 'EXECUTION_MANAGE_FORBIDDEN'; END IF;
  RETURN QUERY INSERT INTO public.procurement_cycles (cycle_code, name, intake_opens_at, intake_closes_at)
    VALUES (p_code, p_name, p_opens_at, p_closes_at)
    RETURNING procurement_cycles.id, procurement_cycles.cycle_code, procurement_cycles.status::TEXT;
END $$;

CREATE FUNCTION public.internal_execution_assign(p_actor UUID, p_cycle_id UUID, p_need_id UUID, p_quantity NUMERIC, p_key TEXT)
RETURNS TABLE(id UUID, "executionId" UUID, "allocatedQuantity" NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE existing_record RECORD; need_record RECORD; consumed NUMERIC; available NUMERIC; execution_id UUID; item_id UUID;
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'execution.manage') THEN RAISE EXCEPTION 'EXECUTION_MANAGE_FORBIDDEN'; END IF;
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;

  SELECT ei.id, ei.execution_id, ei.allocated_quantity INTO existing_record
    FROM public.procurement_execution_items ei WHERE ei.idempotency_key = p_key;
  IF FOUND THEN
    RETURN QUERY SELECT existing_record.id, existing_record.execution_id, existing_record.allocated_quantity;
    RETURN;
  END IF;

  SELECT n.company_id, n.project_id, n.product_identity_id, n.unit_id, n.need_date, n.maturity, n.ready_quantity,
         p.status AS project_status, pi.status AS product_status
    INTO need_record
    FROM public.procurement_needs n
    LEFT JOIN public.projects p ON p.id = n.project_id
    JOIN public.product_identities pi ON pi.id = n.product_identity_id
   WHERE n.id = p_need_id FOR UPDATE OF n;

  IF NOT FOUND OR need_record.maturity <> 'READY' OR need_record.product_status <> 'ACTIVE'
     OR (need_record.project_id IS NOT NULL AND need_record.project_status <> 'ACTIVE') THEN
    RAISE EXCEPTION 'NOT_ELIGIBLE';
  END IF;

  SELECT COALESCE(SUM(quantity), 0)::NUMERIC INTO consumed
    FROM public.ready_allocation_events WHERE procurement_need_id = p_need_id AND event_type = 'CONSUMED';
  available := need_record.ready_quantity - consumed;
  IF p_quantity > available THEN RAISE EXCEPTION 'READY_QUANTITY_EXCEEDED'; END IF;

  INSERT INTO public.procurement_executions (cycle_id, status, created_by) VALUES (p_cycle_id, 'READY_FOR_PROCESSING', p_actor)
    RETURNING procurement_executions.id INTO execution_id;
  INSERT INTO public.procurement_execution_items (execution_id, company_id, project_id, procurement_need_id, product_identity_id, allocated_quantity, remaining_quantity, unit_id, need_date, idempotency_key, created_by)
    VALUES (execution_id, need_record.company_id, need_record.project_id, p_need_id, need_record.product_identity_id, p_quantity, p_quantity, need_record.unit_id, need_record.need_date, p_key, p_actor)
    RETURNING procurement_execution_items.id INTO item_id;
  INSERT INTO public.ready_allocation_events (company_id, procurement_need_id, execution_item_id, cycle_id, event_type, quantity, idempotency_key, actor_user_id)
    VALUES (need_record.company_id, p_need_id, item_id, p_cycle_id, 'CONSUMED', p_quantity, p_key, p_actor);

  RETURN QUERY SELECT item_id, execution_id, p_quantity;
END $$;

CREATE FUNCTION public.internal_supplier_eligible_sources(p_actor UUID, p_execution_item_id UUID)
RETURNS TABLE("purchaseSourceId" UUID, "supplierCompanyId" UUID, "sourceCode" TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'supplier.read') THEN RAISE EXCEPTION 'SUPPLIER_READ_FORBIDDEN'; END IF;
  RETURN QUERY
    SELECT ps.id, ps.supplier_company_id, ps.source_code, ps.status::TEXT
    FROM public.procurement_execution_items ei
    JOIN public.product_identities pi ON pi.id = ei.product_identity_id
    JOIN public.supplier_category_capabilities scc ON scc.category_id = pi.category_id AND scc.status = 'ACTIVE'
    JOIN public.company_partnerships sp ON sp.id = scc.supplier_partnership_id AND sp.type = 'SUPPLIER_PARTNERSHIP' AND sp.status = 'ACTIVE'
    JOIN public.supplier_qualifications sq ON sq.supplier_partnership_id = sp.id AND sq.status = 'ACTIVE'
    JOIN public.purchase_sources ps ON ps.supplier_partnership_id = sp.id AND ps.status = 'ACTIVE'
    WHERE ei.id = p_execution_item_id;
END $$;

CREATE FUNCTION public.internal_supplier_qualification_decide(p_actor UUID, p_qualification_id UUID, p_status TEXT, p_reason TEXT)
RETURNS TABLE(id UUID, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'supplier.qualify') THEN RAISE EXCEPTION 'SUPPLIER_QUALIFY_FORBIDDEN'; END IF;
  UPDATE public.supplier_qualifications SET status = p_status::"SupplierQualificationStatus", qualification_notes = COALESCE(p_reason, qualification_notes), approved_by = p_actor, approved_at = now(), updated_at = now()
    WHERE supplier_qualifications.id = p_qualification_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_QUALIFICATION_NOT_FOUND'; END IF;
  INSERT INTO public.supplier_network_history (entity_type, entity_id, action, actor_user_id, reason, metadata)
    VALUES ('SupplierQualification', p_qualification_id, 'qualification.' || lower(p_status), p_actor, p_reason, jsonb_build_object('status', p_status));
  RETURN QUERY SELECT supplier_qualifications.id, supplier_qualifications.status::TEXT FROM public.supplier_qualifications WHERE supplier_qualifications.id = p_qualification_id;
END $$;

CREATE FUNCTION public.internal_purchase_source_create(p_actor UUID, p_supplier_company_id UUID, p_supplier_partnership_id UUID, p_source_code TEXT, p_source_type_id UUID, p_branch_context TEXT, p_commercial_route TEXT, p_operational_context TEXT)
RETURNS TABLE(id UUID, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'purchase_source.create') THEN RAISE EXCEPTION 'PURCHASE_SOURCE_CREATE_FORBIDDEN'; END IF;
  INSERT INTO public.purchase_sources (supplier_company_id, supplier_partnership_id, source_code, source_type_id, branch_context, commercial_route, operational_context, created_by)
    VALUES (p_supplier_company_id, p_supplier_partnership_id, p_source_code, p_source_type_id, p_branch_context, p_commercial_route, p_operational_context, p_actor)
    RETURNING purchase_sources.id INTO v_id;
  INSERT INTO public.supplier_network_history (entity_type, entity_id, action, actor_user_id, metadata)
    VALUES ('PurchaseSource', v_id, 'purchase_source.created', p_actor, jsonb_build_object('sourceCode', p_source_code));
  RETURN QUERY SELECT purchase_sources.id, purchase_sources.status::TEXT FROM public.purchase_sources WHERE purchase_sources.id = v_id;
END $$;

ALTER FUNCTION public.internal_catalog_category_create(UUID, TEXT, TEXT, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_catalog_attribute_create(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, JSONB, JSONB) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_catalog_product_create(UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID, TEXT, INT, TEXT) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_catalog_product_activate(UUID, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_candidate_submit(UUID, TEXT, UUID, TEXT, TEXT, TEXT, JSONB, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_candidate_transition(UUID, UUID, TEXT, TEXT, UUID, TEXT, JSONB, JSONB, JSONB) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_qualification_create(UUID, TEXT, TEXT) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_qualification_decide(UUID, UUID, TEXT, TEXT) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_qualification_list(UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_partnership_create(UUID, UUID, TEXT) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_partnership_activate(UUID, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_execution_cycle_create(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_execution_assign(UUID, UUID, UUID, NUMERIC, TEXT) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_supplier_eligible_sources(UUID, UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_supplier_qualification_decide(UUID, UUID, TEXT, TEXT) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_purchase_source_create(UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT) OWNER TO sco_internal_gateway_owner;

REVOKE ALL ON FUNCTION
  public.internal_catalog_category_create(UUID, TEXT, TEXT, UUID),
  public.internal_catalog_attribute_create(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, JSONB, JSONB),
  public.internal_catalog_product_create(UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID, TEXT, INT, TEXT),
  public.internal_catalog_product_activate(UUID, UUID),
  public.internal_candidate_submit(UUID, TEXT, UUID, TEXT, TEXT, TEXT, JSONB, UUID),
  public.internal_candidate_transition(UUID, UUID, TEXT, TEXT, UUID, TEXT, JSONB, JSONB, JSONB),
  public.internal_qualification_create(UUID, TEXT, TEXT),
  public.internal_qualification_decide(UUID, UUID, TEXT, TEXT),
  public.internal_qualification_list(UUID),
  public.internal_partnership_create(UUID, UUID, TEXT),
  public.internal_partnership_activate(UUID, UUID),
  public.internal_execution_cycle_create(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ),
  public.internal_execution_assign(UUID, UUID, UUID, NUMERIC, TEXT),
  public.internal_supplier_eligible_sources(UUID, UUID),
  public.internal_supplier_qualification_decide(UUID, UUID, TEXT, TEXT),
  public.internal_purchase_source_create(UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.internal_catalog_category_create(UUID, TEXT, TEXT, UUID),
  public.internal_catalog_attribute_create(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, JSONB, JSONB),
  public.internal_catalog_product_create(UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID, TEXT, INT, TEXT),
  public.internal_catalog_product_activate(UUID, UUID),
  public.internal_candidate_submit(UUID, TEXT, UUID, TEXT, TEXT, TEXT, JSONB, UUID),
  public.internal_candidate_transition(UUID, UUID, TEXT, TEXT, UUID, TEXT, JSONB, JSONB, JSONB),
  public.internal_qualification_create(UUID, TEXT, TEXT),
  public.internal_qualification_decide(UUID, UUID, TEXT, TEXT),
  public.internal_qualification_list(UUID),
  public.internal_partnership_create(UUID, UUID, TEXT),
  public.internal_partnership_activate(UUID, UUID),
  public.internal_execution_cycle_create(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ),
  public.internal_execution_assign(UUID, UUID, UUID, NUMERIC, TEXT),
  public.internal_supplier_eligible_sources(UUID, UUID),
  public.internal_supplier_qualification_decide(UUID, UUID, TEXT, TEXT),
  public.internal_purchase_source_create(UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT)
TO sco_internal_executor;
