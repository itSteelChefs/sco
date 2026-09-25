CREATE TYPE "BuyingPowerHorizon" AS ENUM ('WEEKLY_IMMEDIATE','ROLLING_PLANNED');
CREATE TYPE "BuyingPowerRunStatus" AS ENUM ('STARTED','PUBLISHED','FAILED');
CREATE TYPE "BuyingPowerConversionSourceType" AS ENUM ('NEED','EXECUTION_ITEM','EXTERNAL');

CREATE TABLE commitment_demand_conversion_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_line_id UUID NOT NULL REFERENCES commercial_commitment_lines(id) ON DELETE RESTRICT,
  source_type "BuyingPowerConversionSourceType" NOT NULL,
  source_id UUID,
  source_company_id UUID NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
  converted_quantity NUMERIC(18,4) NOT NULL CHECK(converted_quantity>0),
  unit_id UUID NOT NULL REFERENCES unit_definitions(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((source_type='EXTERNAL' AND source_id IS NULL) OR (source_type IN ('NEED','EXECUTION_ITEM') AND source_id IS NOT NULL))
);
CREATE INDEX commitment_conversion_line_idx ON commitment_demand_conversion_allocations(commitment_line_id);
CREATE INDEX commitment_conversion_source_idx ON commitment_demand_conversion_allocations(source_type,source_id) WHERE source_id IS NOT NULL;

CREATE TABLE buying_power_aggregation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiated_by UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  horizon "BuyingPowerHorizon" NOT NULL,
  time_bucket DATE NOT NULL,
  request_key TEXT NOT NULL CHECK(btrim(request_key)<>''),
  source_fingerprint TEXT NOT NULL CHECK(btrim(source_fingerprint)<>''),
  cutoff_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status "BuyingPowerRunStatus" NOT NULL DEFAULT 'STARTED',
  correlation_id UUID,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(horizon,time_bucket,request_key)
);

CREATE TABLE buying_power_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregation_run_id UUID NOT NULL UNIQUE REFERENCES buying_power_aggregation_runs(id) ON DELETE RESTRICT,
  horizon "BuyingPowerHorizon" NOT NULL,
  time_bucket DATE NOT NULL,
  cutoff_at TIMESTAMPTZ NOT NULL,
  source_fingerprint TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE buying_power_snapshot_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES buying_power_snapshots(id) ON DELETE RESTRICT,
  product_identity_id UUID NOT NULL REFERENCES product_identities(id) ON DELETE RESTRICT,
  unit_id UUID NOT NULL REFERENCES unit_definitions(id) ON DELETE RESTRICT,
  committed_quantity NUMERIC(18,4),
  potential_quantity NUMERIC(18,4),
  qualified_quantity NUMERIC(18,4),
  open_quantity NUMERIC(18,4),
  released_quantity NUMERIC(18,4),
  procured_quantity NUMERIC(18,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(committed_quantity IS NULL OR committed_quantity>=0),
  CHECK(potential_quantity IS NULL OR potential_quantity>=0),
  CHECK(qualified_quantity IS NULL OR qualified_quantity>=0),
  CHECK(open_quantity IS NULL OR open_quantity>=0),
  CHECK(released_quantity IS NULL OR released_quantity>=0),
  CHECK(procured_quantity IS NULL OR procured_quantity>=0),
  UNIQUE(snapshot_id,product_identity_id,unit_id)
);

CREATE TABLE buying_power_snapshot_source_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_line_id UUID NOT NULL REFERENCES buying_power_snapshot_lines(id) ON DELETE RESTRICT,
  snapshot_id UUID NOT NULL REFERENCES buying_power_snapshots(id) ON DELETE RESTRICT,
  source_type "BuyingPowerConversionSourceType" NOT NULL,
  source_record_id UUID,
  source_company_id UUID NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
  contribution_class TEXT NOT NULL CHECK(contribution_class IN ('LINKED_COMMITMENT','EXTERNAL_COMMITMENT')),
  contribution_quantity NUMERIC(18,4) NOT NULL CHECK(contribution_quantity>0),
  unit_id UUID NOT NULL REFERENCES unit_definitions(id) ON DELETE RESTRICT,
  source_reference JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((source_type='EXTERNAL' AND source_record_id IS NULL) OR (source_type IN ('NEED','EXECUTION_ITEM') AND source_record_id IS NOT NULL)),
  UNIQUE(snapshot_id,source_type,source_record_id,source_company_id,contribution_class,contribution_quantity)
);
CREATE INDEX buying_power_membership_snapshot_idx ON buying_power_snapshot_source_memberships(snapshot_id);
CREATE INDEX buying_power_lines_snapshot_idx ON buying_power_snapshot_lines(snapshot_id);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['commitment_demand_conversion_allocations','buying_power_aggregation_runs','buying_power_snapshots','buying_power_snapshot_lines','buying_power_snapshot_source_memberships'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM sco_runtime,sco_internal_executor',t);
  END LOOP;
END $$;

CREATE FUNCTION public.prevent_buying_power_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR COALESCE(current_setting('app.buying_power_gateway',true),'')<>'true' THEN
    RAISE EXCEPTION 'BUYING_POWER_HISTORY_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER buying_power_snapshots_immutable BEFORE UPDATE OR DELETE ON buying_power_snapshots FOR EACH ROW EXECUTE FUNCTION public.prevent_buying_power_history_mutation();
CREATE TRIGGER buying_power_snapshot_lines_immutable BEFORE UPDATE OR DELETE ON buying_power_snapshot_lines FOR EACH ROW EXECUTE FUNCTION public.prevent_buying_power_history_mutation();
CREATE TRIGGER buying_power_memberships_immutable BEFORE UPDATE OR DELETE ON buying_power_snapshot_source_memberships FOR EACH ROW EXECUTE FUNCTION public.prevent_buying_power_history_mutation();
