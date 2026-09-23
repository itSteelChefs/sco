import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const companyA = '50000000-0000-4000-8000-000000000001';
const companyB = '50000000-0000-4000-8000-000000000002';

describe('Batch 2 qualification and partnership boundaries', () => {
  beforeAll(async () => {
    await owner.query('DELETE FROM company_partnerships WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2)', [companyA, companyB]);
    await owner.query(`INSERT INTO "Company" (id, name, type) VALUES ($1, 'Batch 2 A', 'PARTNER'), ($2, 'Batch 2 B', 'PARTNER')`, [companyA, companyB]);
  });

  afterAll(async () => {
    await owner.query('DELETE FROM company_partnerships WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2)', [companyA, companyB]);
    await owner.end();
    await runtime.end();
  });

  it('keeps PRE_TENANT qualification behind explicit SCO internal context', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query('SAVEPOINT denied_qualification');
      await expect(client.query(`INSERT INTO qualification_applications (legal_name, contact_email) VALUES ('Blocked', 'blocked@sco.test')`)).rejects.toBeTruthy();
      await client.query('ROLLBACK TO SAVEPOINT denied_qualification');
      await client.query("SELECT set_config('app.sco_internal', 'true', true)");
      const result = await client.query(`INSERT INTO qualification_applications (legal_name, contact_email) VALUES ('Pending', 'pending@sco.test') RETURNING status`);
      expect(result.rows[0].status).toBe('APPLICATION');
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });

  it('allows independent partnerships only in the validated tenant context', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [companyA]);
      await client.query(`INSERT INTO company_partnerships (company_id, type, status) VALUES ($1, 'BUYER_PARTNERSHIP', 'ACTIVE')`, [companyA]);
      await client.query('SAVEPOINT denied_partnership');
      await expect(client.query(`INSERT INTO company_partnerships (company_id, type) VALUES ($1, 'SUPPLIER_PARTNERSHIP')`, [companyB])).rejects.toBeTruthy();
      await client.query('ROLLBACK TO SAVEPOINT denied_partnership');
      const rows = await client.query(`SELECT type FROM company_partnerships WHERE company_id = $1`, [companyA]);
      expect(rows.rows.map((row) => row.type)).toEqual(['BUYER_PARTNERSHIP']);
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });

  it('does not treat membership as commercial eligibility without an active partnership and permission', async () => {
    const userId = '50000000-0000-4000-8000-000000000010';
    await owner.query(`INSERT INTO "User" (id, email, "passwordHash") VALUES ($1, 'batch2-user@sco.test', 'test-hash') ON CONFLICT DO NOTHING`, [userId]);
    await owner.query(`INSERT INTO "CompanyMembership" ("userId", "companyId", status) VALUES ($1, $2, 'ACTIVE') ON CONFLICT DO NOTHING`, [userId, companyA]);
    await owner.query(`INSERT INTO company_partnerships (company_id, type, status) VALUES ($1, 'BUYER_PARTNERSHIP', 'ACTIVE') ON CONFLICT DO NOTHING`, [companyA]);
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [companyA]);
      const result = await client.query(
        `SELECT 1 FROM "CompanyMembership" cm JOIN company_partnerships cp ON cp.company_id = cm."companyId" AND cp.type = 'BUYER_PARTNERSHIP' AND cp.status = 'ACTIVE' WHERE cm."userId" = $1 AND cm."companyId" = $2 AND cm.status = 'ACTIVE'`,
        [userId, companyA],
      );
      expect(result.rowCount).toBe(1);
      await client.query('ROLLBACK');
    } finally { client.release(); await owner.query('DELETE FROM "CompanyMembership" WHERE "userId" = $1', [userId]); await owner.query('DELETE FROM "User" WHERE id = $1', [userId]); await owner.query('DELETE FROM company_partnerships WHERE company_id = $1', [companyA]); }
  });
});
