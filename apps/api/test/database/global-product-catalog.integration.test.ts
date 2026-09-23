import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const category = '60000000-0000-4000-8000-000000000001';
const unit = '60000000-0000-4000-8000-000000000002';
const user = '60000000-0000-4000-8000-000000000010';

describe('Stage 003 Global Product Catalog', () => {
  beforeAll(async () => {
    await owner.query('DELETE FROM product_identities WHERE category_id = $1', [category]);
    await owner.query('DELETE FROM category_attribute_definitions WHERE category_id = $1', [category]);
    await owner.query('DELETE FROM product_categories WHERE id = $1', [category]);
    await owner.query('DELETE FROM unit_definitions WHERE id = $1', [unit]);
    await owner.query(`INSERT INTO "User" (id,email,"passwordHash") VALUES ($1,'catalog-test@sco.test','test') ON CONFLICT DO NOTHING`, [user]);
    await owner.query(`INSERT INTO product_categories (id,code,name) VALUES ($1,'catalog-test','Catalog Test')`, [category]);
    await owner.query(`INSERT INTO unit_definitions (id,code,name,dimension) VALUES ($1,'EA','Each','count')`, [unit]);
  });
  afterAll(async () => { await owner.query('DELETE FROM product_identities WHERE category_id = $1', [category]); await owner.query('DELETE FROM category_attribute_definitions WHERE category_id = $1', [category]); await owner.query('DELETE FROM product_categories WHERE id = $1', [category]); await owner.query('DELETE FROM unit_definitions WHERE id = $1', [unit]); await owner.query('DELETE FROM "User" WHERE id = $1', [user]); await owner.end(); await runtime.end(); });

  it('keeps global catalog writes behind SCO internal context', async () => {
    const client = await runtime.connect();
    try { await client.query('BEGIN'); await expect(client.query(`INSERT INTO product_categories (code,name) VALUES ('blocked-catalog','Blocked')`)).rejects.toBeTruthy(); await client.query('ROLLBACK'); } finally { client.release(); }
  });

  it('supports category-specific attributes and prevents duplicate keys', async () => {
    const client = await runtime.connect();
    try { await client.query('BEGIN'); await client.query("SELECT set_config('app.sco_internal','true',true)"); await client.query(`INSERT INTO category_attribute_definitions (category_id,key,display_name,data_type,required) VALUES ($1,'capacity','Capacity','NUMBER',true)`, [category]); await expect(client.query(`INSERT INTO category_attribute_definitions (category_id,key,display_name,data_type) VALUES ($1,'capacity','Duplicate','TEXT')`, [category])).rejects.toBeTruthy(); await client.query('ROLLBACK'); } finally { client.release(); }
  });

  it('provides SAR as the base currency and keeps brands/models distinct', async () => {
    const sar = await owner.query(`SELECT code,is_base FROM currency_definitions WHERE code='SAR'`);
    expect(sar.rows).toEqual([{ code: 'SAR', is_base: true }]);
    const client = await runtime.connect();
    try { await client.query('BEGIN'); await client.query("SELECT set_config('app.sco_internal','true',true)"); const a = await client.query(`INSERT INTO product_identities (category_id,brand,manufacturer,model_reference,unit_id,created_by) VALUES ($1,'Gree','Gree','20TR',$2,$3) RETURNING id`, [category, unit, user]); const b = await client.query(`INSERT INTO product_identities (category_id,brand,manufacturer,model_reference,unit_id,created_by) VALUES ($1,'Fuji','Fuji','20TR',$2,$3) RETURNING id`, [category, unit, user]); expect(a.rows[0].id).not.toBe(b.rows[0].id); await client.query('ROLLBACK'); } finally { client.release(); }
  });

  it('prevents silent mutation of identity-defining fields after activation', async () => {
    const client = await runtime.connect();
    try { await client.query('BEGIN'); await client.query("SELECT set_config('app.sco_internal','true',true)"); const created = await client.query(`INSERT INTO product_identities (category_id,brand,manufacturer,model_reference,unit_id,created_by) VALUES ($1,'Jotun','Jotun','A',$2,$3) RETURNING id`, [category, unit, user]); await client.query(`UPDATE product_identities SET status='ACTIVE' WHERE id=$1`, [created.rows[0].id]); await expect(client.query(`UPDATE product_identities SET brand='Other' WHERE id=$1`, [created.rows[0].id])).rejects.toBeTruthy(); await client.query('ROLLBACK'); } finally { client.release(); }
  });
});
