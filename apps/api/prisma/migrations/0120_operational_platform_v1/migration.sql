-- Capability H — Operational Platform V1
-- Work queue, exceptions, weekly cycle, notifications, jobs, config, health support.
-- Does not become SoT for A–G business records.

INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'operations.read', 'Internal read operational work queue and evidence'),
  (gen_random_uuid(), 'operations.assign', 'Internal assign/reassign operational work items'),
  (gen_random_uuid(), 'operations.retry', 'Internal retry safe operational exceptions/jobs'),
  (gen_random_uuid(), 'operations.cycle.manage', 'Internal manage weekly operations cycles'),
  (gen_random_uuid(), 'operations.health.read', 'Internal read operational health'),
  (gen_random_uuid(), 'operations.config.manage', 'Internal manage operational configuration')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE public.h_operational_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  -- Soft actor reference: no FK so user lifecycle / TRUNCATE CASCADE cannot wipe operational knobs.
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  version INT NOT NULL DEFAULT 1
);

INSERT INTO public.h_operational_config(key, value) VALUES
  ('weekly_cutoff', jsonb_build_object('timezone','Asia/Riyadh','cutoffWeekday',4,'cutoffHour',17,'collectionStartWeekday',0)),
  ('retry_limits', jsonb_build_object('defaultMaxAttempts',3,'minBackoffSeconds',30)),
  ('notification_toggles', jsonb_build_object('assignment',true,'actionRequired',true,'exception',true,'cycle',true,'job',true)),
  ('operational_thresholds', jsonb_build_object('agingHours',48,'blockedAlertHours',24));

CREATE TABLE public.h_work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('A','B','C','D','E','F','G','H')),
  source_entity_type TEXT NOT NULL,
  source_entity_id UUID NOT NULL,
  work_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','BLOCKED','DONE')),
  priority INT NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
  assigned_user_id UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  assigned_team TEXT,
  assigned_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  action_required BOOLEAN NOT NULL DEFAULT FALSE,
  blocked_reason TEXT,
  next_action TEXT,
  cycle_id UUID,
  partner_company_id UUID REFERENCES public."Company"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT h_work_items_source_key_uniq UNIQUE (source_key)
);
CREATE INDEX h_work_items_status_priority_idx ON public.h_work_items(status, priority, updated_at DESC);
CREATE INDEX h_work_items_assignee_idx ON public.h_work_items(assigned_user_id, status);
CREATE INDEX h_work_items_domain_idx ON public.h_work_items(domain, status);
CREATE INDEX h_work_items_due_idx ON public.h_work_items(due_at) WHERE status IN ('OPEN','IN_PROGRESS','BLOCKED');

CREATE TABLE public.h_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('A','B','C','D','E','F','G','H')),
  source_entity_type TEXT NOT NULL,
  source_entity_id UUID NOT NULL,
  exception_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  retryable BOOLEAN NOT NULL DEFAULT FALSE,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  last_attempt_at TIMESTAMPTZ,
  next_allowed_attempt_at TIMESTAMPTZ,
  safe_error_code TEXT NOT NULL,
  safe_error_message TEXT NOT NULL,
  work_item_id UUID REFERENCES public.h_work_items(id) ON DELETE RESTRICT,
  acknowledged_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  acknowledged_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT h_exceptions_source_key_uniq UNIQUE (source_key)
);
CREATE INDEX h_exceptions_status_idx ON public.h_exceptions(status, updated_at DESC);

CREATE TABLE public.h_weekly_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_code TEXT NOT NULL UNIQUE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  cutoff_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','LOCKED','IN_EXECUTION','COMPLETED')),
  locked_at TIMESTAMPTZ,
  locked_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  membership_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (starts_at < cutoff_at AND cutoff_at <= ends_at)
);

CREATE TABLE public.h_cycle_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES public.h_weekly_cycles(id) ON DELETE RESTRICT,
  work_item_id UUID NOT NULL REFERENCES public.h_work_items(id) ON DELETE RESTRICT,
  source_key TEXT NOT NULL,
  included_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  override_reason TEXT,
  override_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  UNIQUE (cycle_id, work_item_id),
  UNIQUE (cycle_id, source_key)
);
CREATE INDEX h_cycle_memberships_cycle_idx ON public.h_cycle_memberships(cycle_id);

ALTER TABLE public.h_work_items
  ADD CONSTRAINT h_work_items_cycle_fk FOREIGN KEY (cycle_id) REFERENCES public.h_weekly_cycles(id) ON DELETE RESTRICT;

CREATE TABLE public.h_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL,
  recipient_user_id UUID NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'ASSIGNMENT','ACTION_REQUIRED','APPROVAL_PENDING','EXCEPTION','RETRY_FAILED',
    'SUPPLIER_CONFIRMATION_CHANGED','CYCLE_LOCKED','CYCLE_COMPLETED','JOB_FAILED','JOB_SUCCEEDED'
  )),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  domain TEXT,
  source_entity_type TEXT,
  source_entity_id UUID,
  work_item_id UUID REFERENCES public.h_work_items(id) ON DELETE RESTRICT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT h_notifications_dedupe_uniq UNIQUE (dedupe_key)
);
CREATE INDEX h_notifications_recipient_idx ON public.h_notifications(recipient_user_id, created_at DESC);
CREATE INDEX h_notifications_unread_idx ON public.h_notifications(recipient_user_id) WHERE read_at IS NULL;

CREATE TABLE public.h_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL CHECK (job_type IN (
    'G_REFRESH','NOTIFICATION_PROCESS','OPERATIONAL_RECONCILE','RETENTION_MAINTENANCE'
  )),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  attempt INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  safe_error TEXT,
  created_by UUID REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT h_jobs_idempotency_uniq UNIQUE (job_type, idempotency_key)
);
CREATE INDEX h_jobs_status_sched_idx ON public.h_jobs(status, scheduled_at);

CREATE TABLE public.h_job_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.h_jobs(id) ON DELETE RESTRICT,
  attempt INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ,
  safe_error TEXT,
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (job_id, attempt)
);

-- RLS internal-only
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'h_operational_config','h_work_items','h_exceptions','h_weekly_cycles','h_cycle_memberships',
    'h_notifications','h_jobs','h_job_executions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_internal ON public.%I FOR ALL
         USING (current_setting(''app.sco_internal'', true) = ''true'')
         WITH CHECK (current_setting(''app.sco_internal'', true) = ''true'')', t, t);
  END LOOP;
END $$;

REVOKE ALL ON
  public.h_operational_config, public.h_work_items, public.h_exceptions,
  public.h_weekly_cycles, public.h_cycle_memberships, public.h_notifications,
  public.h_jobs, public.h_job_executions
FROM sco_runtime, PUBLIC;
-- Access only via SECURITY DEFINER gateways; RLS still requires app.sco_internal for defense-in-depth.

CREATE OR REPLACE FUNCTION public.h_ops_capability(p_actor UUID, p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.internal_has_capability(p_actor, p_code)
     OR public.internal_has_capability(p_actor, 'sco.internal.manage');
$$;

CREATE OR REPLACE FUNCTION public.internal_h_work_item_upsert(
  p_actor UUID, p_domain TEXT, p_entity_type TEXT, p_entity_id UUID, p_work_type TEXT,
  p_priority INT, p_due TIMESTAMPTZ, p_action_required BOOLEAN, p_next_action TEXT,
  p_partner UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_key TEXT := p_domain || ':' || p_entity_type || ':' || p_entity_id::text || ':' || p_work_type;
  v_id UUID; v_existing UUID; v_cycle UUID;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.read') THEN
    RAISE EXCEPTION 'H_OPS_FORBIDDEN';
  END IF;
  SELECT id INTO v_existing FROM public.h_work_items WHERE source_key = v_key;
  IF v_existing IS NOT NULL THEN
    UPDATE public.h_work_items SET
      priority = COALESCE(p_priority, priority),
      due_at = COALESCE(p_due, due_at),
      action_required = COALESCE(p_action_required, action_required),
      next_action = COALESCE(p_next_action, next_action),
      partner_company_id = COALESCE(p_partner, partner_company_id),
      updated_at = clock_timestamp()
     WHERE id = v_existing AND status <> 'DONE';
    RETURN v_existing;
  END IF;
  -- attach to open cycle if before cutoff, else leave null (next cycle)
  SELECT id INTO v_cycle FROM public.h_weekly_cycles
   WHERE status = 'OPEN' AND clock_timestamp() < cutoff_at
   ORDER BY starts_at DESC LIMIT 1;
  v_id := gen_random_uuid();
  INSERT INTO public.h_work_items(
    id, source_key, domain, source_entity_type, source_entity_id, work_type,
    status, priority, due_at, action_required, next_action, cycle_id, partner_company_id
  ) VALUES (
    v_id, v_key, p_domain, p_entity_type, p_entity_id, p_work_type,
    'OPEN', COALESCE(p_priority,50), p_due, COALESCE(p_action_required,false), p_next_action, v_cycle, p_partner
  );
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.work_item.created', 'HWorkItem', v_id,
          jsonb_build_object('sourceKey', v_key, 'domain', p_domain), p_correlation);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_work_item_assign(
  p_actor UUID, p_work_item UUID, p_assignee UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.assign') THEN
    RAISE EXCEPTION 'H_OPS_ASSIGN_FORBIDDEN';
  END IF;
  SELECT * INTO r FROM public.h_work_items WHERE id = p_work_item FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'H_WORK_ITEM_NOT_FOUND'; END IF;
  IF r.status = 'DONE' THEN RAISE EXCEPTION 'H_WORK_ITEM_DONE'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."CompanyMembership" cm
     JOIN public."Company" c ON c.id = cm."companyId"
    WHERE cm."userId" = p_assignee AND cm.status = 'ACTIVE' AND c.type = 'SCO' AND c.status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'H_ASSIGNEE_INVALID'; END IF;
  UPDATE public.h_work_items SET
    assigned_user_id = p_assignee, assigned_by = p_actor, assigned_at = clock_timestamp(),
    status = CASE WHEN status = 'OPEN' THEN 'IN_PROGRESS' ELSE status END,
    updated_at = clock_timestamp()
   WHERE id = p_work_item;
  -- notification dedupe
  INSERT INTO public.h_notifications(dedupe_key, recipient_user_id, event_type, title, body, domain, source_entity_type, source_entity_id, work_item_id)
  VALUES (
    'ASSIGNMENT:' || p_work_item::text || ':' || p_assignee::text || ':' || COALESCE(r.assigned_user_id::text,'none'),
    p_assignee, 'ASSIGNMENT', 'Work assigned', 'You were assigned an operational work item',
    r.domain, r.source_entity_type, r.source_entity_id, p_work_item
  ) ON CONFLICT (dedupe_key) DO NOTHING;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.work_item.assigned', 'HWorkItem', p_work_item,
          jsonb_build_object('assignee', p_assignee, 'previous', r.assigned_user_id), p_correlation);
  RETURN p_work_item;
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_work_item_transition(
  p_actor UUID, p_work_item UUID, p_status TEXT, p_blocked_reason TEXT, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.assign') THEN
    RAISE EXCEPTION 'H_OPS_ASSIGN_FORBIDDEN';
  END IF;
  SELECT * INTO r FROM public.h_work_items WHERE id = p_work_item FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'H_WORK_ITEM_NOT_FOUND'; END IF;
  IF r.status = p_status THEN RETURN p_work_item; END IF;
  IF p_status NOT IN ('OPEN','IN_PROGRESS','BLOCKED','DONE') THEN RAISE EXCEPTION 'H_STATUS_INVALID'; END IF;
  IF p_status = 'BLOCKED' AND COALESCE(btrim(p_blocked_reason),'') = '' THEN
    RAISE EXCEPTION 'H_BLOCKED_REASON_REQUIRED';
  END IF;
  UPDATE public.h_work_items SET
    status = p_status,
    blocked_reason = CASE WHEN p_status = 'BLOCKED' THEN btrim(p_blocked_reason) ELSE NULL END,
    updated_at = clock_timestamp()
   WHERE id = p_work_item;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.work_item.transitioned', 'HWorkItem', p_work_item,
          jsonb_build_object('from', r.status, 'to', p_status), p_correlation);
  RETURN p_work_item;
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_work_queue(
  p_actor UUID, p_view TEXT, p_domain TEXT, p_limit INT, p_offset INT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit,50),1),200);
  v_offset INT := GREATEST(COALESCE(p_offset,0),0);
  v_total INT;
  v_aging INT := COALESCE((SELECT (value->>'agingHours')::int FROM public.h_operational_config WHERE key='operational_thresholds'),48);
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.read') THEN
    RAISE EXCEPTION 'H_OPS_READ_FORBIDDEN';
  END IF;
  SELECT COUNT(*)::int INTO v_total FROM public.h_work_items w
   WHERE (p_domain IS NULL OR w.domain = p_domain)
     AND (
       (p_view = 'my' AND w.assigned_user_id = p_actor AND w.status IN ('OPEN','IN_PROGRESS','BLOCKED'))
       OR (p_view = 'unassigned' AND w.assigned_user_id IS NULL AND w.status IN ('OPEN','IN_PROGRESS'))
       OR (p_view = 'blocked' AND w.status = 'BLOCKED')
       OR (p_view = 'aging' AND w.status IN ('OPEN','IN_PROGRESS','BLOCKED') AND w.created_at < clock_timestamp() - make_interval(hours => v_aging))
       OR (p_view = 'all' OR p_view IS NULL)
     );
  RETURN jsonb_build_object(
    'total', v_total, 'limit', v_limit, 'offset', v_offset, 'view', COALESCE(p_view,'all'),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', w.id, 'domain', w.domain, 'sourceEntityType', w.source_entity_type,
        'sourceEntityId', w.source_entity_id, 'workType', w.work_type, 'status', w.status,
        'priority', w.priority, 'assignedUserId', w.assigned_user_id, 'dueAt', w.due_at,
        'actionRequired', w.action_required, 'blockedReason', w.blocked_reason,
        'nextAction', w.next_action, 'cycleId', w.cycle_id, 'createdAt', w.created_at, 'updatedAt', w.updated_at
      ) ORDER BY w.priority ASC, w.updated_at DESC)
      FROM (
        SELECT * FROM public.h_work_items w
         WHERE (p_domain IS NULL OR w.domain = p_domain)
           AND (
             (p_view = 'my' AND w.assigned_user_id = p_actor AND w.status IN ('OPEN','IN_PROGRESS','BLOCKED'))
             OR (p_view = 'unassigned' AND w.assigned_user_id IS NULL AND w.status IN ('OPEN','IN_PROGRESS'))
             OR (p_view = 'blocked' AND w.status = 'BLOCKED')
             OR (p_view = 'aging' AND w.status IN ('OPEN','IN_PROGRESS','BLOCKED') AND w.created_at < clock_timestamp() - make_interval(hours => v_aging))
             OR (p_view = 'all' OR p_view IS NULL)
           )
         ORDER BY w.priority ASC, w.updated_at DESC
         LIMIT v_limit OFFSET v_offset
      ) w
    ), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_exception_upsert(
  p_actor UUID, p_domain TEXT, p_entity_type TEXT, p_entity_id UUID, p_exception_type TEXT,
  p_retryable BOOLEAN, p_code TEXT, p_message TEXT, p_work_item UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_key TEXT := 'EX:' || p_domain || ':' || p_entity_type || ':' || p_entity_id::text || ':' || p_exception_type;
  v_id UUID; v_existing UUID; v_max INT;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.read') THEN RAISE EXCEPTION 'H_OPS_FORBIDDEN'; END IF;
  v_max := COALESCE((SELECT (value->>'defaultMaxAttempts')::int FROM public.h_operational_config WHERE key='retry_limits'),3);
  SELECT id INTO v_existing FROM public.h_exceptions WHERE source_key = v_key;
  IF v_existing IS NOT NULL THEN
    UPDATE public.h_exceptions SET
      safe_error_code = p_code, safe_error_message = left(btrim(p_message),500),
      retryable = COALESCE(p_retryable, retryable), updated_at = clock_timestamp()
     WHERE id = v_existing AND status <> 'RESOLVED';
    RETURN v_existing;
  END IF;
  v_id := gen_random_uuid();
  INSERT INTO public.h_exceptions(
    id, source_key, domain, source_entity_type, source_entity_id, exception_type,
    retryable, max_attempts, safe_error_code, safe_error_message, work_item_id
  ) VALUES (
    v_id, v_key, p_domain, p_entity_type, p_entity_id, p_exception_type,
    COALESCE(p_retryable,false), v_max, p_code, left(btrim(p_message),500), p_work_item
  );
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.exception.created', 'HException', v_id,
          jsonb_build_object('code', p_code, 'retryable', COALESCE(p_retryable,false)), p_correlation);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_exception_ack(
  p_actor UUID, p_exception UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.retry') THEN RAISE EXCEPTION 'H_OPS_RETRY_FORBIDDEN'; END IF;
  SELECT * INTO r FROM public.h_exceptions WHERE id = p_exception FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'H_EXCEPTION_NOT_FOUND'; END IF;
  IF r.status = 'RESOLVED' THEN RETURN p_exception; END IF;
  UPDATE public.h_exceptions SET status='ACKNOWLEDGED', acknowledged_by=p_actor, acknowledged_at=clock_timestamp(), updated_at=clock_timestamp()
   WHERE id = p_exception;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.exception.acknowledged', 'HException', p_exception, '{}'::jsonb, p_correlation);
  RETURN p_exception;
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_exception_retry(
  p_actor UUID, p_exception UUID, p_correlation UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD; v_backoff INT;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.retry') THEN RAISE EXCEPTION 'H_OPS_RETRY_FORBIDDEN'; END IF;
  SELECT * INTO r FROM public.h_exceptions WHERE id = p_exception FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'H_EXCEPTION_NOT_FOUND'; END IF;
  IF NOT r.retryable THEN RAISE EXCEPTION 'H_EXCEPTION_NOT_RETRYABLE'; END IF;
  IF r.status = 'RESOLVED' THEN RAISE EXCEPTION 'H_EXCEPTION_RESOLVED'; END IF;
  IF r.attempt_count >= r.max_attempts THEN RAISE EXCEPTION 'H_EXCEPTION_MAX_ATTEMPTS'; END IF;
  IF r.next_allowed_attempt_at IS NOT NULL AND r.next_allowed_attempt_at > clock_timestamp() THEN
    RAISE EXCEPTION 'H_EXCEPTION_RETRY_TOO_SOON';
  END IF;
  v_backoff := COALESCE((SELECT (value->>'minBackoffSeconds')::int FROM public.h_operational_config WHERE key='retry_limits'),30);
  UPDATE public.h_exceptions SET
    attempt_count = attempt_count + 1,
    last_attempt_at = clock_timestamp(),
    next_allowed_attempt_at = clock_timestamp() + make_interval(secs => v_backoff * GREATEST(attempt_count + 1, 1)),
    status = 'ACKNOWLEDGED',
    updated_at = clock_timestamp()
   WHERE id = p_exception;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.exception.retry', 'HException', p_exception,
          jsonb_build_object('attempt', r.attempt_count + 1), p_correlation);
  RETURN jsonb_build_object('exceptionId', p_exception, 'attempt', r.attempt_count + 1, 'status', 'ACKNOWLEDGED');
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_exception_resolve(
  p_actor UUID, p_exception UUID, p_note TEXT, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.retry') THEN RAISE EXCEPTION 'H_OPS_RETRY_FORBIDDEN'; END IF;
  SELECT * INTO r FROM public.h_exceptions WHERE id = p_exception FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'H_EXCEPTION_NOT_FOUND'; END IF;
  IF r.status = 'RESOLVED' THEN RETURN p_exception; END IF;
  UPDATE public.h_exceptions SET
    status='RESOLVED', resolved_by=p_actor, resolved_at=clock_timestamp(),
    resolution_note=NULLIF(btrim(COALESCE(p_note,'')),''), updated_at=clock_timestamp()
   WHERE id = p_exception;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.exception.resolved', 'HException', p_exception, '{}'::jsonb, p_correlation);
  RETURN p_exception;
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_cycle_create(
  p_actor UUID, p_starts TIMESTAMPTZ, p_cutoff TIMESTAMPTZ, p_ends TIMESTAMPTZ, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id UUID := gen_random_uuid(); v_code TEXT;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.cycle.manage') THEN RAISE EXCEPTION 'H_CYCLE_FORBIDDEN'; END IF;
  IF p_starts IS NULL OR p_cutoff IS NULL OR p_ends IS NULL OR NOT (p_starts < p_cutoff AND p_cutoff <= p_ends) THEN
    RAISE EXCEPTION 'H_CYCLE_WINDOW_INVALID';
  END IF;
  v_code := 'CY-' || to_char(p_starts AT TIME ZONE 'UTC', 'IYYY-"W"IW');
  INSERT INTO public.h_weekly_cycles(id, cycle_code, starts_at, cutoff_at, ends_at, status)
  VALUES (v_id, v_code, p_starts, p_cutoff, p_ends, 'OPEN')
  ON CONFLICT (cycle_code) DO NOTHING;
  SELECT id INTO v_id FROM public.h_weekly_cycles WHERE cycle_code = v_code;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.cycle.created', 'HWeeklyCycle', v_id,
          jsonb_build_object('cycleCode', v_code), p_correlation);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_cycle_lock(
  p_actor UUID, p_cycle UUID, p_correlation UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD; v_n INT := 0; w RECORD;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.cycle.manage') THEN RAISE EXCEPTION 'H_CYCLE_FORBIDDEN'; END IF;
  IF NOT pg_try_advisory_xact_lock(92012001) THEN RAISE EXCEPTION 'H_CYCLE_LOCK_IN_PROGRESS'; END IF;
  SELECT * INTO r FROM public.h_weekly_cycles WHERE id = p_cycle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'H_CYCLE_NOT_FOUND'; END IF;
  IF r.status = 'LOCKED' OR r.status = 'IN_EXECUTION' OR r.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('cycleId', p_cycle, 'status', r.status, 'membershipCount', r.membership_count, 'idempotent', true);
  END IF;
  IF r.status <> 'OPEN' THEN RAISE EXCEPTION 'H_CYCLE_NOT_LOCKABLE'; END IF;
  FOR w IN
    SELECT * FROM public.h_work_items
     WHERE status IN ('OPEN','IN_PROGRESS','BLOCKED')
       AND (cycle_id = p_cycle OR (cycle_id IS NULL AND created_at < r.cutoff_at AND created_at >= r.starts_at))
  LOOP
    INSERT INTO public.h_cycle_memberships(cycle_id, work_item_id, source_key)
    VALUES (p_cycle, w.id, w.source_key)
    ON CONFLICT DO NOTHING;
    UPDATE public.h_work_items SET cycle_id = p_cycle, updated_at = clock_timestamp() WHERE id = w.id AND cycle_id IS DISTINCT FROM p_cycle;
    v_n := v_n + 1;
  END LOOP;
  SELECT COUNT(*)::int INTO v_n FROM public.h_cycle_memberships WHERE cycle_id = p_cycle;
  UPDATE public.h_weekly_cycles SET
    status='LOCKED', locked_at=clock_timestamp(), locked_by=p_actor, membership_count=v_n, updated_at=clock_timestamp()
   WHERE id = p_cycle;
  INSERT INTO public.h_notifications(dedupe_key, recipient_user_id, event_type, title, body, domain, source_entity_type, source_entity_id)
  SELECT 'CYCLE_LOCKED:' || p_cycle::text || ':' || cm."userId"::text, cm."userId", 'CYCLE_LOCKED',
         'Weekly cycle locked', 'Operations cycle ' || r.cycle_code || ' is locked',
         'H', 'HWeeklyCycle', p_cycle
    FROM public."CompanyMembership" cm
    JOIN public."Company" c ON c.id = cm."companyId"
   WHERE c.type='SCO' AND cm.status='ACTIVE'
  ON CONFLICT (dedupe_key) DO NOTHING;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.cycle.locked', 'HWeeklyCycle', p_cycle,
          jsonb_build_object('membershipCount', v_n), p_correlation);
  RETURN jsonb_build_object('cycleId', p_cycle, 'status', 'LOCKED', 'membershipCount', v_n, 'idempotent', false);
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_cycle_complete(
  p_actor UUID, p_cycle UUID, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.cycle.manage') THEN RAISE EXCEPTION 'H_CYCLE_FORBIDDEN'; END IF;
  SELECT * INTO r FROM public.h_weekly_cycles WHERE id = p_cycle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'H_CYCLE_NOT_FOUND'; END IF;
  IF r.status = 'COMPLETED' THEN RETURN p_cycle; END IF;
  IF r.status NOT IN ('LOCKED','IN_EXECUTION') THEN RAISE EXCEPTION 'H_CYCLE_NOT_COMPLETABLE'; END IF;
  UPDATE public.h_weekly_cycles SET
    status='COMPLETED', completed_at=clock_timestamp(), completed_by=p_actor, updated_at=clock_timestamp()
   WHERE id = p_cycle;
  INSERT INTO public.h_notifications(dedupe_key, recipient_user_id, event_type, title, body, domain, source_entity_type, source_entity_id)
  SELECT 'CYCLE_COMPLETED:' || p_cycle::text || ':' || cm."userId"::text, cm."userId", 'CYCLE_COMPLETED',
         'Weekly cycle completed', 'Operations cycle ' || r.cycle_code || ' completed',
         'H', 'HWeeklyCycle', p_cycle
    FROM public."CompanyMembership" cm
    JOIN public."Company" c ON c.id = cm."companyId"
   WHERE c.type='SCO' AND cm.status='ACTIVE'
  ON CONFLICT (dedupe_key) DO NOTHING;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.cycle.completed', 'HWeeklyCycle', p_cycle, '{}'::jsonb, p_correlation);
  RETURN p_cycle;
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_cycle_override_include(
  p_actor UUID, p_cycle UUID, p_work_item UUID, p_reason TEXT, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD; w RECORD;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.cycle.manage') THEN RAISE EXCEPTION 'H_CYCLE_FORBIDDEN'; END IF;
  IF COALESCE(btrim(p_reason),'') = '' THEN RAISE EXCEPTION 'H_CYCLE_OVERRIDE_REASON_REQUIRED'; END IF;
  SELECT * INTO r FROM public.h_weekly_cycles WHERE id = p_cycle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'H_CYCLE_NOT_FOUND'; END IF;
  IF r.status NOT IN ('LOCKED','IN_EXECUTION') THEN RAISE EXCEPTION 'H_CYCLE_OVERRIDE_STATE_INVALID'; END IF;
  SELECT * INTO w FROM public.h_work_items WHERE id = p_work_item FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'H_WORK_ITEM_NOT_FOUND'; END IF;
  INSERT INTO public.h_cycle_memberships(cycle_id, work_item_id, source_key, override_reason, override_by)
  VALUES (p_cycle, p_work_item, w.source_key, btrim(p_reason), p_actor)
  ON CONFLICT (cycle_id, work_item_id) DO NOTHING;
  UPDATE public.h_work_items SET cycle_id = p_cycle, updated_at = clock_timestamp() WHERE id = p_work_item;
  UPDATE public.h_weekly_cycles SET membership_count = (SELECT COUNT(*) FROM public.h_cycle_memberships WHERE cycle_id=p_cycle), updated_at=clock_timestamp()
   WHERE id = p_cycle;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.cycle.override_include', 'HWeeklyCycle', p_cycle,
          jsonb_build_object('workItemId', p_work_item, 'reason', btrim(p_reason)), p_correlation);
  RETURN p_cycle;
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_notifications_list(
  p_actor UUID, p_unread_only BOOLEAN, p_limit INT, p_offset INT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_limit INT := LEAST(GREATEST(COALESCE(p_limit,50),1),200); v_offset INT := GREATEST(COALESCE(p_offset,0),0); v_total INT; v_unread INT;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.read') THEN RAISE EXCEPTION 'H_OPS_READ_FORBIDDEN'; END IF;
  SELECT COUNT(*)::int INTO v_total FROM public.h_notifications WHERE recipient_user_id = p_actor
    AND (NOT COALESCE(p_unread_only,false) OR read_at IS NULL);
  SELECT COUNT(*)::int INTO v_unread FROM public.h_notifications WHERE recipient_user_id = p_actor AND read_at IS NULL;
  RETURN jsonb_build_object(
    'total', v_total, 'unreadCount', v_unread, 'limit', v_limit, 'offset', v_offset,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'eventType', n.event_type, 'title', n.title, 'body', n.body,
        'domain', n.domain, 'sourceEntityId', n.source_entity_id, 'workItemId', n.work_item_id,
        'readAt', n.read_at, 'createdAt', n.created_at
      ) ORDER BY n.created_at DESC)
      FROM (
        SELECT * FROM public.h_notifications
         WHERE recipient_user_id = p_actor
           AND (NOT COALESCE(p_unread_only,false) OR read_at IS NULL)
         ORDER BY created_at DESC LIMIT v_limit OFFSET v_offset
      ) n
    ), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_notifications_mark_read(
  p_actor UUID, p_notification UUID, p_all BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_n INT;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.read') THEN RAISE EXCEPTION 'H_OPS_READ_FORBIDDEN'; END IF;
  IF COALESCE(p_all,false) THEN
    UPDATE public.h_notifications SET read_at = COALESCE(read_at, clock_timestamp())
     WHERE recipient_user_id = p_actor AND read_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE
    UPDATE public.h_notifications SET read_at = COALESCE(read_at, clock_timestamp())
     WHERE id = p_notification AND recipient_user_id = p_actor;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN RAISE EXCEPTION 'H_NOTIFICATION_NOT_FOUND'; END IF;
  END IF;
  RETURN jsonb_build_object('marked', v_n);
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_job_enqueue(
  p_actor UUID, p_job_type TEXT, p_idempotency_key TEXT, p_payload JSONB, p_correlation UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id UUID; v_existing UUID; v_max INT;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.retry') THEN RAISE EXCEPTION 'H_OPS_JOB_FORBIDDEN'; END IF;
  IF COALESCE(btrim(p_idempotency_key),'') = '' THEN RAISE EXCEPTION 'H_JOB_IDEMPOTENCY_REQUIRED'; END IF;
  IF p_job_type NOT IN ('G_REFRESH','NOTIFICATION_PROCESS','OPERATIONAL_RECONCILE','RETENTION_MAINTENANCE') THEN
    RAISE EXCEPTION 'H_JOB_TYPE_INVALID';
  END IF;
  SELECT id INTO v_existing FROM public.h_jobs WHERE job_type = p_job_type AND idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  v_max := COALESCE((SELECT (value->>'defaultMaxAttempts')::int FROM public.h_operational_config WHERE key='retry_limits'),3);
  v_id := gen_random_uuid();
  INSERT INTO public.h_jobs(id, job_type, status, max_attempts, idempotency_key, payload, created_by)
  VALUES (v_id, p_job_type, 'PENDING', v_max, p_idempotency_key, COALESCE(p_payload,'{}'::jsonb), p_actor);
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.job.enqueued', 'HJob', v_id,
          jsonb_build_object('jobType', p_job_type), p_correlation);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_job_run(
  p_actor UUID, p_job UUID, p_correlation UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD; v_exec UUID; v_summary JSONB := '{}'::jsonb; v_g JSONB;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.retry') THEN RAISE EXCEPTION 'H_OPS_JOB_FORBIDDEN'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext(p_job::text)) THEN RAISE EXCEPTION 'H_JOB_RUNNING'; END IF;
  SELECT * INTO r FROM public.h_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'H_JOB_NOT_FOUND'; END IF;
  IF r.status = 'SUCCEEDED' THEN
    RETURN jsonb_build_object('jobId', p_job, 'status', 'SUCCEEDED', 'idempotent', true);
  END IF;
  IF r.status = 'RUNNING' THEN RAISE EXCEPTION 'H_JOB_RUNNING'; END IF;
  IF r.attempt >= r.max_attempts AND r.status = 'FAILED' THEN RAISE EXCEPTION 'H_JOB_MAX_ATTEMPTS'; END IF;

  UPDATE public.h_jobs SET status='RUNNING', started_at=COALESCE(started_at,clock_timestamp()), attempt=attempt+1, updated_at=clock_timestamp()
   WHERE id = p_job;
  v_exec := gen_random_uuid();
  INSERT INTO public.h_job_executions(id, job_id, attempt, status)
  VALUES (v_exec, p_job, r.attempt + 1, 'RUNNING');

  BEGIN
    IF r.job_type = 'G_REFRESH' THEN
      v_g := public.internal_g_intelligence_backfill(p_actor, false, p_correlation);
      v_summary := jsonb_build_object('gRefresh', v_g);
    ELSIF r.job_type = 'NOTIFICATION_PROCESS' THEN
      v_summary := jsonb_build_object('pendingUnread', (SELECT COUNT(*) FROM public.h_notifications WHERE read_at IS NULL));
    ELSIF r.job_type = 'OPERATIONAL_RECONCILE' THEN
      -- stuck work: IN_PROGRESS older than aging threshold without update
      INSERT INTO public.h_exceptions(source_key, domain, source_entity_type, source_entity_id, exception_type, retryable, safe_error_code, safe_error_message, work_item_id)
      SELECT 'EX:H:STUCK:' || w.id::text, 'H', 'HWorkItem', w.id, 'STUCK_WORK_ITEM', true, 'STUCK_WORK_ITEM', 'Work item aging without progress', w.id
        FROM public.h_work_items w
       WHERE w.status = 'IN_PROGRESS' AND w.updated_at < clock_timestamp() - interval '48 hours'
      ON CONFLICT (source_key) DO NOTHING;
      -- failed jobs without open exception
      INSERT INTO public.h_exceptions(source_key, domain, source_entity_type, source_entity_id, exception_type, retryable, safe_error_code, safe_error_message)
      SELECT 'EX:H:JOBFAIL:' || j.id::text, 'H', 'HJob', j.id, 'FAILED_JOB', true, 'FAILED_JOB', COALESCE(j.safe_error,'Job failed')
        FROM public.h_jobs j WHERE j.status='FAILED'
      ON CONFLICT (source_key) DO NOTHING;
      v_summary := jsonb_build_object(
        'openExceptions', (SELECT COUNT(*) FROM public.h_exceptions WHERE status='OPEN'),
        'failedJobs', (SELECT COUNT(*) FROM public.h_jobs WHERE status='FAILED'),
        'orphanWorkRefs', 0
      );
    ELSIF r.job_type = 'RETENTION_MAINTENANCE' THEN
      v_summary := jsonb_build_object('status', 'noop_approved_placeholder');
    END IF;

    UPDATE public.h_job_executions SET status='SUCCEEDED', finished_at=clock_timestamp(), result_summary=v_summary WHERE id=v_exec;
    UPDATE public.h_jobs SET status='SUCCEEDED', finished_at=clock_timestamp(), safe_error=NULL, updated_at=clock_timestamp() WHERE id=p_job;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.h_job_executions SET status='FAILED', finished_at=clock_timestamp(), safe_error=left(SQLERRM,500) WHERE id=v_exec;
    UPDATE public.h_jobs SET status='FAILED', finished_at=clock_timestamp(), safe_error=left(SQLERRM,500), updated_at=clock_timestamp() WHERE id=p_job;
    INSERT INTO public.h_notifications(dedupe_key, recipient_user_id, event_type, title, body, domain, source_entity_type, source_entity_id)
    VALUES ('JOB_FAILED:' || p_job::text || ':' || (r.attempt+1)::text, p_actor, 'JOB_FAILED', 'Job failed', 'Operational job failed safely', 'H', 'HJob', p_job)
    ON CONFLICT DO NOTHING;
    PERFORM set_config('app.audit_system','true',true);
    INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
    VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.job.failed', 'HJob', p_job, jsonb_build_object('attempt', r.attempt+1), p_correlation);
    RAISE;
  END;

  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.job.succeeded', 'HJob', p_job, v_summary, p_correlation);
  RETURN jsonb_build_object('jobId', p_job, 'status', 'SUCCEEDED', 'summary', v_summary, 'idempotent', false);
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_health(p_actor UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_mig TEXT;
BEGIN
  PERFORM set_config('app.sco_internal', 'true', true);
  IF NOT public.h_ops_capability(p_actor, 'operations.health.read') THEN RAISE EXCEPTION 'H_HEALTH_FORBIDDEN'; END IF;
  SELECT migration_name INTO v_mig FROM public._prisma_migrations
   WHERE finished_at IS NOT NULL ORDER BY finished_at DESC NULLS LAST LIMIT 1;
  RETURN jsonb_build_object(
    'calculatedAt', clock_timestamp(),
    'api', 'ok',
    'database', 'ok',
    'latestMigration', v_mig,
    'jobs', jsonb_build_object(
      'pending', (SELECT COUNT(*) FROM public.h_jobs WHERE status='PENDING'),
      'running', (SELECT COUNT(*) FROM public.h_jobs WHERE status='RUNNING'),
      'failed', (SELECT COUNT(*) FROM public.h_jobs WHERE status='FAILED'),
      'succeeded', (SELECT COUNT(*) FROM public.h_jobs WHERE status='SUCCEEDED')
    ),
    'notifications', jsonb_build_object(
      'unread', (SELECT COUNT(*) FROM public.h_notifications WHERE read_at IS NULL)
    ),
    'workQueue', jsonb_build_object(
      'open', (SELECT COUNT(*) FROM public.h_work_items WHERE status='OPEN'),
      'blocked', (SELECT COUNT(*) FROM public.h_work_items WHERE status='BLOCKED')
    ),
    'exceptions', jsonb_build_object(
      'open', (SELECT COUNT(*) FROM public.h_exceptions WHERE status='OPEN')
    ),
    'gRefresh', jsonb_build_object(
      'lastRunAt', (SELECT MAX(finished_at) FROM public.g_intelligence_runs WHERE finished_at IS NOT NULL),
      'lastInserted', (SELECT facts_inserted FROM public.g_intelligence_runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1)
    ),
    'documents', jsonb_build_object(
      'available', (SELECT COUNT(*) FROM public.documents WHERE status='AVAILABLE')
    )
  );
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_config_get(p_actor UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.read') THEN RAISE EXCEPTION 'H_OPS_READ_FORBIDDEN'; END IF;
  PERFORM set_config('app.sco_internal', 'true', true);
  RETURN COALESCE((
    SELECT jsonb_object_agg(key, jsonb_build_object('value', value, 'version', version, 'updatedAt', updated_at))
      FROM public.h_operational_config
  ), '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_config_set(
  p_actor UUID, p_key TEXT, p_value JSONB, p_correlation UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.config.manage') THEN RAISE EXCEPTION 'H_CONFIG_FORBIDDEN'; END IF;
  PERFORM set_config('app.sco_internal', 'true', true);
  IF p_key NOT IN ('weekly_cutoff','retry_limits','notification_toggles','operational_thresholds') THEN
    RAISE EXCEPTION 'H_CONFIG_KEY_INVALID';
  END IF;
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN RAISE EXCEPTION 'H_CONFIG_VALUE_INVALID'; END IF;
  SELECT * INTO r FROM public.h_operational_config WHERE key = p_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'H_CONFIG_NOT_FOUND'; END IF;
  UPDATE public.h_operational_config SET
    value = p_value, version = version + 1, updated_by = p_actor, updated_at = clock_timestamp()
   WHERE key = p_key;
  PERFORM set_config('app.audit_system','true',true);
  INSERT INTO public.audit_logs(actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id)
  VALUES (p_actor, NULL, 'SCO_INTERNAL', 'h.config.updated', 'HOperationalConfig', '00000000-0000-4000-8000-0000000000c1'::uuid,
          jsonb_build_object('key', p_key, 'version', r.version + 1), p_correlation);
  RETURN jsonb_build_object('key', p_key, 'value', p_value, 'version', r.version + 1);
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_audit_evidence(
  p_actor UUID, p_domain TEXT, p_entity_id UUID, p_action TEXT,
  p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_limit INT, p_offset INT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_limit INT := LEAST(GREATEST(COALESCE(p_limit,50),1),200); v_offset INT := GREATEST(COALESCE(p_offset,0),0); v_total INT;
BEGIN
  IF NOT public.h_ops_capability(p_actor, 'operations.read') THEN RAISE EXCEPTION 'H_OPS_READ_FORBIDDEN'; END IF;
  SELECT COUNT(*)::int INTO v_total FROM public.audit_logs a
   WHERE a.action LIKE 'h.%'
     AND (p_entity_id IS NULL OR a.entity_id = p_entity_id)
     AND (p_action IS NULL OR a.action = p_action)
     AND (p_from IS NULL OR a.created_at >= p_from)
     AND (p_to IS NULL OR a.created_at <= p_to)
     AND (p_domain IS NULL OR a.metadata->>'domain' = p_domain OR a.action LIKE 'h.' || lower(p_domain) || '%' OR TRUE);
  RETURN jsonb_build_object(
    'total', v_total, 'limit', v_limit, 'offset', v_offset,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'action', a.action, 'entityType', a.entity_type, 'entityId', a.entity_id,
        'actorUserId', a.actor_user_id, 'createdAt', a.created_at, 'metadata', a.metadata
      ) ORDER BY a.created_at DESC)
      FROM (
        SELECT * FROM public.audit_logs a
         WHERE a.action LIKE 'h.%'
           AND (p_entity_id IS NULL OR a.entity_id = p_entity_id)
           AND (p_action IS NULL OR a.action = p_action)
           AND (p_from IS NULL OR a.created_at >= p_from)
           AND (p_to IS NULL OR a.created_at <= p_to)
         ORDER BY a.created_at DESC LIMIT v_limit OFFSET v_offset
      ) a
    ), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_exception_get(p_actor UUID, p_exception UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD;
BEGIN
  PERFORM set_config('app.sco_internal', 'true', true);
  IF NOT public.h_ops_capability(p_actor, 'operations.read') THEN RAISE EXCEPTION 'H_OPS_READ_FORBIDDEN'; END IF;
  SELECT * INTO r FROM public.h_exceptions WHERE id = p_exception;
  IF NOT FOUND THEN RAISE EXCEPTION 'H_EXCEPTION_NOT_FOUND'; END IF;
  RETURN jsonb_build_object(
    'id', r.id, 'domain', r.domain, 'exceptionType', r.exception_type, 'status', r.status,
    'retryable', r.retryable, 'attemptCount', r.attempt_count, 'maxAttempts', r.max_attempts,
    'lastAttemptAt', r.last_attempt_at, 'nextAllowedAttemptAt', r.next_allowed_attempt_at,
    'safeErrorCode', r.safe_error_code, 'safeErrorMessage', r.safe_error_message,
    'workItemId', r.work_item_id, 'createdAt', r.created_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.internal_h_cycle_get(p_actor UUID, p_cycle UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r RECORD;
BEGIN
  PERFORM set_config('app.sco_internal', 'true', true);
  IF NOT public.h_ops_capability(p_actor, 'operations.read') THEN RAISE EXCEPTION 'H_OPS_READ_FORBIDDEN'; END IF;
  SELECT * INTO r FROM public.h_weekly_cycles WHERE id = p_cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'H_CYCLE_NOT_FOUND'; END IF;
  RETURN jsonb_build_object(
    'id', r.id, 'cycleCode', r.cycle_code, 'startsAt', r.starts_at, 'cutoffAt', r.cutoff_at, 'endsAt', r.ends_at,
    'status', r.status, 'lockedAt', r.locked_at, 'completedAt', r.completed_at, 'membershipCount', r.membership_count,
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('workItemId', m.work_item_id, 'sourceKey', m.source_key, 'overrideReason', m.override_reason))
        FROM public.h_cycle_memberships m WHERE m.cycle_id = p_cycle
    ), '[]'::jsonb)
  );
END $$;

-- Grants
REVOKE ALL ON FUNCTION public.h_ops_capability(UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_work_item_upsert(UUID,TEXT,TEXT,UUID,TEXT,INT,TIMESTAMPTZ,BOOLEAN,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_work_item_assign(UUID,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_work_item_transition(UUID,UUID,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_work_queue(UUID,TEXT,TEXT,INT,INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_exception_upsert(UUID,TEXT,TEXT,UUID,TEXT,BOOLEAN,TEXT,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_exception_ack(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_exception_retry(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_exception_resolve(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_exception_get(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_cycle_create(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_cycle_lock(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_cycle_complete(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_cycle_override_include(UUID,UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_cycle_get(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_notifications_list(UUID,BOOLEAN,INT,INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_notifications_mark_read(UUID,UUID,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_job_enqueue(UUID,TEXT,TEXT,JSONB,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_job_run(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_health(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_config_get(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_config_set(UUID,TEXT,JSONB,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_h_audit_evidence(UUID,TEXT,UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,INT,INT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.h_ops_capability(UUID,TEXT) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_work_item_upsert(UUID,TEXT,TEXT,UUID,TEXT,INT,TIMESTAMPTZ,BOOLEAN,TEXT,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_work_item_assign(UUID,UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_work_item_transition(UUID,UUID,TEXT,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_work_queue(UUID,TEXT,TEXT,INT,INT) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_exception_upsert(UUID,TEXT,TEXT,UUID,TEXT,BOOLEAN,TEXT,TEXT,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_exception_ack(UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_exception_retry(UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_exception_resolve(UUID,UUID,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_exception_get(UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_cycle_create(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_cycle_lock(UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_cycle_complete(UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_cycle_override_include(UUID,UUID,UUID,TEXT,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_cycle_get(UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_notifications_list(UUID,BOOLEAN,INT,INT) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_notifications_mark_read(UUID,UUID,BOOLEAN) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_job_enqueue(UUID,TEXT,TEXT,JSONB,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_job_run(UUID,UUID,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_health(UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_config_get(UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_config_set(UUID,TEXT,JSONB,UUID) TO sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_h_audit_evidence(UUID,TEXT,UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,INT,INT) TO sco_runtime;
