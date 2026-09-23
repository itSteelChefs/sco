ALTER TABLE alternative_product_proposals ADD COLUMN IF NOT EXISTS manufacturer TEXT, ADD COLUMN IF NOT EXISTS brand TEXT, ADD COLUMN IF NOT EXISTS model TEXT;
INSERT INTO "Permission" (id,code,description) VALUES (gen_random_uuid(),'alternative_product.review','Review alternative product proposals') ON CONFLICT(code) DO NOTHING;
