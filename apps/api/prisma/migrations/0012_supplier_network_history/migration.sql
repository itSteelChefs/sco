CREATE TABLE supplier_network_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  actor_user_id UUID REFERENCES "User"(id),
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON supplier_network_history TO sco_runtime;
ALTER TABLE supplier_network_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_network_history FORCE ROW LEVEL SECURITY;
CREATE POLICY supplier_network_history_internal ON supplier_network_history FOR ALL TO sco_runtime
  USING (current_setting('app.sco_internal', true) = 'true')
  WITH CHECK (current_setting('app.sco_internal', true) = 'true');

INSERT INTO "Permission" (id, code, description)
VALUES
  (gen_random_uuid(), 'supplier.read', 'View supplier network eligibility projections'),
  (gen_random_uuid(), 'supplier.qualify', 'Manage supplier qualification decisions'),
  (gen_random_uuid(), 'supplier.manage_categories', 'Manage supplier category capabilities'),
  (gen_random_uuid(), 'purchase_source.read', 'View purchase source projections'),
  (gen_random_uuid(), 'purchase_source.create', 'Create purchase sources'),
  (gen_random_uuid(), 'purchase_source.update', 'Update purchase sources'),
  (gen_random_uuid(), 'purchase_source.activate', 'Activate purchase sources'),
  (gen_random_uuid(), 'purchase_source.suspend', 'Suspend purchase sources'),
  (gen_random_uuid(), 'purchase_source.manage_contacts', 'Manage purchase source contacts')
ON CONFLICT (code) DO NOTHING;
