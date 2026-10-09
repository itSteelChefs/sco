-- H6 Wave 1: least-privilege SCO-internal Buyer partnership action queue and readiness detail.
-- These projections are advisory only. Existing mutation gateways remain the lifecycle authority
-- and independently revalidate every approval and activation prerequisite.

CREATE FUNCTION public.internal_partnership_readiness_get(
  p_actor UUID,
  p_partnership_id UUID
)
RETURNS TABLE(
  partnership_id UUID,
  company_id UUID,
  company_display_name TEXT,
  partnership_type TEXT,
  partnership_status TEXT,
  qualification_status TEXT,
  qualification_ready BOOLEAN,
  required_agreements_satisfied BOOLEAN,
  company_status TEXT,
  company_active BOOLEAN,
  active_portal_membership_ready BOOLEAN,
  partner_portal_read_ready BOOLEAN,
  next_internal_action TEXT,
  action_ready BOOLEAN,
  blockers TEXT[],
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'partnership.manage') THEN
    RAISE EXCEPTION 'PARTNERSHIP_MANAGE_FORBIDDEN';
  END IF;

  RETURN QUERY
  WITH facts AS (
    SELECT
      partnership.id AS partnership_id,
      partnership.company_id,
      company.name AS company_display_name,
      partnership.type::TEXT AS partnership_type,
      partnership.status::TEXT AS partnership_status,
      qualification.status::TEXT AS qualification_status,
      COALESCE(qualification.status = 'APPROVED', false) AS qualification_ready,
      public.partner_required_agreements_satisfied(partnership.company_id) AS required_agreements_satisfied,
      company.status::TEXT AS company_status,
      (company.type = 'PARTNER' AND company.status = 'ACTIVE') AS company_active,
      EXISTS (
        SELECT 1
        FROM public."CompanyMembership" membership
        JOIN public."User" member_user ON member_user.id = membership."userId"
        WHERE membership."companyId" = partnership.company_id
          AND membership.status = 'ACTIVE'
          AND member_user.status = 'ACTIVE'
      ) AS active_portal_membership_ready,
      EXISTS (
        SELECT 1
        FROM public."CompanyMembership" membership
        JOIN public."User" member_user ON member_user.id = membership."userId"
        JOIN public."MembershipRole" membership_role
          ON membership_role.membership_id = membership.id
         AND membership_role.company_id = partnership.company_id
        JOIN public."RolePermission" role_permission
          ON role_permission.role_id = membership_role.role_id
         AND role_permission.company_id = partnership.company_id
        JOIN public."Permission" permission
          ON permission.id = role_permission.permission_id
         AND permission.code = 'partner.portal.read'
        WHERE membership."companyId" = partnership.company_id
          AND membership.status = 'ACTIVE'
          AND member_user.status = 'ACTIVE'
      ) AS partner_portal_read_ready,
      partnership.created_at,
      partnership.updated_at
    FROM public.company_partnerships partnership
    JOIN public."Company" company ON company.id = partnership.company_id
    LEFT JOIN public.qualification_applications qualification
      ON qualification.id = partnership.qualification_application_id
     AND qualification.company_id = partnership.company_id
    WHERE partnership.id = p_partnership_id
      AND partnership.type = 'BUYER_PARTNERSHIP'
  )
  SELECT
    facts.partnership_id,
    facts.company_id,
    facts.company_display_name,
    facts.partnership_type,
    facts.partnership_status,
    facts.qualification_status,
    facts.qualification_ready,
    facts.required_agreements_satisfied,
    facts.company_status,
    facts.company_active,
    facts.active_portal_membership_ready,
    facts.partner_portal_read_ready,
    CASE facts.partnership_status
      WHEN 'UNDER_REVIEW' THEN 'APPROVE'
      WHEN 'APPROVED' THEN 'ACTIVATE'
      WHEN 'SUSPENDED' THEN 'ACTIVATE'
      ELSE 'NONE'
    END AS next_internal_action,
    CASE facts.partnership_status
      WHEN 'UNDER_REVIEW' THEN
        facts.qualification_ready
        AND facts.required_agreements_satisfied
      WHEN 'APPROVED' THEN
        facts.company_active
        AND facts.qualification_ready
        AND facts.required_agreements_satisfied
        AND facts.active_portal_membership_ready
        AND facts.partner_portal_read_ready
      WHEN 'SUSPENDED' THEN
        facts.company_active
        AND facts.qualification_ready
        AND facts.required_agreements_satisfied
        AND facts.active_portal_membership_ready
        AND facts.partner_portal_read_ready
      ELSE false
    END AS action_ready,
    CASE
      WHEN facts.partnership_status NOT IN ('UNDER_REVIEW', 'APPROVED', 'SUSPENDED') THEN
        ARRAY['LIFECYCLE_NOT_ACTIONABLE']::TEXT[]
      ELSE array_remove(ARRAY[
        CASE WHEN facts.partnership_status IN ('APPROVED', 'SUSPENDED') AND NOT facts.company_active THEN 'COMPANY_NOT_ACTIVE' END,
        CASE WHEN NOT facts.qualification_ready THEN 'QUALIFICATION_NOT_APPROVED' END,
        CASE WHEN NOT facts.required_agreements_satisfied THEN 'REQUIRED_AGREEMENTS_NOT_SATISFIED' END,
        CASE WHEN facts.partnership_status IN ('APPROVED', 'SUSPENDED') AND NOT facts.active_portal_membership_ready THEN 'NO_ACTIVE_PORTAL_MEMBER' END,
        CASE WHEN facts.partnership_status IN ('APPROVED', 'SUSPENDED') AND NOT facts.partner_portal_read_ready THEN 'PARTNER_PORTAL_READ_NOT_READY' END
      ]::TEXT[], NULL)
    END AS blockers,
    facts.created_at,
    facts.updated_at
  FROM facts;
END
$$;

ALTER FUNCTION public.internal_partnership_readiness_get(UUID, UUID)
  OWNER TO sco_partner_admission_gateway_owner;

CREATE FUNCTION public.internal_partnership_action_queue(p_actor UUID)
RETURNS TABLE(
  partnership_id UUID,
  company_id UUID,
  company_display_name TEXT,
  partnership_type TEXT,
  partnership_status TEXT,
  qualification_status TEXT,
  qualification_ready BOOLEAN,
  required_agreements_satisfied BOOLEAN,
  company_status TEXT,
  company_active BOOLEAN,
  active_portal_membership_ready BOOLEAN,
  partner_portal_read_ready BOOLEAN,
  next_internal_action TEXT,
  action_ready BOOLEAN,
  blockers TEXT[],
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.internal_has_capability(p_actor, 'partnership.manage') THEN
    RAISE EXCEPTION 'PARTNERSHIP_MANAGE_FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT readiness.*
  FROM public.company_partnerships partnership
  CROSS JOIN LATERAL public.internal_partnership_readiness_get(p_actor, partnership.id) readiness
    WHERE partnership.type = 'BUYER_PARTNERSHIP'
    AND partnership.status IN ('UNDER_REVIEW', 'APPROVED', 'SUSPENDED')
  ORDER BY partnership.created_at ASC, partnership.id ASC;
END
$$;

ALTER FUNCTION public.internal_partnership_action_queue(UUID)
  OWNER TO sco_partner_admission_gateway_owner;

REVOKE ALL ON FUNCTION public.internal_partnership_action_queue(UUID),
  public.internal_partnership_readiness_get(UUID, UUID)
  FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;

GRANT EXECUTE ON FUNCTION public.internal_partnership_action_queue(UUID),
  public.internal_partnership_readiness_get(UUID, UUID)
  TO sco_internal_executor;
