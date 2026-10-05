import { randomBytes, randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import argon2 from 'argon2';
import { AppModule } from '../../src/app.module.js';

// H2-OD-02: an ACTIVE relationship whose required agreement later needs reacceptance stays ACTIVE (no commercial state
// mutation) while operational procurement access is RESTRICTED and Class D stays denied. This file temporarily
// publishes a reacceptance-required policy, so it lives in the sequential database suite and fully restores state.

const id = () => randomUUID();
const password = randomBytes(32).toString('base64url');
const V1 = `h2-v1-${randomUUID()}`;
const V2 = `h2-v2-${randomUUID()}`;

let app: NestFastifyApplication;
let owner: Client;
let internal: Pool;
let scoCompany: string; let scoOperator: string;
let companyId: string; let userId: string; let partnershipId: string;
const policyIds: string[] = [];

async function grant(user: string, company: string, code: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [user, company])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, company, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), company, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), company, role, code]);
}

async function createCompany(type: 'PARTNER' | 'SCO') {
  const company = id();
  await owner.query(`INSERT INTO "Company"(id,name,type) VALUES($1,$2,$3)`, [company, `H2 reaccept ${type}`, type]);
  return company;
}

async function createUser(company: string, permissions: string[]) {
  const user = id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,'ACTIVE')`, [user, `${user}@h2-reaccept.test`, await argon2.hash(password, { type: argon2.argon2id })]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), user, company]);
  for (const permission of permissions) await grant(user, company, permission);
  return user;
}

async function effectiveAfterLatest() {
  return (await owner.query<{ effective_at: Date }>(
    `SELECT GREATEST(TIMESTAMPTZ '2000-01-02 00:00:00+00', COALESCE(max(effective_at), TIMESTAMPTZ '2000-01-02 00:00:00+00')) + interval '1 millisecond' AS effective_at
       FROM partner_agreement_policy_versions WHERE agreement_type='BINDING_CONFIDENTIALITY' AND state IN ('PUBLISHED','SUSPENDED','TERMINATED')`,
  )).rows[0].effective_at;
}

async function publishPolicy(version: string, reacceptance: boolean) {
  const effectiveAt = await effectiveAfterLatest();
  const created = (await internal.query(
    `SELECT * FROM public.internal_partner_agreement_policy_create($1,'BINDING_CONFIDENTIALITY',$2,$3,$4,'partner.agreement.accept',$5,'NO_ACCESS_CHANGE','NO_ACCESS_CHANGE','H2_REACCEPT_TEST',true,$6)`,
    [scoOperator, version, `H2 reacceptance test ${version}`, effectiveAt.toISOString(), reacceptance, id()],
  )).rows[0];
  await internal.query('SELECT * FROM public.internal_partner_agreement_policy_publish($1,$2,$3)', [scoOperator, created.id, id()]);
  policyIds.push(created.id);
  return created.id as string;
}

async function login() {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${userId}@h2-reaccept.test`, password } });
  expect(response.statusCode).toBe(201);
  return response.headers['set-cookie'] as string;
}

const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie, 'x-sco-company-id': companyId } });
const accept = (cookie: string, version: string) => app.inject({
  method: 'POST', url: '/api/v1/partner/admission/agreements/accept', headers: { cookie, 'x-sco-company-id': companyId },
  payload: { agreementType: 'BINDING_CONFIDENTIALITY', versionCode: version, idempotencyKey: `h2-reaccept-${id()}` },
});

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
  scoCompany = await createCompany('SCO');
  scoOperator = await createUser(scoCompany, ['qualification.manage', 'partnership.manage', 'agreement.policy.manage']);
  companyId = await createCompany('PARTNER');
  userId = await createUser(companyId, ['partner.admission.read', 'partner.agreement.accept', 'partner.portal.read', 'partner_verify.read', 'procurement_document.extract']);

  await publishPolicy(V1, false);
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const qualification = (await internal.query('SELECT * FROM public.internal_qualification_create_for_company($1,$2,$3,$4)', [scoOperator, companyId, 'H2 Reaccept Ltd', 'h2r@example.test'])).rows[0];
  await internal.query('SELECT * FROM public.internal_qualification_decide($1,$2,$3,$4)', [scoOperator, qualification.id, 'APPROVED', 'ok']);
  partnershipId = (await internal.query('SELECT * FROM public.internal_partnership_create($1,$2,$3)', [scoOperator, companyId, 'BUYER_PARTNERSHIP'])).rows[0].id;
  expect((await accept(await login(), V1)).statusCode).toBe(201);
  await internal.query('SELECT * FROM public.internal_partnership_approve($1,$2,$3,$4)', [scoOperator, partnershipId, 'ok', id()]);
  await internal.query('SELECT * FROM public.internal_partnership_activate($1,$2)', [scoOperator, partnershipId]);
});

afterAll(async () => {
  await app?.close();
  // Restore the shared policy state: remove this file's policies and un-supersede whatever they superseded.
  try {
    const ids = policyIds;
    if (ids.length) {
      await owner.query(`DELETE FROM partner_agreement_acceptance_events WHERE acceptance_id IN (SELECT id FROM partner_agreement_acceptances WHERE policy_version_id = ANY($1::uuid[]))`, [ids]);
      await owner.query(`DELETE FROM partner_agreement_acceptances WHERE policy_version_id = ANY($1::uuid[])`, [ids]);
      await owner.query(`UPDATE partner_agreement_policy_versions SET superseded_at=NULL, superseded_by_policy_id=NULL WHERE superseded_by_policy_id = ANY($1::uuid[]) AND NOT (id = ANY($1::uuid[]))`, [ids]);
      await owner.query(`UPDATE partner_agreement_policy_versions SET supersedes_policy_id=NULL, superseded_by_policy_id=NULL WHERE id = ANY($1::uuid[])`, [ids]);
      await owner.query(`DELETE FROM partner_agreement_policy_events WHERE policy_version_id = ANY($1::uuid[])`, [ids]);
      await owner.query(`DELETE FROM partner_agreement_policy_versions WHERE id = ANY($1::uuid[])`, [ids]);
    }
  } finally {
    await internal?.end();
    await owner?.end();
  }
});

describe('H2-OD-02 ACTIVE relationship vs operational procurement access', () => {
  it('starts ACTIVE and AVAILABLE', async () => {
    const cookie = await login();
    const body = JSON.parse((await get(cookie, '/api/v1/partner/journey')).body);
    expect(body.relationship).toMatchObject({ stage: 'ACTIVE', partnership: 'ACTIVE', agreementsSatisfied: true });
    expect(body.operational).toEqual({ procurementAccess: 'AVAILABLE' });
    expect((await get(cookie, `/api/v1/partner/verify/requests/${id()}/result`)).statusCode).toBe(404);
  });

  it('a reacceptance-required version restricts operational access without mutating the commercial relationship', async () => {
    const cookie = await login();
    const eventsBefore = Number((await owner.query('SELECT count(*)::int AS count FROM company_partnership_events WHERE company_id=$1', [companyId])).rows[0].count);
    await publishPolicy(V2, true);

    const response = await get(cookie, '/api/v1/partner/journey');
    const body = JSON.parse(response.body);
    expect(body.relationship).toMatchObject({ stage: 'ACTIVE', partnership: 'ACTIVE', agreementsSatisfied: false });
    expect(body.relationship.pendingAgreements).toEqual([{ agreementType: 'BINDING_CONFIDENTIALITY', version: V2, status: 'REACCEPTANCE_REQUIRED', actionable: true }]);
    expect(body.operational).toEqual({ procurementAccess: 'RESTRICTED', reason: 'AGREEMENT_REQUIRED' });
    expect(body.experiences.find((entry: { code: string }) => entry.code === 'PROCUREMENT')).toMatchObject({ enterable: false, reason: 'AGREEMENT_REQUIRED' });
    expect(body.capabilities.find((entry: { code: string }) => entry.code === 'VERIFY_RESULT_READ')).toMatchObject({ available: false, reason: 'AGREEMENT_REQUIRED' });
    expect(body.nextAction).toEqual({ code: 'ACCEPT_AGREEMENTS', owner: 'PARTNER', permitted: true });

    // Class D stays denied on the very next operation, on both H1 routes.
    expect((await get(cookie, `/api/v1/partner/verify/requests/${id()}/result`)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/procurement-documents/${id()}/extract`, headers: { cookie, 'x-sco-company-id': companyId }, payload: { lines: [] } })).statusCode).toBe(403);

    // The authoritative commercial relationship is untouched: same status, no new lifecycle event.
    expect((await owner.query('SELECT status FROM company_partnerships WHERE id=$1', [partnershipId])).rows[0].status).toBe('ACTIVE');
    expect(Number((await owner.query('SELECT count(*)::int AS count FROM company_partnership_events WHERE company_id=$1', [companyId])).rows[0].count)).toBe(eventsBefore);
    // Class B/C remediation remains available.
    expect((await get(cookie, '/api/v1/partner/admission/status')).statusCode).toBe(200);
    expect((await get(cookie, '/api/v1/partner/me')).statusCode).toBe(200);
  });

  it('accepting the current version restores operational access on the next request, again without touching the relationship', async () => {
    const cookie = await login();
    expect((await accept(cookie, V2)).statusCode).toBe(201);
    const body = JSON.parse((await get(cookie, '/api/v1/partner/journey')).body);
    expect(body.relationship).toMatchObject({ stage: 'ACTIVE', partnership: 'ACTIVE', agreementsSatisfied: true, pendingAgreements: [] });
    expect(body.operational).toEqual({ procurementAccess: 'AVAILABLE' });
    expect(body.nextAction).toEqual({ code: 'NONE', owner: 'NONE', permitted: true });
    expect((await get(cookie, `/api/v1/partner/verify/requests/${id()}/result`)).statusCode).toBe(404);
  });
});
