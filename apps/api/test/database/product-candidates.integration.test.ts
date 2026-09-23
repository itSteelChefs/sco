import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const companyA = '70000000-0000-4000-8000-000000000001';
const companyB = '70000000-0000-4000-8000-000000000002';
const user = '70000000-0000-4000-8000-000000000010';

describe('Stage 003 Product Candidate isolation and history', () => {
  beforeAll(async () => {
    await owner.query('DELETE FROM product_candidates WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM "CompanyMembership" WHERE "userId"=$1', [user]);
    await owner.query('DELETE FROM "User" WHERE id=$1', [user]);
    await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2)', [companyA, companyB]);
    await owner.query(`INSERT INTO "Company" (id,name,type) VALUES ($1,'Candidate A','PARTNER'),($2,'Candidate B','PARTNER')`, [companyA, companyB]);
    await owner.query(`INSERT INTO "User" (id,email,"passwordHash") VALUES ($1,'candidate@sco.test','test')`, [user]);
  });
  afterAll(async () => { await owner.query('DELETE FROM product_candidates WHERE company_id IN ($1,$2)', [companyA, companyB]); await owner.query('DELETE FROM "User" WHERE id=$1', [user]); await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2)', [companyA, companyB]); await owner.end(); await runtime.end(); });

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

  it('requires SCO internal context to create review assessments and preserves outcome history', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.sco_internal','true',true)");
      const candidate = await client.query(`INSERT INTO product_candidates (company_id,submitted_by,origin,submitted_name,brand,model_reference) VALUES ($1,$2,'SCO_INTERNAL','Fuji 20TR','Fuji','20TR') RETURNING id`, [companyA, user]);
      const id = candidate.rows[0].id;
      await client.query(`INSERT INTO product_candidate_history (candidate_id,to_status,actor_user_id,reason) VALUES ($1,'SUBMITTED',$2,'submitted')`, [id, user]);
      await client.query(`UPDATE product_candidates SET status='CLARIFICATION_REQUIRED' WHERE id=$1`, [id]);
      await client.query(`INSERT INTO product_candidate_history (candidate_id,from_status,to_status,actor_user_id,reason) VALUES ($1,'SUBMITTED','CLARIFICATION_REQUIRED',$2,'model required')`, [id, user]);
      expect((await client.query('SELECT count(*)::int AS count FROM product_candidate_history WHERE candidate_id=$1', [id])).rows[0].count).toBe(2);
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });
});
