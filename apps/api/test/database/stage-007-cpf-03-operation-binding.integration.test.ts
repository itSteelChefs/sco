import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });

const companyA = '71000000-0000-4000-8000-000000000001';
const companyB = '71000000-0000-4000-8000-000000000002';
const actor = '71000000-0000-4000-8000-000000000010';

async function createNeed(companyId = companyA, correlationId: string | null = '71000000-0000-4000-8000-000000000101') {
  return internal.query(
    `SELECT * FROM public.internal_procurement_need_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [actor, companyId, 'CPF-03 test need', 1, null, '2026-10-02', null, null, null, correlationId],
  );
}

describe('Stage 007 CPF-03 procurement-need operation binding', () => {
  beforeAll(async () => {
    await owner.query('DELETE FROM audit_logs WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM procurement_needs WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM company_partnerships WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM "CompanyMembership" WHERE "userId" = $1', [actor]);
    await owner.query('DELETE FROM "User" WHERE id = $1', [actor]);
    await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2)', [companyA, companyB]);
    await owner.query(`INSERT INTO "Company" (id, name, type) VALUES ($1, 'CPF A', 'PARTNER'), ($2, 'CPF B', 'PARTNER')`, [companyA, companyB]);
    await owner.query(`INSERT INTO "User" (id, email, "passwordHash") VALUES ($1, 'cpf-03@sco.test', 'test-hash')`, [actor]);
    await owner.query(`INSERT INTO "CompanyMembership" ("userId", "companyId", status) VALUES ($1,$2,'ACTIVE')`, [actor, companyA]);
  });

  afterAll(async () => {
    await owner.query('DELETE FROM audit_logs WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM procurement_needs WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM company_partnerships WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM "CompanyMembership" WHERE "userId" = $1', [actor]);
    await owner.query('DELETE FROM "User" WHERE id = $1', [actor]);
    await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2)', [companyA, companyB]);
    await Promise.all([owner.end(), runtime.end(), internal.end()]);
  });

  it('allows the fixed gateway only with an active buyer partnership and creates its audit evidence atomically', async () => {
    await owner.query(`INSERT INTO company_partnerships (company_id, type, status) VALUES ($1,'BUYER_PARTNERSHIP','ACTIVE')`, [companyA]);

    const created = await createNeed();
    expect(created.rows[0]).toMatchObject({ description: 'CPF-03 test need', quantity: '1', maturity: 'FORECAST' });
    const audit = await owner.query(
      `SELECT correlation_id, purpose_code, flow_cpf_id, flow_source, flow_target, authorization_decision
       FROM audit_logs WHERE entity_id = $1`,
      [created.rows[0].id],
    );
    expect(audit.rows).toEqual([{
      correlation_id: '71000000-0000-4000-8000-000000000101',
      purpose_code: 'PUR-05',
      flow_cpf_id: 'CPF_03',
      flow_source: 'PUR-03',
      flow_target: 'PUR-05',
      authorization_decision: 'ALLOWED',
    }]);
  });

  it('denies inactive memberships and inactive, wrong-type, missing, wrong-company, and cross-tenant partnerships', async () => {
    await owner.query('DELETE FROM company_partnerships WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await expect(createNeed()).rejects.toThrow('PROCUREMENT_NEED_INTAKE_FORBIDDEN');

    await owner.query(`INSERT INTO company_partnerships (company_id, type, status) VALUES ($1,'BUYER_PARTNERSHIP','ACTIVE')`, [companyA]);
    await owner.query(`UPDATE "CompanyMembership" SET status = 'REVOKED' WHERE "userId" = $1 AND "companyId" = $2`, [actor, companyA]);
    await expect(createNeed()).rejects.toThrow('PROCUREMENT_NEED_INTAKE_FORBIDDEN');
    await owner.query(`UPDATE "CompanyMembership" SET status = 'ACTIVE' WHERE "userId" = $1 AND "companyId" = $2`, [actor, companyA]);
    await owner.query('DELETE FROM company_partnerships WHERE company_id = $1', [companyA]);

    await owner.query(`INSERT INTO company_partnerships (company_id, type, status) VALUES ($1,'SUPPLIER_PARTNERSHIP','ACTIVE')`, [companyA]);
    await expect(createNeed()).rejects.toThrow('PROCUREMENT_NEED_INTAKE_FORBIDDEN');

    await owner.query('DELETE FROM company_partnerships WHERE company_id = $1', [companyA]);
    await owner.query(`INSERT INTO company_partnerships (company_id, type, status) VALUES ($1,'BUYER_PARTNERSHIP','SUSPENDED')`, [companyA]);
    await expect(createNeed()).rejects.toThrow('PROCUREMENT_NEED_INTAKE_FORBIDDEN');

    await owner.query('DELETE FROM company_partnerships WHERE company_id = $1', [companyA]);
    await owner.query(`INSERT INTO company_partnerships (company_id, type, status) VALUES ($1,'BUYER_PARTNERSHIP','ACTIVE')`, [companyB]);
    await expect(createNeed()).rejects.toThrow('PROCUREMENT_NEED_INTAKE_FORBIDDEN');
    await expect(createNeed(companyB, '71000000-0000-4000-8000-000000000102')).rejects.toThrow('PROCUREMENT_NEED_INTAKE_FORBIDDEN');
  });

  it('derives non-empty correlation evidence at the gateway when a trusted caller omits it', async () => {
    await owner.query('DELETE FROM company_partnerships WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query(`INSERT INTO company_partnerships (company_id, type, status) VALUES ($1,'BUYER_PARTNERSHIP','ACTIVE')`, [companyA]);
    const created = await createNeed(companyA, null);
    const audit = await owner.query<{ correlation_id: string }>(
      'SELECT correlation_id FROM audit_logs WHERE entity_id = $1',
      [created.rows[0].id],
    );
    expect(audit.rows[0].correlation_id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('denies runtime direct inserts and direct invocation of the protected gateway', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [companyA]);
      await expect(client.query(
        `INSERT INTO procurement_needs(company_id, created_by, source_type, description, quantity, need_date)
         VALUES($1,$2,'MANUAL','bypass',1,CURRENT_DATE)`,
        [companyA, actor],
      )).rejects.toBeTruthy();
      await expect(client.query(
        `SELECT * FROM public.internal_procurement_need_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [actor, companyA, 'bypass', 1, null, '2026-10-02', null, null, null, '71000000-0000-4000-8000-000000000103'],
      )).rejects.toBeTruthy();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('keeps the migration-0095 gateway least-privileged and RLS-protected', async () => {
    const security = await owner.query(
      `SELECT
        has_table_privilege('sco_runtime', 'public.procurement_needs', 'INSERT') AS runtime_insert,
        has_table_privilege('sco_runtime', 'public.procurement_needs', 'UPDATE') AS runtime_update,
        has_table_privilege('sco_runtime', 'public.procurement_needs', 'DELETE') AS runtime_delete,
        has_function_privilege('public', 'public.internal_procurement_need_create(uuid,uuid,text,numeric,uuid,date,uuid,uuid,uuid,uuid)', 'EXECUTE') AS public_execute,
        has_function_privilege('sco_runtime', 'public.internal_procurement_need_create(uuid,uuid,text,numeric,uuid,date,uuid,uuid,uuid,uuid)', 'EXECUTE') AS runtime_execute,
        has_function_privilege('sco_internal_executor', 'public.internal_procurement_need_create(uuid,uuid,text,numeric,uuid,date,uuid,uuid,uuid,uuid)', 'EXECUTE') AS executor_execute,
        p.prosecdef AS security_definer,
        owner_role.rolname AS owner_role,
        p.proconfig AS function_config,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced
       FROM pg_proc p
       JOIN pg_roles owner_role ON owner_role.oid = p.proowner
       JOIN pg_class c ON c.oid = 'public.procurement_needs'::regclass
       WHERE p.oid = 'public.internal_procurement_need_create(uuid,uuid,text,numeric,uuid,date,uuid,uuid,uuid,uuid)'::regprocedure`,
    );
    expect(security.rows).toEqual([expect.objectContaining({
      runtime_insert: false,
      runtime_update: false,
      runtime_delete: false,
      public_execute: false,
      runtime_execute: false,
      executor_execute: true,
      security_definer: true,
      owner_role: 'sco_internal_gateway_owner',
      rls_enabled: true,
      rls_forced: true,
    })]);
    expect(security.rows[0].function_config).toContain('search_path=pg_catalog, public');
  });

  it('rolls back the need and its success audit together', async () => {
    await owner.query('DELETE FROM company_partnerships WHERE company_id = $1', [companyA]);
    await owner.query(`INSERT INTO company_partnerships (company_id, type, status) VALUES ($1,'BUYER_PARTNERSHIP','ACTIVE')`, [companyA]);
    const client = await internal.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query(
        `SELECT * FROM public.internal_procurement_need_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [actor, companyA, 'rollback-only', 1, null, '2026-10-02', null, null, null, '71000000-0000-4000-8000-000000000104'],
      );
      await client.query('ROLLBACK');
      const persisted = await owner.query(
        `SELECT
          (SELECT count(*) FROM procurement_needs WHERE id = $1) AS needs,
          (SELECT count(*) FROM audit_logs WHERE entity_id = $1) AS audits`,
        [created.rows[0].id],
      );
      expect(persisted.rows[0]).toEqual({ needs: '0', audits: '0' });
    } finally {
      client.release();
    }
  });
});
