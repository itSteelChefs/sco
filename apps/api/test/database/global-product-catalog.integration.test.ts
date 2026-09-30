import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
const category = '60000000-0000-4000-8000-000000000001';
const unit = '60000000-0000-4000-8000-000000000002';
const user = '60000000-0000-4000-8000-000000000010';
const scoCompany = '60000000-0000-4000-8000-000000000020';
const scoRole = '60000000-0000-4000-8000-000000000021';
const membership = '60000000-0000-4000-8000-000000000022';

describe('Stage 003 Global Product Catalog', () => {
  beforeAll(async () => {
    await owner.query('DELETE FROM product_identities WHERE category_id = $1', [category]);
    await owner.query('DELETE FROM category_attribute_definitions WHERE category_id = $1', [category]);
    await owner.query('DELETE FROM product_categories WHERE id = $1', [category]);
    await owner.query('DELETE FROM unit_definitions WHERE id = $1', [unit]);
    await owner.query(`INSERT INTO "User" (id,email,"passwordHash") VALUES ($1,'catalog-test@sco.test','test') ON CONFLICT DO NOTHING`, [user]);
    await owner.query(`INSERT INTO product_categories (id,code,name) VALUES ($1,'catalog-test','Catalog Test')`, [category]);
    await owner.query(`INSERT INTO unit_definitions (id,code,name,dimension) VALUES ($1,'EA','Each','count')`, [unit]);
    // SR-01 remediation: the internal gateway requires a real authorized SCO actor (capability, not a GUC).
    await owner.query(`INSERT INTO "Company" (id,name,type) VALUES ($1,'Catalog Gateway SCO','SCO') ON CONFLICT DO NOTHING`, [scoCompany]);
    await owner.query(`INSERT INTO "Role" (id,company_id,code,name) VALUES ($1,$2,'catalog-manager','Catalog Manager') ON CONFLICT DO NOTHING`, [scoRole, scoCompany]);
    await owner.query(`INSERT INTO "CompanyMembership" (id,"userId","companyId",status) VALUES ($1,$2,$3,'ACTIVE') ON CONFLICT DO NOTHING`, [membership, user, scoCompany]);
    await owner.query(`INSERT INTO "MembershipRole" (id,company_id,membership_id,role_id) VALUES (gen_random_uuid(),$1,$2,$3) ON CONFLICT DO NOTHING`, [scoCompany, membership, scoRole]);
    for (const code of ['catalog.manage', 'catalog.approve']) {
      await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT gen_random_uuid(),$1,$2,id FROM "Permission" WHERE code=$3 ON CONFLICT DO NOTHING', [scoCompany, scoRole, code]);
    }
  });
  afterAll(async () => { await owner.query('DELETE FROM product_identities WHERE category_id = $1', [category]); await owner.query('DELETE FROM category_attribute_definitions WHERE category_id = $1', [category]); await owner.query('DELETE FROM product_categories WHERE id = $1', [category]); await owner.query('DELETE FROM unit_definitions WHERE id = $1', [unit]); await owner.query('DELETE FROM "MembershipRole" WHERE membership_id = $1', [membership]); await owner.query('DELETE FROM "RolePermission" WHERE role_id = $1', [scoRole]); await owner.query('DELETE FROM "CompanyMembership" WHERE id = $1', [membership]); await owner.query('DELETE FROM "Role" WHERE id = $1', [scoRole]); await owner.query('DELETE FROM "User" WHERE id = $1', [user]); await owner.query('DELETE FROM "Company" WHERE id = $1', [scoCompany]); await owner.end(); await runtime.end(); await internal.end(); });

  it('keeps global catalog writes behind the internal gateway (no direct sco_runtime access)', async () => {
    const client = await runtime.connect();
    try { await client.query('BEGIN'); await expect(client.query(`INSERT INTO product_categories (code,name) VALUES ('blocked-catalog','Blocked')`)).rejects.toBeTruthy(); await client.query('ROLLBACK'); } finally { client.release(); }
  });

  it('rejects the old app.sco_internal spoof for category attribute writes', async () => {
    const client = await runtime.connect();
    try { await client.query('BEGIN'); await client.query("SELECT set_config('app.sco_internal','true',true)"); await expect(client.query(`INSERT INTO category_attribute_definitions (category_id,key,display_name,data_type,required) VALUES ($1,'spoofed','Spoofed','NUMBER',true)`, [category])).rejects.toBeTruthy(); await client.query('ROLLBACK'); } finally { client.release(); }
  });

  it('supports category-specific attributes and prevents duplicate keys via the internal gateway', async () => {
    await internal.query('SELECT * FROM public.internal_catalog_attribute_create($1,$2,$3,$4,$5,$6,$7,$8)', [user, category, 'capacity', 'Capacity', 'NUMBER', true, null, null]);
    await expect(internal.query('SELECT * FROM public.internal_catalog_attribute_create($1,$2,$3,$4,$5,$6,$7,$8)', [user, category, 'capacity', 'Duplicate', 'TEXT', false, null, null])).rejects.toBeTruthy();
  });

  it('provides SAR as the base currency and keeps brands/models distinct via the internal gateway', async () => {
    const sar = await owner.query(`SELECT code,is_base FROM currency_definitions WHERE code='SAR'`);
    expect(sar.rows).toEqual([{ code: 'SAR', is_base: true }]);
    const a = await internal.query('SELECT * FROM public.internal_catalog_product_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [user, category, 'Gree', 'Gree', '20TR', null, unit, null, null, null]);
    const b = await internal.query('SELECT * FROM public.internal_catalog_product_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [user, category, 'Fuji', 'Fuji', '20TR', null, unit, null, null, null]);
    expect(a.rows[0].id).not.toBe(b.rows[0].id);
  });

  it('prevents silent mutation of identity-defining fields after activation, even for a superuser direct UPDATE', async () => {
    const created = await internal.query('SELECT * FROM public.internal_catalog_product_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [user, category, 'Jotun', 'Jotun', 'A', null, unit, null, null, null]);
    const productId = created.rows[0].id;
    await internal.query('SELECT * FROM public.internal_catalog_product_activate($1,$2)', [user, productId]);
    // sco_runtime no longer has any direct UPDATE grant on product_identities at all (SR-01).
    const client = await runtime.connect();
    try { await client.query('BEGIN'); await expect(client.query(`UPDATE product_identities SET brand='Other' WHERE id=$1`, [productId])).rejects.toBeTruthy(); await client.query('ROLLBACK'); } finally { client.release(); }
    // The immutability trigger itself is defense-in-depth and fires for every role, including the table owner.
    await expect(owner.query(`UPDATE product_identities SET brand='Other' WHERE id=$1`, [productId])).rejects.toBeTruthy();
  });
});
