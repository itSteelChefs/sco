import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });

const companyA = '71000000-0000-4000-8000-000000000001';
const companyB = '71000000-0000-4000-8000-000000000002';
const actor = '71000000-0000-4000-8000-000000000010';
const role = '71000000-0000-4000-8000-000000000011';
let membershipId: string;
let policyId: string;

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
    await owner.query('DELETE FROM partner_agreement_acceptance_events WHERE company_id = $1', [companyA]);
    await owner.query('DELETE FROM partner_agreement_acceptances WHERE company_id = $1', [companyA]);
    await owner.query('DELETE FROM partner_agreement_policy_events WHERE policy_version_id IN (SELECT id FROM partner_agreement_policy_versions WHERE created_by=$1)', [actor]);
    await owner.query('DELETE FROM partner_agreement_policy_versions WHERE created_by=$1', [actor]);
    await owner.query('DELETE FROM company_partnerships WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM "MembershipRole" WHERE company_id = $1', [companyA]);
    await owner.query('DELETE FROM "RolePermission" WHERE role_id = $1', [role]);
    await owner.query('DELETE FROM "CompanyMembership" WHERE "userId" = $1', [actor]);
    await owner.query('DELETE FROM "Role" WHERE id = $1', [role]);
    await owner.query('DELETE FROM "User" WHERE id = $1', [actor]);
    await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2)', [companyA, companyB]);
    await owner.query(`INSERT INTO "Company" (id, name, type) VALUES ($1, 'CPF A', 'PARTNER'), ($2, 'CPF B', 'PARTNER')`, [companyA, companyB]);
    await owner.query(`INSERT INTO "User" (id, email, "passwordHash") VALUES ($1, 'cpf-03@sco.test', 'test-hash')`, [actor]);
    membershipId = (await owner.query<{ id: string }>(
      `INSERT INTO "CompanyMembership" ("userId", "companyId", status) VALUES ($1,$2,'ACTIVE') RETURNING id`,
      [actor, companyA],
    )).rows[0].id;
    await owner.query(`INSERT INTO "Role" (id,company_id,code,name) VALUES ($1,$2,'cpf-03-partner','CPF-03 Partner')`, [role, companyA]);
    await owner.query(
      `INSERT INTO "MembershipRole" (id,company_id,membership_id,role_id) VALUES (gen_random_uuid(),$1,$2,$3)`,
      [companyA, membershipId, role],
    );
    await owner.query(
      `INSERT INTO "RolePermission" (id,company_id,role_id,permission_id)
       SELECT gen_random_uuid(),$1,$2,id FROM "Permission" WHERE code IN ('partner.portal.read','partner.agreement.accept')`,
      [companyA, role],
    );
    policyId = (await owner.query<{ id: string }>(
      `INSERT INTO partner_agreement_policy_versions (
         agreement_type,version_code,content_text,content_sha256,required,effective_at,
         acceptance_permission_code,reacceptance_required,suspension_effect,termination_effect,
         retention_classification,state,created_by
       ) VALUES (
         'BINDING_CONFIDENTIALITY','cpf-03-test-v1','CPF-03 test agreement',
         encode(digest(convert_to('CPF-03 test agreement','UTF8'),'sha256'),'hex'),true,
         clock_timestamp() - interval '1 minute','partner.agreement.accept',false,
         'NO_ACCESS_CHANGE','NO_ACCESS_CHANGE','TEST_RETENTION','PUBLISHED',$1
       ) RETURNING id`,
      [actor],
    )).rows[0].id;
    const acceptanceId = (await owner.query<{ id: string }>(
      `INSERT INTO partner_agreement_acceptances (
         company_id,actor_user_id,membership_id,policy_version_id,agreement_type,version_code,
         accepted_content_sha256,authority_permission_code,authority_basis,purpose_code,
         idempotency_key,request_fingerprint,correlation_id
       ) VALUES (
         $1,$2,$3,$4,'BINDING_CONFIDENTIALITY','cpf-03-test-v1',
         encode(digest(convert_to('CPF-03 test agreement','UTF8'),'sha256'),'hex'),
         'partner.agreement.accept','{}'::jsonb,'PUR-02','cpf-03-test-acceptance',repeat('a',64),gen_random_uuid()
       ) RETURNING id`,
      [companyA, actor, membershipId, policyId],
    )).rows[0].id;
    await owner.query(
      `INSERT INTO partner_agreement_acceptance_events (acceptance_id,company_id,status,actor_user_id,correlation_id)
       VALUES ($1,$2,'ACCEPTED',$3,gen_random_uuid())`,
      [acceptanceId, companyA, actor],
    );
  });

  afterAll(async () => {
    await owner.query('DELETE FROM audit_logs WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM procurement_needs WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM partner_agreement_acceptance_events WHERE company_id = $1', [companyA]);
    await owner.query('DELETE FROM partner_agreement_acceptances WHERE company_id = $1', [companyA]);
    await owner.query('DELETE FROM partner_agreement_policy_events WHERE policy_version_id = $1', [policyId]);
    await owner.query('DELETE FROM partner_agreement_policy_versions WHERE id = $1', [policyId]);
    await owner.query('DELETE FROM company_partnerships WHERE company_id IN ($1,$2)', [companyA, companyB]);
    await owner.query('DELETE FROM "MembershipRole" WHERE company_id = $1', [companyA]);
    await owner.query('DELETE FROM "RolePermission" WHERE role_id = $1', [role]);
    await owner.query('DELETE FROM "CompanyMembership" WHERE "userId" = $1', [actor]);
    await owner.query('DELETE FROM "Role" WHERE id = $1', [role]);
    await owner.query('DELETE FROM "User" WHERE id = $1', [actor]);
    await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2)', [companyA, companyB]);
    await Promise.all([owner.end(), runtime.end(), internal.end()]);
  });

  it('allows the fixed gateway only with an active buyer partnership and creates its audit evidence atomically', async () => {
    await owner.query(`INSERT INTO company_partnerships (company_id, type, status) VALUES ($1,'BUYER_PARTNERSHIP','ACTIVE')`, [companyA]);
    const eligibility = await owner.query(
      `SELECT
         EXISTS (SELECT 1 FROM "Company" WHERE id=$1 AND type='PARTNER' AND status='ACTIVE') AS company_active,
         EXISTS (SELECT 1 FROM "User" WHERE id=$2 AND status='ACTIVE') AS actor_active,
         EXISTS (SELECT 1 FROM "CompanyMembership" WHERE "userId"=$2 AND "companyId"=$1 AND status='ACTIVE') AS membership_active,
         EXISTS (SELECT 1 FROM company_partnerships WHERE company_id=$1 AND type='BUYER_PARTNERSHIP' AND status='ACTIVE') AS partnership_active,
         EXISTS (
           SELECT 1 FROM "CompanyMembership" membership
           JOIN "MembershipRole" membership_role ON membership_role.membership_id=membership.id AND membership_role.company_id=$1
           JOIN "RolePermission" role_permission ON role_permission.role_id=membership_role.role_id AND role_permission.company_id=$1
           JOIN "Permission" permission ON permission.id=role_permission.permission_id
           WHERE membership."userId"=$2 AND membership."companyId"=$1 AND membership.status='ACTIVE'
             AND permission.code='partner.portal.read'
         ) AS portal_permission,
         public.partner_required_agreements_satisfied($1) AS agreement_ready,
         public.partner_procurement_access_allowed($2,$1) AS access_allowed`,
      [companyA, actor],
    );
    expect(eligibility.rows[0]).toEqual({
      company_active: true,
      actor_active: true,
      membership_active: true,
      partnership_active: true,
      portal_permission: true,
      agreement_ready: true,
      access_allowed: true,
    });

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
