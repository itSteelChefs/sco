-- Stage 009-A: policy metadata and evidence only. This migration deliberately
-- creates no delivery, export, sharing, retention execution, or disposal path.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_document_policy_gateway_owner') THEN
    CREATE ROLE sco_document_policy_gateway_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE sco_document_policy_gateway_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE ALL ON SCHEMA public FROM sco_document_policy_gateway_owner;
GRANT USAGE ON SCHEMA public TO sco_document_policy_gateway_owner;

CREATE TYPE "DocumentPolicySensitivity" AS ENUM ('UNCLASSIFIED', 'CONFIDENTIAL', 'RESTRICTED');
CREATE TYPE "DocumentPolicyDisclosurePosture" AS ENUM ('HIDDEN', 'ALIAS');
CREATE TYPE "DocumentPolicyLifecycleState" AS ENUM ('PENDING_POLICY', 'ACTIVE');
CREATE TYPE "DocumentRetentionMetadataState" AS ENUM ('UNSET', 'HOLD');
CREATE TYPE "DocumentLineageRelation" AS ENUM ('DERIVATIVE');
CREATE TYPE "DocumentPolicyOperation" AS ENUM (
  'METADATA_READ', 'METADATA_WRITE', 'CONTENT_READ', 'PROCESS',
  'DOWNLOAD', 'EXPORT', 'EXTERNAL_DISCLOSURE', 'RETENTION_DISPOSAL'
);

CREATE TABLE public.document_policy_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  owner_company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  custodian_company_id UUID REFERENCES public."Company"(id) ON DELETE RESTRICT,
  uploader_user_id UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  supersedes_revision_id UUID REFERENCES public.document_policy_revisions(id) ON DELETE RESTRICT,
  access_scope TEXT NOT NULL CHECK (access_scope IN ('TENANT', 'SCO_INTERNAL')),
  sensitivity "DocumentPolicySensitivity" NOT NULL,
  primary_purpose_code TEXT CHECK (primary_purpose_code IS NULL OR primary_purpose_code ~ '^PUR-[0-9]{2}$'),
  purpose_binding_reference UUID,
  disclosure_posture "DocumentPolicyDisclosurePosture" NOT NULL DEFAULT 'HIDDEN',
  lifecycle_state "DocumentPolicyLifecycleState" NOT NULL DEFAULT 'PENDING_POLICY',
  retention_metadata_state "DocumentRetentionMetadataState" NOT NULL DEFAULT 'UNSET',
  retention_basis_reference TEXT,
  source_reference TEXT,
  created_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (document_id, revision_number),
  UNIQUE (supersedes_revision_id),
  CHECK ((revision_number = 1 AND supersedes_revision_id IS NULL) OR (revision_number > 1 AND supersedes_revision_id IS NOT NULL)),
  CHECK (lifecycle_state <> 'ACTIVE' OR (sensitivity <> 'UNCLASSIFIED' AND primary_purpose_code IS NOT NULL))
);

CREATE TABLE public.document_lineage_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  source_document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  derived_document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  relation "DocumentLineageRelation" NOT NULL DEFAULT 'DERIVATIVE',
  source_policy_revision_id UUID NOT NULL REFERENCES public.document_policy_revisions(id) ON DELETE RESTRICT,
  derived_policy_revision_id UUID NOT NULL REFERENCES public.document_policy_revisions(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (source_document_id <> derived_document_id),
  UNIQUE (source_document_id, derived_document_id, relation)
);

CREATE TABLE public.document_policy_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  policy_revision_id UUID REFERENCES public.document_policy_revisions(id) ON DELETE RESTRICT,
  lineage_edge_id UUID REFERENCES public.document_lineage_edges(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('document.policy.created', 'document.policy.revised', 'document.lineage.created', 'document.policy.operation_denied')),
  operation "DocumentPolicyOperation",
  reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((policy_revision_id IS NOT NULL)::INTEGER + (lineage_edge_id IS NOT NULL)::INTEGER = 1)
);

CREATE TABLE public.document_policy_purpose_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES public."Company"(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  related_document_id UUID REFERENCES public.documents(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('POLICY_REVISE', 'LINEAGE_CREATE')),
  purpose_code TEXT NOT NULL CHECK (purpose_code = 'PUR-15'),
  flow_cpf_id TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_backend_pid INTEGER,
  consumed_transaction_id BIGINT,
  CHECK (expires_at > issued_at AND expires_at <= issued_at + INTERVAL '60 seconds'),
  CHECK ((operation = 'POLICY_REVISE' AND related_document_id IS NULL) OR (operation = 'LINEAGE_CREATE' AND related_document_id IS NOT NULL)),
  CHECK (flow_cpf_id IS NULL),
  CHECK ((consumed_at IS NULL AND consumed_backend_pid IS NULL AND consumed_transaction_id IS NULL)
    OR (consumed_at IS NOT NULL AND consumed_backend_pid IS NOT NULL AND consumed_transaction_id IS NOT NULL))
);

CREATE INDEX document_policy_revisions_current_idx ON public.document_policy_revisions(document_id, revision_number DESC);
CREATE INDEX document_lineage_edges_source_idx ON public.document_lineage_edges(source_document_id);
CREATE INDEX document_lineage_edges_derived_idx ON public.document_lineage_edges(derived_document_id);

ALTER TABLE public.document_policy_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_policy_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_lineage_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_lineage_edges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_policy_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_policy_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_policy_purpose_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_policy_purpose_decisions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.document_policy_revisions OWNER TO sco_document_policy_gateway_owner;
ALTER TABLE public.document_lineage_edges OWNER TO sco_document_policy_gateway_owner;
ALTER TABLE public.document_policy_events OWNER TO sco_document_policy_gateway_owner;
ALTER TABLE public.document_policy_purpose_decisions OWNER TO sco_document_policy_gateway_owner;

REVOKE ALL ON TABLE public.document_policy_revisions, public.document_lineage_edges, public.document_policy_events, public.document_policy_purpose_decisions
  FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority, sco_disclosure_gateway_owner;

CREATE POLICY document_policy_revisions_gateway_owner ON public.document_policy_revisions
  FOR ALL TO sco_document_policy_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY document_lineage_edges_gateway_owner ON public.document_lineage_edges
  FOR ALL TO sco_document_policy_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY document_policy_events_gateway_owner ON public.document_policy_events
  FOR ALL TO sco_document_policy_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY document_policy_purpose_decisions_gateway_owner ON public.document_policy_purpose_decisions
  FOR ALL TO sco_document_policy_gateway_owner
  USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID)
  WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);

GRANT SELECT ON public.documents TO sco_document_policy_gateway_owner;
CREATE POLICY documents_document_policy_gateway_owner ON public.documents
  FOR SELECT TO sco_document_policy_gateway_owner USING (true);

CREATE FUNCTION public.document_policy_prevent_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'DOCUMENT_POLICY_HISTORY_IMMUTABLE';
END
$$;

CREATE TRIGGER document_policy_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.document_policy_revisions
  FOR EACH ROW EXECUTE FUNCTION public.document_policy_prevent_history_mutation();
CREATE TRIGGER document_lineage_edges_immutable
  BEFORE UPDATE OR DELETE ON public.document_lineage_edges
  FOR EACH ROW EXECUTE FUNCTION public.document_policy_prevent_history_mutation();
CREATE TRIGGER document_policy_events_immutable
  BEFORE UPDATE OR DELETE ON public.document_policy_events
  FOR EACH ROW EXECUTE FUNCTION public.document_policy_prevent_history_mutation();

CREATE FUNCTION public.document_policy_create_initial()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_policy_id UUID;
BEGIN
  INSERT INTO public.document_policy_revisions (
    document_id, company_id, owner_company_id, uploader_user_id, revision_number,
    access_scope, sensitivity, disclosure_posture, lifecycle_state, retention_metadata_state, created_by
  ) VALUES (
    NEW.id, NEW.company_id, NEW.company_id, NEW.uploader_user_id, 1,
    NEW.access_scope, 'UNCLASSIFIED', 'HIDDEN', 'PENDING_POLICY', 'UNSET', NEW.uploader_user_id
  ) RETURNING id INTO v_policy_id;

  INSERT INTO public.document_policy_events (company_id, document_id, policy_revision_id, actor_user_id, action, reason_code)
  VALUES (NEW.company_id, NEW.id, v_policy_id, NEW.uploader_user_id, 'document.policy.created', 'INITIAL_UNCLASSIFIED');
  RETURN NEW;
END
$$;

ALTER FUNCTION public.document_policy_create_initial() OWNER TO sco_document_policy_gateway_owner;
REVOKE ALL ON FUNCTION public.document_policy_create_initial() FROM PUBLIC;

INSERT INTO public.document_policy_revisions (
  document_id, company_id, owner_company_id, uploader_user_id, revision_number,
  access_scope, sensitivity, disclosure_posture, lifecycle_state, retention_metadata_state, created_by
)
SELECT d.id, d.company_id, d.company_id, d.uploader_user_id, 1,
       d.access_scope, 'UNCLASSIFIED', 'HIDDEN', 'PENDING_POLICY', 'UNSET', d.uploader_user_id
FROM public.documents d;

INSERT INTO public.document_policy_events (company_id, document_id, policy_revision_id, actor_user_id, action, reason_code)
SELECT p.company_id, p.document_id, p.id, p.uploader_user_id, 'document.policy.created', 'MIGRATED_UNCLASSIFIED'
FROM public.document_policy_revisions p;

CREATE TRIGGER documents_create_initial_document_policy
  AFTER INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.document_policy_create_initial();

CREATE FUNCTION public.document_policy_capability_authorized(p_actor UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.internal_has_capability(p_actor, 'document.policy.manage')
$$;

ALTER FUNCTION public.document_policy_capability_authorized(UUID) OWNER TO sco_internal_gateway_owner;
REVOKE ALL ON FUNCTION public.document_policy_capability_authorized(UUID) FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;
GRANT EXECUTE ON FUNCTION public.document_policy_capability_authorized(UUID) TO sco_document_policy_gateway_owner;

CREATE FUNCTION public.issue_document_policy_purpose_decision(
  p_actor UUID,
  p_company UUID,
  p_document UUID,
  p_related_document UUID,
  p_operation TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_document public.documents%ROWTYPE;
  v_related_document public.documents%ROWTYPE;
  v_id UUID;
BEGIN
  IF session_user <> 'sco_purpose_authority'
     OR p_operation NOT IN ('POLICY_REVISE', 'LINEAGE_CREATE')
     OR (p_operation = 'POLICY_REVISE' AND p_related_document IS NOT NULL)
     OR (p_operation = 'LINEAGE_CREATE' AND p_related_document IS NULL)
     OR NOT public.document_policy_capability_authorized(p_actor) THEN
    RAISE EXCEPTION 'DOCUMENT_POLICY_PURPOSE_ISSUE_FORBIDDEN';
  END IF;

  PERFORM set_config('app.tenant_id', p_company::TEXT, true);
  SELECT * INTO v_document FROM public.documents WHERE id = p_document;
  IF NOT FOUND OR v_document.company_id <> p_company THEN
    RAISE EXCEPTION 'DOCUMENT_POLICY_PURPOSE_ISSUE_FORBIDDEN';
  END IF;
  IF p_related_document IS NOT NULL THEN
    SELECT * INTO v_related_document FROM public.documents WHERE id = p_related_document;
    IF NOT FOUND OR v_related_document.company_id <> p_company OR p_document = p_related_document THEN
      RAISE EXCEPTION 'DOCUMENT_POLICY_PURPOSE_ISSUE_FORBIDDEN';
    END IF;
  END IF;

  INSERT INTO public.document_policy_purpose_decisions (
    actor_user_id, company_id, document_id, related_document_id, operation, purpose_code, expires_at
  ) VALUES (
    p_actor, p_company, p_document, p_related_document, p_operation, 'PUR-15', clock_timestamp() + INTERVAL '30 seconds'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

CREATE FUNCTION public.consume_document_policy_purpose_decision(
  p_decision UUID,
  p_actor UUID,
  p_company UUID,
  p_document UUID,
  p_related_document UUID,
  p_operation TEXT,
  p_backend_pid INTEGER,
  p_transaction_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF session_user <> 'sco_purpose_authority' OR p_backend_pid <= 0 OR p_transaction_id <= 0 THEN
    RAISE EXCEPTION 'DOCUMENT_POLICY_PURPOSE_CONSUME_FORBIDDEN';
  END IF;
  PERFORM set_config('app.tenant_id', p_company::TEXT, true);
  UPDATE public.document_policy_purpose_decisions
     SET consumed_at = clock_timestamp(), consumed_backend_pid = p_backend_pid, consumed_transaction_id = p_transaction_id
   WHERE id = p_decision
     AND actor_user_id = p_actor
     AND company_id = p_company
     AND document_id = p_document
     AND related_document_id IS NOT DISTINCT FROM p_related_document
     AND operation = p_operation
     AND purpose_code = 'PUR-15'
     AND flow_cpf_id IS NULL
     AND consumed_at IS NULL
     AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_POLICY_PURPOSE_CONSUME_FORBIDDEN'; END IF;
END
$$;

CREATE FUNCTION public.document_policy_purpose_authorized(
  p_decision UUID,
  p_actor UUID,
  p_company UUID,
  p_document UUID,
  p_related_document UUID,
  p_operation TEXT
) RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.document_policy_purpose_decisions
    WHERE id = p_decision
      AND actor_user_id = p_actor
      AND company_id = p_company
      AND document_id = p_document
      AND related_document_id IS NOT DISTINCT FROM p_related_document
      AND operation = p_operation
      AND purpose_code = 'PUR-15'
      AND flow_cpf_id IS NULL
      AND consumed_at IS NOT NULL
      AND expires_at > clock_timestamp()
      AND consumed_backend_pid = pg_backend_pid()
      AND consumed_transaction_id = txid_current()
  )
$$;

CREATE FUNCTION public.document_policy_revise(
  p_actor UUID,
  p_document UUID,
  p_sensitivity "DocumentPolicySensitivity",
  p_lifecycle_state "DocumentPolicyLifecycleState",
  p_retention_metadata_state "DocumentRetentionMetadataState",
  p_retention_basis_reference TEXT,
  p_decision UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current public.document_policy_revisions%ROWTYPE;
  v_document public.documents%ROWTYPE;
  v_id UUID;
BEGIN
  IF session_user <> 'sco_internal_executor' THEN RAISE EXCEPTION 'DOCUMENT_POLICY_MANAGE_FORBIDDEN'; END IF;
  SELECT * INTO v_document FROM public.documents WHERE id = p_document;
  PERFORM set_config('app.tenant_id', v_document.company_id::TEXT, true);
  IF NOT FOUND
     OR NOT public.document_policy_capability_authorized(p_actor)
     OR NOT public.document_policy_purpose_authorized(p_decision, p_actor, v_document.company_id, p_document, NULL, 'POLICY_REVISE') THEN
    RAISE EXCEPTION 'DOCUMENT_POLICY_MANAGE_FORBIDDEN';
  END IF;
  SELECT * INTO v_current FROM public.document_policy_revisions
    WHERE document_id = p_document ORDER BY revision_number DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_POLICY_NOT_FOUND'; END IF;
  IF p_sensitivity < v_current.sensitivity
     OR p_retention_metadata_state < v_current.retention_metadata_state
     OR (v_current.primary_purpose_code IS NOT NULL AND v_current.primary_purpose_code <> 'PUR-15')
     OR (p_lifecycle_state = 'ACTIVE' AND p_sensitivity = 'UNCLASSIFIED') THEN
    RAISE EXCEPTION 'DOCUMENT_POLICY_BROADENING_FORBIDDEN';
  END IF;

  INSERT INTO public.document_policy_revisions (
    document_id, company_id, owner_company_id, custodian_company_id, uploader_user_id,
    revision_number, supersedes_revision_id, access_scope, sensitivity, primary_purpose_code,
    purpose_binding_reference, disclosure_posture, lifecycle_state, retention_metadata_state,
    retention_basis_reference, source_reference, created_by
  ) VALUES (
    v_current.document_id, v_current.company_id, v_current.owner_company_id, v_current.custodian_company_id, v_current.uploader_user_id,
    v_current.revision_number + 1, v_current.id, v_current.access_scope, p_sensitivity, 'PUR-15',
    p_decision, v_current.disclosure_posture, p_lifecycle_state, p_retention_metadata_state,
    NULLIF(btrim(COALESCE(p_retention_basis_reference, '')), ''), v_current.source_reference, p_actor
  ) RETURNING id INTO v_id;
  INSERT INTO public.document_policy_events (company_id, document_id, policy_revision_id, actor_user_id, action)
  VALUES (v_document.company_id, p_document, v_id, p_actor, 'document.policy.revised');
  RETURN v_id;
END
$$;

CREATE FUNCTION public.document_lineage_derivative_create(
  p_actor UUID,
  p_source_document UUID,
  p_derived_document UUID,
  p_decision UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source_document public.documents%ROWTYPE;
  v_derived_document public.documents%ROWTYPE;
  v_source_policy public.document_policy_revisions%ROWTYPE;
  v_derived_policy public.document_policy_revisions%ROWTYPE;
  v_id UUID;
BEGIN
  IF session_user <> 'sco_internal_executor' OR p_source_document = p_derived_document THEN
    RAISE EXCEPTION 'DOCUMENT_LINEAGE_MANAGE_FORBIDDEN';
  END IF;
  SELECT * INTO v_source_document FROM public.documents WHERE id = p_source_document;
  SELECT * INTO v_derived_document FROM public.documents WHERE id = p_derived_document;
  PERFORM set_config('app.tenant_id', v_source_document.company_id::TEXT, true);
  IF v_source_document.id IS NULL OR v_derived_document.id IS NULL OR v_source_document.company_id <> v_derived_document.company_id
     OR NOT public.document_policy_capability_authorized(p_actor)
     OR NOT public.document_policy_purpose_authorized(p_decision, p_actor, v_source_document.company_id, p_source_document, p_derived_document, 'LINEAGE_CREATE') THEN
    RAISE EXCEPTION 'DOCUMENT_LINEAGE_MANAGE_FORBIDDEN';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_source_document.company_id::TEXT, 0));
  IF EXISTS (
    WITH RECURSIVE descendants(id) AS (
      SELECT p_derived_document
      UNION
      SELECT e.derived_document_id
      FROM public.document_lineage_edges e
      JOIN descendants d ON d.id = e.source_document_id
    )
    SELECT 1 FROM descendants WHERE id = p_source_document
  ) THEN
    RAISE EXCEPTION 'DOCUMENT_LINEAGE_CYCLE';
  END IF;
  SELECT * INTO v_source_policy FROM public.document_policy_revisions WHERE document_id = p_source_document ORDER BY revision_number DESC LIMIT 1;
  SELECT * INTO v_derived_policy FROM public.document_policy_revisions WHERE document_id = p_derived_document ORDER BY revision_number DESC LIMIT 1;
  IF NOT FOUND
     OR v_derived_policy.access_scope <> v_source_policy.access_scope
     OR v_derived_policy.sensitivity < v_source_policy.sensitivity
     OR v_derived_policy.disclosure_posture > v_source_policy.disclosure_posture
     OR v_derived_policy.primary_purpose_code IS DISTINCT FROM v_source_policy.primary_purpose_code THEN
    RAISE EXCEPTION 'DOCUMENT_LINEAGE_RESTRICTION_FORBIDDEN';
  END IF;
  INSERT INTO public.document_lineage_edges (
    company_id, source_document_id, derived_document_id, source_policy_revision_id, derived_policy_revision_id, created_by
  ) VALUES (
    v_source_document.company_id, p_source_document, p_derived_document, v_source_policy.id, v_derived_policy.id, p_actor
  ) RETURNING id INTO v_id;
  INSERT INTO public.document_policy_events (company_id, document_id, lineage_edge_id, actor_user_id, action)
  VALUES (v_source_document.company_id, p_derived_document, v_id, p_actor, 'document.lineage.created');
  RETURN v_id;
END
$$;

CREATE FUNCTION public.document_policy_operation_allowed(p_document UUID, p_operation "DocumentPolicyOperation")
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT false
$$;

ALTER FUNCTION public.issue_document_policy_purpose_decision(UUID, UUID, UUID, UUID, TEXT) OWNER TO sco_document_policy_gateway_owner;
ALTER FUNCTION public.consume_document_policy_purpose_decision(UUID, UUID, UUID, UUID, UUID, TEXT, INTEGER, BIGINT) OWNER TO sco_document_policy_gateway_owner;
ALTER FUNCTION public.document_policy_purpose_authorized(UUID, UUID, UUID, UUID, UUID, TEXT) OWNER TO sco_document_policy_gateway_owner;
ALTER FUNCTION public.document_policy_revise(UUID, UUID, "DocumentPolicySensitivity", "DocumentPolicyLifecycleState", "DocumentRetentionMetadataState", TEXT, UUID) OWNER TO sco_document_policy_gateway_owner;
ALTER FUNCTION public.document_lineage_derivative_create(UUID, UUID, UUID, UUID) OWNER TO sco_document_policy_gateway_owner;
ALTER FUNCTION public.document_policy_operation_allowed(UUID, "DocumentPolicyOperation") OWNER TO sco_document_policy_gateway_owner;
REVOKE ALL ON FUNCTION public.issue_document_policy_purpose_decision(UUID, UUID, UUID, UUID, TEXT), public.consume_document_policy_purpose_decision(UUID, UUID, UUID, UUID, UUID, TEXT, INTEGER, BIGINT), public.document_policy_purpose_authorized(UUID, UUID, UUID, UUID, UUID, TEXT), public.document_policy_revise(UUID, UUID, "DocumentPolicySensitivity", "DocumentPolicyLifecycleState", "DocumentRetentionMetadataState", TEXT, UUID), public.document_lineage_derivative_create(UUID, UUID, UUID, UUID) FROM PUBLIC, sco_runtime, sco_internal_executor, sco_purpose_authority;
REVOKE ALL ON FUNCTION public.document_policy_operation_allowed(UUID, "DocumentPolicyOperation") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_document_policy_purpose_decision(UUID, UUID, UUID, UUID, TEXT), public.consume_document_policy_purpose_decision(UUID, UUID, UUID, UUID, UUID, TEXT, INTEGER, BIGINT) TO sco_purpose_authority;
GRANT EXECUTE ON FUNCTION public.document_policy_revise(UUID, UUID, "DocumentPolicySensitivity", "DocumentPolicyLifecycleState", "DocumentRetentionMetadataState", TEXT, UUID), public.document_lineage_derivative_create(UUID, UUID, UUID, UUID) TO sco_internal_executor;

INSERT INTO public."Permission"(id, code, description)
VALUES (gen_random_uuid(), 'document.policy.manage', 'Revise restrictive document policy and record document lineage')
ON CONFLICT (code) DO NOTHING;
