import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
const companyA = '50000000-0000-4000-8000-000000000001';
const companyB = '50000000-0000-4000-8000-000000000002';
const scoCompany = '50000000-0000-4000-8000-000000000020';
const scoRole = '50000000-0000-4000-8000-000000000021';
const scoUser = '50000000-0000-4000-8000-000000000011';

describe('Batch 2 qualification and partnership boundaries', () => {
  beforeAll(async () => {
    await owner.query('DELETE FROM company_partnerships WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM "CompanyMembership" WHERE "userId"=$1', [scoUser]);
    await owner.query('DELETE FROM "User" WHERE id=$1', [scoUser]);
    await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2,$3)', [companyA, companyB, scoCompany]);
    await owner.query(`INSERT INTO "Company" (id, name, type) VALUES ($1, 'Batch 2 A', 'PARTNER'), ($2, 'Batch 2 B', 'PARTNER'), ($3, 'Batch 2 Gateway SCO', 'SCO')`, [companyA, companyB, scoCompany]);
    // SR-01 remediation: qualification creation now requires a real authorized SCO actor (capability, not a GUC).
    await owner.query(`INSERT INTO "User" (id, email, "passwordHash") VALUES ($1, 'batch2-internal@sco.test', 'test-hash')`, [scoUser]);
    await owner.query(`INSERT INTO "Role" (id,company_id,code,name) VALUES ($1,$2,'qualification-manager','Qualification Manager')`, [scoRole, scoCompany]);
    await owner.query(`INSERT INTO "CompanyMembership" (id,"userId","companyId",status) VALUES (gen_random_uuid(),$1,$2,'ACTIVE')`, [scoUser, scoCompany]);
    await owner.query(`INSERT INTO "MembershipRole" (id,company_id,membership_id,role_id) SELECT gen_random_uuid(),$1,cm.id,$2 FROM "CompanyMembership" cm WHERE cm."userId"=$3 AND cm."companyId"=$1`, [scoCompany, scoRole, scoUser]);
    await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT gen_random_uuid(),$1,$2,id FROM "Permission" WHERE code=$3', [scoCompany, scoRole, 'qualification.manage']);
  });

  afterAll(async () => {
    await owner.query('DELETE FROM qualification_applications WHERE submitted_by=$1', [scoUser]);
    await owner.query('DELETE FROM company_partnerships WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM "MembershipRole" WHERE membership_id IN (SELECT id FROM "CompanyMembership" WHERE "userId"=$1)', [scoUser]);
    await owner.query('DELETE FROM "RolePermission" WHERE role_id=$1', [scoRole]);
    await owner.query('DELETE FROM "CompanyMembership" WHERE "userId"=$1', [scoUser]);
    await owner.query('DELETE FROM "Role" WHERE id=$1', [scoRole]);
    await owner.query('DELETE FROM "User" WHERE id=$1', [scoUser]);
    await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2,$3)', [companyA, companyB, scoCompany]);
    await owner.end();
    await runtime.end();
    await internal.end();
  });

  it('rejects the old app.sco_internal spoof, and requires the internal gateway for PRE_TENANT qualification creation', async () => {
    // A. spoofing MUST FAIL: app.sco_internal alone no longer grants access (SR-01). SAVEPOINT keeps the connection
    // healthy so the subsequent legitimate-path assertion in this same test is unaffected.
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query('SAVEPOINT denied_qualification');
      await expect(client.query(`INSERT INTO qualification_applications (legal_name, contact_email) VALUES ('Blocked', 'blocked@sco.test')`)).rejects.toBeTruthy();
      await client.query('ROLLBACK TO SAVEPOINT denied_qualification');
      await client.query('SAVEPOINT spoofed_qualification');
      await client.query("SELECT set_config('app.sco_internal', 'true', true)");
      await expect(client.query(`INSERT INTO qualification_applications (legal_name, contact_email) VALUES ('Spoofed', 'spoofed@sco.test')`)).rejects.toBeTruthy();
      await client.query('ROLLBACK TO SAVEPOINT spoofed_qualification');
      await client.query('ROLLBACK');
    } finally { client.release(); }

    // B. legitimate approved gateway MUST PASS.
    const created = await internal.query('SELECT * FROM public.internal_qualification_create($1,$2,$3)', [scoUser, 'Pending', 'pending@sco.test']);
    expect(created.rows[0].status).toBe('APPLICATION');
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
