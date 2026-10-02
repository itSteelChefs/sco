-- Stage 007 remediation: procurement-need intake is only available through a
-- narrow CPF-03 gateway owned by the non-login gateway owner role.
ALTER TABLE public.audit_logs ADD COLUMN flow_cpf_id TEXT;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_flow_cpf_id_valid
  CHECK (flow_cpf_id IS NULL OR flow_cpf_id ~ '^CPF_(0[1-9]|[1-3][0-9]|4[0-1])$');

REVOKE INSERT, UPDATE, DELETE ON public.procurement_needs FROM sco_runtime;
DROP POLICY IF EXISTS procurement_needs_tenant ON public.procurement_needs;
CREATE POLICY procurement_needs_runtime_read ON public.procurement_needs
  FOR SELECT TO sco_runtime
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);

GRANT INSERT ON public.procurement_needs TO sco_internal_gateway_owner;
GRANT INSERT ON public.audit_logs TO sco_internal_gateway_owner;
CREATE POLICY audit_logs_gateway_owner_insert ON public.audit_logs
  FOR INSERT TO sco_internal_gateway_owner WITH CHECK (true);

CREATE FUNCTION public.internal_procurement_need_create(
  p_actor UUID,
  p_company UUID,
  p_description TEXT,
  p_quantity NUMERIC,
  p_unit_id UUID,
  p_need_date DATE,
  p_project_id UUID,
  p_product_identity_id UUID,
  p_product_candidate_id UUID,
  p_correlation_id UUID
)
RETURNS TABLE(id UUID, description TEXT, quantity NUMERIC, maturity TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_need public.procurement_needs%ROWTYPE;
  v_correlation_id UUID := COALESCE(p_correlation_id, public.gen_random_uuid());
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."CompanyMembership" cm
    JOIN public.company_partnerships cp
      ON cp.company_id = cm."companyId"
      AND cp.type = 'BUYER_PARTNERSHIP'
      AND cp.status = 'ACTIVE'
    WHERE cm."userId" = p_actor
      AND cm."companyId" = p_company
      AND cm.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'PROCUREMENT_NEED_INTAKE_FORBIDDEN';
  END IF;

  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects WHERE projects.id = p_project_id AND projects.company_id = p_company
  ) THEN
    RAISE EXCEPTION 'PROCUREMENT_NEED_PROJECT_COMPANY_MISMATCH';
  END IF;

  INSERT INTO public.procurement_needs (
    company_id, created_by, source_type, description, quantity, unit_id, need_date,
    project_id, product_identity_id, product_candidate_id
  ) VALUES (
    p_company, p_actor, 'MANUAL', p_description, p_quantity, p_unit_id, p_need_date,
    p_project_id, p_product_identity_id, p_product_candidate_id
  ) RETURNING * INTO v_need;

  INSERT INTO public.audit_logs (
    actor_user_id, company_id, scope, action, entity_type, entity_id, metadata,
    correlation_id, purpose_code, flow_cpf_id, flow_source, flow_target, authorization_decision
  ) VALUES (
    p_actor, p_company, 'TENANT', 'procurement_need.created', 'ProcurementNeed', v_need.id, '{}',
    v_correlation_id, 'PUR-05', 'CPF_03', 'PUR-03', 'PUR-05', 'ALLOWED'
  );

  RETURN QUERY SELECT v_need.id, v_need.description, v_need.quantity, v_need.maturity::TEXT;
END $$;

ALTER FUNCTION public.internal_procurement_need_create(UUID, UUID, TEXT, NUMERIC, UUID, DATE, UUID, UUID, UUID, UUID)
  OWNER TO sco_internal_gateway_owner;
REVOKE ALL ON FUNCTION public.internal_procurement_need_create(UUID, UUID, TEXT, NUMERIC, UUID, DATE, UUID, UUID, UUID, UUID) FROM PUBLIC, sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_procurement_need_create(UUID, UUID, TEXT, NUMERIC, UUID, DATE, UUID, UUID, UUID, UUID)
  TO sco_internal_executor;
