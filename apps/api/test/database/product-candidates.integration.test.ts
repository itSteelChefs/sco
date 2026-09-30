import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
const companyA = '70000000-0000-4000-8000-000000000001';
const companyB = '70000000-0000-4000-8000-000000000002';
const user = '70000000-0000-4000-8000-000000000010';
const scoCompany = '70000000-0000-4000-8000-000000000020';
const scoRole = '70000000-0000-4000-8000-000000000021';
const scoUser = '70000000-0000-4000-8000-000000000011';

describe('Stage 003 Product Candidate isolation and history', () => {
  beforeAll(async () => {
    await owner.query('DELETE FROM product_candidates WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM "CompanyMembership" WHERE "userId"=$1 OR "userId"=$2', [user, scoUser]);
    await owner.query('DELETE FROM "User" WHERE id=$1 OR id=$2', [user, scoUser]);
    await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2,$3)', [companyA, companyB, scoCompany]);
    await owner.query(`INSERT INTO "Company" (id,name,type) VALUES ($1,'Candidate A','PARTNER'),($2,'Candidate B','PARTNER'),($3,'Candidate Gateway SCO','SCO')`, [companyA, companyB, scoCompany]);
    await owner.query(`INSERT INTO "User" (id,email,"passwordHash") VALUES ($1,'candidate@sco.test','test'),($2,'candidate-internal@sco.test','test')`, [user, scoUser]);
    // SR-01 remediation: internal candidate review now requires a real authorized SCO actor (capability, not a GUC).
    await owner.query(`INSERT INTO "Role" (id,company_id,code,name) VALUES ($1,$2,'candidate-manager','Candidate Manager')`, [scoRole, scoCompany]);
    await owner.query(`INSERT INTO "CompanyMembership" (id,"userId","companyId",status) VALUES (gen_random_uuid(),$1,$2,'ACTIVE')`, [scoUser, scoCompany]);
    await owner.query(`INSERT INTO "MembershipRole" (id,company_id,membership_id,role_id) SELECT gen_random_uuid(),$1,cm.id,$2 FROM "CompanyMembership" cm WHERE cm."userId"=$3 AND cm."companyId"=$1`, [scoCompany, scoRole, scoUser]);
    await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT gen_random_uuid(),$1,$2,id FROM "Permission" WHERE code=$3', [scoCompany, scoRole, 'candidate.manage']);
  });
  afterAll(async () => { await owner.query('DELETE FROM product_match_assessments WHERE candidate_id IN (SELECT id FROM product_candidates WHERE company_id IN ($1,$2) OR submitted_by=$3)', [companyA, companyB, scoUser]); await owner.query('DELETE FROM product_candidate_history WHERE candidate_id IN (SELECT id FROM product_candidates WHERE company_id IN ($1,$2) OR submitted_by=$3)', [companyA, companyB, scoUser]); await owner.query('DELETE FROM product_candidates WHERE company_id IN ($1,$2) OR submitted_by=$3', [companyA, companyB, scoUser]); await owner.query('DELETE FROM "MembershipRole" WHERE membership_id IN (SELECT id FROM "CompanyMembership" WHERE "userId"=$1)', [scoUser]); await owner.query('DELETE FROM "RolePermission" WHERE role_id=$1', [scoRole]); await owner.query('DELETE FROM "CompanyMembership" WHERE "userId"=$1', [scoUser]); await owner.query('DELETE FROM "Role" WHERE id=$1', [scoRole]); await owner.query('DELETE FROM "User" WHERE id=$1 OR id=$2', [user, scoUser]); await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2,$3)', [companyA, companyB, scoCompany]); await owner.end(); await runtime.end(); await internal.end(); });

  it('keeps partner candidates isolated and denies missing tenant context', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyA]);
      const inserted = await client.query(`INSERT INTO product_candidates (company_id,submitted_by,origin,submitted_name,brand,model_reference) VALUES ($1,$2,'PARTNER','Gree 20TR','Gree','20TR') RETURNING id`, [companyA, user]);
      const candidateId = inserted.rows[0].id;
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyB]);
      expect((await client.query('SELECT id FROM product_candidates WHERE id=$1', [candidateId])).rowCount).toBe(0);
      await client.query("SELECT set_config('app.tenant_id','',true)");
      expect((await client.query('SELECT id FROM product_candidates WHERE id=$1', [candidateId])).rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });

  it('rejects the old app.sco_internal spoof, and requires the internal gateway to create review assessments and preserve outcome history', async () => {
    // A. spoofing MUST FAIL: app.sco_internal alone no longer grants access (SR-01).
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.sco_internal','true',true)");
      await expect(client.query(`INSERT INTO product_candidates (company_id,submitted_by,origin,submitted_name,brand,model_reference) VALUES ($1,$2,'SCO_INTERNAL','Spoofed','Spoofed','X')`, [companyA, user])).rejects.toBeTruthy();
    } finally { await client.query('ROLLBACK'); client.release(); }

    // B. legitimate approved gateway MUST PASS.
    const submitted = await internal.query('SELECT * FROM public.internal_candidate_submit($1,$2,$3,$4,$5,$6,$7,$8)', [scoUser, 'Fuji 20TR', null, 'Fuji', '20TR', null, null, null]);
    const candidateId = submitted.rows[0].id;
    await internal.query('SELECT * FROM public.internal_candidate_transition($1,$2,$3,$4,$5,$6,$7,$8,$9)', [scoUser, candidateId, 'CLARIFICATION_REQUIRED', 'model required', null, null, null, null, null]);
    const history = await owner.query('SELECT count(*)::int AS count FROM product_candidate_history WHERE candidate_id=$1', [candidateId]);
    expect(history.rows[0].count).toBe(2);
  });
});
