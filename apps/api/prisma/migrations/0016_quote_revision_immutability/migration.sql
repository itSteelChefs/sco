CREATE OR REPLACE FUNCTION prevent_supplier_quote_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SUPPLIER_QUOTE_REVISION_IMMUTABLE'; END $$;
CREATE TRIGGER supplier_quote_revision_immutable BEFORE UPDATE OR DELETE ON supplier_quote_revisions FOR EACH ROW EXECUTE FUNCTION prevent_supplier_quote_revision_mutation();
CREATE OR REPLACE FUNCTION prevent_supplier_quote_item_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SUPPLIER_QUOTE_ITEM_IMMUTABLE'; END $$;
CREATE TRIGGER supplier_quote_item_immutable BEFORE UPDATE OR DELETE ON supplier_quote_items FOR EACH ROW EXECUTE FUNCTION prevent_supplier_quote_item_mutation();
