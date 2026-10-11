import { randomUUID } from 'node:crypto';
import { Client, Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let partnerCompany: string;
let internalCompany: string;
let partnerUser: string;
let analyst: string;
let approver: string;
let unitId: string;

async function grant(userId: string, companyId: string, code: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, companyId])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, companyId, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), companyId, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), companyId, role, code]);
}

async function connection(url: string, actor: string, tenant: string | null) {
  const client = new Client({ connectionString: url });
  await client.connect();
  if (tenant) await client.query("SELECT set_config('app.tenant_id',$1,false)", [tenant]);
  await client.query("SELECT set_config('app.actor_id',$1,false)", [actor]);
  return client;
}

describe('Post-Stage016 operational Verify', () => {
  beforeAll(async () => {
    partnerCompany = id(); internalCompany = id(); partnerUser = id(); analyst = id(); approver = id(); unitId = id();
    // security-gate and similar suites TRUNCATE "User"; restore the fixed verify system actor before run create.
    await owner.query(
      `INSERT INTO "User"(id,email,"passwordHash",status)
       VALUES ('00000000-0000-4000-9000-000000005357','verify-system@sco.internal','SYSTEM_ACCOUNT_NO_LOGIN_NOT_A_REAL_HASH','ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.query('INSERT INTO "Company"(id,name,type,status) VALUES($1,\'Operational Verify Partner\',\'PARTNER\',\'ACTIVE\'),($2,\'Operational Verify SCO\',\'SCO\',\'ACTIVE\')', [partnerCompany, internalCompany]);
    await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,\'Each\',\'count\')', [unitId, `operational-verify-${unitId}`]);
    await owner.query('INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,\'x\',\'ACTIVE\'),($3,$4,\'x\',\'ACTIVE\'),($5,$6,\'x\',\'ACTIVE\')', [partnerUser, `${partnerUser}@operational.test`, analyst, `${analyst}@operational.test`, approver, `${approver}@operational.test`]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\'),($4,$5,$6,\'ACTIVE\'),($7,$8,$9,\'ACTIVE\')', [id(), partnerUser, partnerCompany, id(), analyst, internalCompany, id(), approver, internalCompany]);
    await grant(partnerUser, partnerCompany, 'partner_verify.write');
    await grant(analyst, internalCompany, 'verify.analyst');
    await grant(approver, internalCompany, 'verify.approver');
  });

  afterAll(async () => {
    await owner.query('TRUNCATE verify_line_result_evidence,verify_line_results,verify_run_line_scope,verify_results,verify_evidence_bindings,verify_runs,verify_quote_lines,verify_quote_revisions,verify_requests CASCADE');
    await owner.query('DELETE FROM audit_logs WHERE actor_user_id IN ($1,$2,$3) OR company_id IN ($4,$5)', [partnerUser, analyst, approver, partnerCompany, internalCompany]);
    await owner.query('DELETE FROM "MembershipRole" WHERE "company_id" IN ($1,$2)', [partnerCompany, internalCompany]);
    await owner.query('DELETE FROM "RolePermission" WHERE company_id IN ($1,$2)', [partnerCompany, internalCompany]);
    await owner.query('DELETE FROM "Role" WHERE company_id IN ($1,$2)', [partnerCompany, internalCompany]);
    await owner.query('DELETE FROM "CompanyMembership" WHERE "companyId" IN ($1,$2)', [partnerCompany, internalCompany]);
    await owner.query('DELETE FROM "User" WHERE id IN ($1,$2,$3)', [partnerUser, analyst, approver]);
    await owner.query('DELETE FROM unit_definitions WHERE id=$1', [unitId]);
    await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2)', [partnerCompany, internalCompany]);
    await owner.end();
  });

  it('prepares and approves a partner-safe operational result without procurement side effects', async () => {
    const partner = await connection(process.env.RUNTIME_DATABASE_URL!, partnerUser, partnerCompany);
    const system = await connection(process.env.VERIFY_SYSTEM_DATABASE_URL!, id(), null);
    const internal = await connection(process.env.SCO_INTERNAL_DATABASE_URL!, analyst, internalCompany);
    const approverClient = await connection(process.env.SCO_INTERNAL_DATABASE_URL!, approver, internalCompany);
    try {
      const request = (await partner.query('SELECT partner_verify_request_create($1,$2,$3) request_id', [partnerUser, partnerCompany, id()])).rows[0].request_id;
      const revision = (await partner.query(`SELECT partner_verify_revision_create($1,$2,$3,NULL,$4::text[],$5::jsonb,NULL,NULL,$6,$7::jsonb,$8,$9) revision_id`, [
        partnerUser, partnerCompany, request, ['SAR'], '{}', `operational-${id()}`, JSON.stringify([
          { lineNumber: 1, itemDescription: 'Zero-value verified line', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 0, isPriceBearing: true, isRealZeroValue: true },
        ]), id(), id(),
      ])).rows[0].revision_id;
      const line = (await owner.query('SELECT id FROM verify_quote_lines WHERE verify_quote_revision_id=$1', [revision])).rows[0].id;
      await partner.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,NULL,$5)', [partnerUser, partnerCompany, line, 'READY_FOR_VERIFICATION', id()]);
      await partner.query('SELECT partner_verify_request_submit($1,$2,$3,$4,$5)', [partnerUser, partnerCompany, request, revision, id()]);

      const run = (await system.query('SELECT internal_verify_system_run_create($1,$2,$3,NULL,$4) run_id', [revision, 'verify-v0.1', `operational-${id()}`, id()])).rows[0].run_id;
      await system.query('SELECT internal_verify_system_run_start($1,$2)', [run, id()]);
      await system.query('SELECT internal_verify_system_line_result_record($1,$2,$3,NULL,NULL,$4)', [run, line, 'VERIFIED', id()]);
      await system.query('SELECT internal_verify_system_run_complete($1,$2)', [run, id()]);

      const queued = await internal.query('SELECT * FROM public.internal_verify_queue($1,10,0,NULL)', [analyst]);
      expect(queued.rows.some((row) => row.run_id === run)).toBe(true);
      const beforeProcurement = (await owner.query('SELECT count(*)::int AS count FROM procurement_needs')).rows[0].count;
      await expect(internal.query('SELECT public.internal_verify_result_prepare_operational($1,$2,\'{}\',\'{}\',\'{}\',\'{}\',$3,\'{}\',NULL,$4)', [analyst, run, 'ORDER', id()])).rejects.toThrow('VERIFY_PROPOSED_ACTION_INVALID');
      const result = (await internal.query('SELECT public.internal_verify_result_prepare_operational($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8::jsonb,NULL,$9) result_id', [analyst, run, '{"amount":0}', '{"reference":"quote"}', '{"amount":0}', '{"method":"quote-check"}', 'REVIEW', '{}', id()])).rows[0].result_id;
      const prepared = (await owner.query('SELECT status,classification,coverage,per_currency_scopes FROM verify_results WHERE id=$1', [result])).rows[0];
      expect(prepared).toMatchObject({ status: 'PREPARED', classification: 'FULL' });
      expect(prepared.coverage.proposedAction).toBe('REVIEW');
      expect(prepared.per_currency_scopes.SAR.valueCoveragePercent).toBe(0);
      await approverClient.query('SELECT public.internal_verify_result_finalize($1,$2,$3)', [approver, result, id()]);
      expect((await owner.query('SELECT status FROM verify_results WHERE id=$1', [result])).rows[0].status).toBe('FINAL');
      expect((await owner.query('SELECT count(*)::int AS count FROM procurement_needs')).rows[0].count).toBe(beforeProcurement);
    } finally {
      await partner.end(); await system.end(); await internal.end(); await approverClient.end();
    }
  });
});
