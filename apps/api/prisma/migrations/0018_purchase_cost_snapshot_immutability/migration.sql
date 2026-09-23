CREATE OR REPLACE FUNCTION prevent_approved_purchase_cost_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'APPROVED_PURCHASE_COST_SNAPSHOT_IMMUTABLE'; END $$;
CREATE TRIGGER approved_purchase_cost_snapshot_immutable BEFORE UPDATE OR DELETE ON approved_purchase_cost_snapshots FOR EACH ROW EXECUTE FUNCTION prevent_approved_purchase_cost_snapshot_mutation();
