CREATE TYPE "CatalogAttributeType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'ENUM');
CREATE TYPE "ProductIdentityStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

CREATE TABLE product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), parent_id UUID REFERENCES product_categories(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE category_attribute_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), category_id UUID NOT NULL REFERENCES product_categories(id) ON DELETE RESTRICT,
  key TEXT NOT NULL, display_name TEXT NOT NULL, data_type "CatalogAttributeType" NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false, unit_applicability JSONB, validation_metadata JSONB,
  sort_order INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(category_id, key)
);
CREATE TABLE unit_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, dimension TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE currency_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, is_base BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX currency_single_base_idx ON currency_definitions(is_base) WHERE is_base;
CREATE TABLE product_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), category_id UUID NOT NULL REFERENCES product_categories(id) ON DELETE RESTRICT,
  brand TEXT, manufacturer TEXT, model_reference TEXT, public_specification JSONB, unit_id UUID REFERENCES unit_definitions(id) ON DELETE RESTRICT,
  warranty_type TEXT, warranty_period_months INTEGER, warranty_provider TEXT,
  status "ProductIdentityStatus" NOT NULL DEFAULT 'DRAFT', version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT, activated_by UUID REFERENCES "User"(id) ON DELETE RESTRICT,
  activated_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_identities_category_status_idx ON product_identities(category_id, status);
CREATE TABLE product_attribute_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_identity_id UUID NOT NULL REFERENCES product_identities(id) ON DELETE RESTRICT,
  attribute_definition_id UUID NOT NULL REFERENCES category_attribute_definitions(id) ON DELETE RESTRICT,
  value JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(product_identity_id, attribute_definition_id)
);

GRANT SELECT ON product_categories, category_attribute_definitions, unit_definitions, currency_definitions, product_identities, product_attribute_values TO sco_runtime;
GRANT INSERT, UPDATE, DELETE ON product_categories, category_attribute_definitions, unit_definitions, currency_definitions, product_identities, product_attribute_values TO sco_runtime;
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY; ALTER TABLE product_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE category_attribute_definitions ENABLE ROW LEVEL SECURITY; ALTER TABLE category_attribute_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE unit_definitions ENABLE ROW LEVEL SECURITY; ALTER TABLE unit_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE currency_definitions ENABLE ROW LEVEL SECURITY; ALTER TABLE currency_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE product_identities ENABLE ROW LEVEL SECURITY; ALTER TABLE product_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE product_attribute_values ENABLE ROW LEVEL SECURITY; ALTER TABLE product_attribute_values FORCE ROW LEVEL SECURITY;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['product_categories','category_attribute_definitions','unit_definitions','currency_definitions','product_identities','product_attribute_values'] LOOP
    EXECUTE format('CREATE POLICY %I_read ON %I FOR SELECT TO sco_runtime USING (true)', t, t);
    EXECUTE format('CREATE POLICY %I_write ON %I FOR INSERT TO sco_runtime WITH CHECK (current_setting(''app.sco_internal'', true) = ''true'')', t, t);
    EXECUTE format('CREATE POLICY %I_update ON %I FOR UPDATE TO sco_runtime USING (current_setting(''app.sco_internal'', true) = ''true'') WITH CHECK (current_setting(''app.sco_internal'', true) = ''true'')', t, t);
    EXECUTE format('CREATE POLICY %I_delete ON %I FOR DELETE TO sco_runtime USING (current_setting(''app.sco_internal'', true) = ''true'')', t, t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION prevent_active_product_identity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'ACTIVE' AND (NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.brand IS DISTINCT FROM OLD.brand OR NEW.manufacturer IS DISTINCT FROM OLD.manufacturer OR NEW.model_reference IS DISTINCT FROM OLD.model_reference OR NEW.public_specification IS DISTINCT FROM OLD.public_specification OR NEW.unit_id IS DISTINCT FROM OLD.unit_id) THEN
    RAISE EXCEPTION 'ACTIVE_PRODUCT_IDENTITY_REQUIRES_NEW_VERSION';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_identity_active_guard BEFORE UPDATE ON product_identities FOR EACH ROW EXECUTE FUNCTION prevent_active_product_identity_mutation();

INSERT INTO currency_definitions (code, name, is_base) VALUES ('SAR', 'Saudi Riyal', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO "Permission" (code, description) VALUES ('catalog.read', 'Read approved global catalog'), ('catalog.manage', 'Manage global catalog'), ('catalog.approve', 'Activate global product identity') ON CONFLICT (code) DO NOTHING;
