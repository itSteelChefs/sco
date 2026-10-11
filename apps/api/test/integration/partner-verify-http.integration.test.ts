import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import argon2 from 'argon2';
import { AppModule } from '../../src/app.module.js';
import { establishClassDPartnerEligibility } from '../database/class-d-eligibility.fixture.js';

// P3: HTTP-level wiring test proving the actual guard/decorator chain (AuthGuard, TenantGuard, PartnerCompanyGuard,
// PermissionGuard, @RequirePermission) on the real route, using the same Test.createTestingModule + Fastify
// app.inject() pattern already established by test/integration/security-gate.integration.test.ts.

const id = () => randomUUID();
const password = randomBytes(32).toString('base64url');

let app: NestFastifyApplication;
let owner: Client;
let system: Client;
let internal: Client;

let partnerCompany: string; let scoCompany: string;
let authorizedUser: string; let noPermissionUser: string; let scoUser: string;
let analyst: string; let approver: string; let writer: string;
let request: string; let unitId: string;
let foreignPartner: string; let foreignWriter: string; let foreignReader: string; let foreignRequest: string;
let suspendedPartner: string; let suspendedUser: string; let noBcPartner: string; let noBcUser: string;
let agreementPartner: string; let agreementUser: string;

async function grant(userId: string, companyId: string, code: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, companyId])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, companyId, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), companyId, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), companyId, role, code]);
}

async function login(email: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(response.statusCode).toBe(201);
  return response.headers['set-cookie'] as string;
}

async function getResult(cookie: string | undefined, requestId: string, companyId?: string, extra: { headers?: Record<string, string>; query?: string } = {}) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/partner/verify/requests/${requestId}/result${extra.query ?? ''}`,
    headers: { ...(cookie ? { cookie } : {}), ...(companyId ? { 'x-sco-company-id': companyId } : {}), ...(extra.headers ?? {}) },
  });
}

async function auditRows(actorUserId: string, action: string) {
  return (await owner.query(
    `SELECT metadata, authorization_decision, purpose_code FROM audit_logs WHERE actor_user_id=$1 AND action=$2 ORDER BY created_at DESC, id DESC`,
    [actorUserId, action],
  )).rows as Array<{ metadata: Record<string, unknown>; authorization_decision: string; purpose_code: string }>;
}

// Builds one FINAL request end-to-end via the existing approved gateway chain (no new lifecycle).
async function buildFinalRequest(companyId: string, writerUser: string): Promise<string> {
  const partner = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
  await partner.connect();
  await partner.query(`SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false)`, [writerUser, companyId]);
  let requestId: string;
  let revision: string;
  try {
    requestId = (await partner.query('SELECT partner_verify_request_create($1,$2,$3) request_id', [writerUser, companyId, id()])).rows[0].request_id;
    const line = [{ lineNumber: 1, itemDescription: 'HTTP line', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 10, isPriceBearing: true }];
    revision = (await partner.query(
      `SELECT partner_verify_revision_create($1,$2,$3,$4,$5::text[],$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12) revision_id`,
      [writerUser, companyId, requestId, null, ['SAR'], JSON.stringify({}), null, null, `http-input-${id()}`, JSON.stringify(line), `http-key-${id()}`, id()],
    )).rows[0].revision_id;
    const lineId = (await owner.query('SELECT id FROM verify_quote_lines WHERE verify_quote_revision_id=$1', [revision])).rows[0].id;
    await partner.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writerUser, companyId, lineId, 'READY_FOR_VERIFICATION', null, id()]);
    await partner.query('SELECT partner_verify_request_submit($1,$2,$3,$4,$5)', [writerUser, companyId, requestId, revision, id()]);
  } finally { await partner.end(); }

  const lineId = (await owner.query('SELECT id FROM verify_quote_lines WHERE verify_quote_revision_id=$1', [revision])).rows[0].id;
  const run = (await system.query('SELECT internal_verify_system_run_create($1,$2,$3,$4,$5) run_id', [revision, 'verify-v0.1', `ev-http-${id()}`, null, id()])).rows[0].run_id;
  await system.query('SELECT internal_verify_system_run_start($1,$2)', [run, id()]);
  await system.query('SELECT internal_verify_system_line_result_record($1,$2,$3,$4,$5,$6) result_id', [run, lineId, 'VERIFIED', null, null, id()]);
  await system.query('SELECT internal_verify_system_run_complete($1,$2)', [run, id()]);

  await internal.query(`SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false)`, [analyst, scoCompany]);
  const result = (await internal.query('SELECT internal_verify_result_prepare_computed($1,$2,$3,$4) result_id', [analyst, run, null, id()])).rows[0].result_id;
  await internal.query(`SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false)`, [approver, scoCompany]);
  await internal.query('SELECT internal_verify_result_finalize($1,$2,$3)', [approver, result, id()]);
  return requestId;
}

async function createLoginUser(companyId: string, permissions: string[], classD: boolean) {
  const userId = id();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,'ACTIVE')`, [userId, `${userId}@http-1e.test`, passwordHash]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
  for (const permission of permissions) await grant(userId, companyId, permission);
  if (classD) await establishClassDPartnerEligibility(owner, userId, companyId);
  return userId;
}

async function createPartner(label: string) {
  const companyId = id();
  await owner.query(`INSERT INTO "Company"(id,name,type) VALUES($1,$2,'PARTNER')`, [companyId, `HTTP ${label}`]);
  return companyId;
}

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  system = new Client({ connectionString: process.env.VERIFY_SYSTEM_DATABASE_URL });
  await system.connect();
  internal = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
  await internal.connect();

  // Defensive, idempotent: another test/integration file's blanket "DELETE FROM User" (unrelated to Batch 1-E)
  // can run first in the same vitest invocation and remove the migration-seeded SYSTEM actor this suite depends on.
  await owner.query(
    `INSERT INTO "User"(id,email,"passwordHash",status) VALUES ('00000000-0000-4000-9000-000000005357','verify-system@sco.internal','SYSTEM_ACCOUNT_NO_LOGIN_NOT_A_REAL_HASH','ACTIVE') ON CONFLICT (id) DO NOTHING`,
  );

  partnerCompany = id(); scoCompany = id(); unitId = id();
  authorizedUser = id(); noPermissionUser = id(); scoUser = id(); analyst = id(); approver = id(); writer = id();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  await owner.query(`INSERT INTO "Company"(id,name,type) VALUES($1,'HTTP Partner','PARTNER'),($2,'HTTP Internal','SCO')`, [partnerCompany, scoCompany]);
  await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,\'Each\',\'count\')', [unitId, `http-1e-${unitId}`]);
  const users = [authorizedUser, noPermissionUser, scoUser, analyst, approver, writer];
  await owner.query(
    `INSERT INTO "User"(id,email,"passwordHash",status) SELECT value::uuid, value || '@http-1e.test', $2, 'ACTIVE' FROM unnest($1::text[]) value`,
    [users, passwordHash],
  );
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), authorizedUser, partnerCompany]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), noPermissionUser, partnerCompany]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), scoUser, scoCompany]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), analyst, scoCompany]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), approver, scoCompany]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), writer, partnerCompany]);

  await grant(authorizedUser, partnerCompany, 'partner_verify.read');
  await establishClassDPartnerEligibility(owner, authorizedUser, partnerCompany);
  await grant(scoUser, scoCompany, 'partner_verify.read');
  await grant(writer, partnerCompany, 'partner_verify.write');
  await grant(analyst, scoCompany, 'verify.analyst');
  await grant(approver, scoCompany, 'verify.approver');

  request = await buildFinalRequest(partnerCompany, writer);

  foreignPartner = await createPartner('Foreign Partner');
  foreignWriter = await createLoginUser(foreignPartner, ['partner_verify.write'], false);
  foreignReader = await createLoginUser(foreignPartner, ['partner_verify.read'], true);
  foreignRequest = await buildFinalRequest(foreignPartner, foreignWriter);

  suspendedPartner = await createPartner('Suspended Partner');
  suspendedUser = await createLoginUser(suspendedPartner, ['partner_verify.read'], true);
  noBcPartner = await createPartner('No Binding Confidentiality Partner');
  noBcUser = await createLoginUser(noBcPartner, ['partner_verify.read', 'partner.portal.read'], false);
  await owner.query(`INSERT INTO company_partnerships(company_id,type,status) VALUES($1,'BUYER_PARTNERSHIP','ACTIVE')`, [noBcPartner]);
  agreementPartner = await createPartner('Agreement State Partner');
  agreementUser = await createLoginUser(agreementPartner, ['partner_verify.read'], true);

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  // Verify history (verify_requests/.../verify_results) is immutable by design (existing 1-D invariant, unrelated
  // to Batch 1-E) -- it cannot be deleted here even for test cleanup, so this suite only tears down connections.
  // Note: a pre-existing, unrelated file (test/integration/security-gate.integration.test.ts) performs a blanket
  // "DELETE FROM \"User\"" as part of its own setup; since Verify's immutable audit trail can reference any User
  // row, that blanket delete can fail with an FK violation if it runs after this suite's fixtures exist in the same
  // vitest invocation. This is a pre-existing test-isolation characteristic of that other file (any Verify-creating
  // test collides with it the same way), not something introduced by or fixable from within this file; run this
  // suite standalone (`vitest run test/integration/partner-verify-http.integration.test.ts`) for a deterministic
  // result, as already validated.
  await owner?.end();
  await system?.end();
  await internal?.end();
});

describe('Batch 1-E P3: HTTP-level guard/decorator wiring for GET /api/v1/partner/verify/requests/:requestId/result', () => {
  it('missing authentication is denied', async () => {
    const response = await getResult(undefined, request);
    expect(response.statusCode).toBe(401);
  });

  it('missing partner_verify.read is denied', async () => {
    const cookie = await login(`${noPermissionUser}@http-1e.test`);
    const response = await getResult(cookie, request, partnerCompany);
    expect(response.statusCode).toBe(403);
  });

  it('valid Partner authorization succeeds and returns the explicit allowlisted DTO', async () => {
    const cookie = await login(`${authorizedUser}@http-1e.test`);
    const response = await getResult(cookie, request, partnerCompany);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Object.keys(body).sort()).toEqual([
      'classification',
      'confidence',
      'coverage',
      'finalizedAt',
      'gap',
      'offerValue',
      'proposedAction',
      'requestId',
      'resultId',
      'revisionId',
      'runId',
      'status',
      'verifiedReferenceScope',
    ].sort());
    expect(body.requestId).toBe(request);
    expect(body.classification).toBe('FULL');
    expect(body).toHaveProperty('proposedAction');
  });

  it('a non-PARTNER (SCO) company actor is denied', async () => {
    const cookie = await login(`${scoUser}@http-1e.test`);
    const response = await getResult(cookie, request, scoCompany);
    expect(response.statusCode).toBe(403);
  });

  it('a foreign/unauthorized request ID does not expose data (safe not-found, not a distinguishing error)', async () => {
    const cookie = await login(`${authorizedUser}@http-1e.test`);
    const response = await getResult(cookie, id(), partnerCompany);
    expect(response.statusCode).toBe(404);
  });
});

describe('H1 real HTTP adversarial coverage for GET /api/v1/partner/verify/requests/:requestId/result', () => {
  it('eligible Partner succeeds and the allowed audit is written only for the final allow, with the registry VERIFY purpose', async () => {
    const cookie = await login(`${authorizedUser}@http-1e.test`);
    const before = (await auditRows(authorizedUser, 'authorization.purpose_allowed')).length;
    const response = await getResult(cookie, request, partnerCompany);
    expect(response.statusCode).toBe(200);
    const rows = await auditRows(authorizedUser, 'authorization.purpose_allowed');
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ authorization_decision: 'ALLOWED', purpose_code: 'PUR-14' });
  });

  it('missing the exact permission denies, even for a writer in the same Partner company (partner_verify.write is not read)', async () => {
    const cookie = await login(`${writer}@http-1e.test`);
    expect((await getResult(cookie, request, partnerCompany)).statusCode).toBe(403);
    const rows = await auditRows(writer, 'authorization.operation_denied');
    expect(rows[0].metadata).toMatchObject({ operation: 'partner_verify.result.read', reason: 'PERMISSION_MISSING', failedLayer: 'PERMISSION' });
  });

  it('a malformed request id denies fail-closed and is attributed to its own request as RESOURCE_CONTEXT_MALFORMED', async () => {
    const cookie = await login(`${authorizedUser}@http-1e.test`);
    const before = (await auditRows(authorizedUser, 'authorization.operation_denied')).length;
    const response = await getResult(cookie, 'not-a-uuid', partnerCompany);
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({ error: { code: 'FORBIDDEN' } });
    const rows = await auditRows(authorizedUser, 'authorization.operation_denied');
    expect(rows.length).toBe(before + 1);
    expect(rows[0].metadata).toMatchObject({ reason: 'RESOURCE_CONTEXT_MALFORMED', failedLayer: 'RESOURCE_CONTEXT' });
  });

  it('an existing foreign request is indistinguishable from a non-existent one (safe not-found, no body difference)', async () => {
    const cookie = await login(`${authorizedUser}@http-1e.test`);
    const foreign = await getResult(cookie, foreignRequest, partnerCompany);
    const absent = await getResult(cookie, id(), partnerCompany);
    expect(foreign.statusCode).toBe(404);
    expect(absent.statusCode).toBe(404);
    expect(foreign.body).toBe(absent.body);
    expect(foreign.body).not.toContain(foreignRequest);
  });

  it('resource substitution: request A authority cannot read request B, in either direction, and each owner still reads its own', async () => {
    const aCookie = await login(`${authorizedUser}@http-1e.test`);
    const bCookie = await login(`${foreignReader}@http-1e.test`);
    expect((await getResult(aCookie, request, partnerCompany)).statusCode).toBe(200);
    expect((await getResult(bCookie, foreignRequest, foreignPartner)).statusCode).toBe(200);
    expect((await getResult(aCookie, foreignRequest, partnerCompany)).statusCode).toBe(404);
    expect((await getResult(bCookie, request, foreignPartner)).statusCode).toBe(404);
  });

  it('a foreign company header cannot widen access (no membership there, or wrong company type)', async () => {
    const aCookie = await login(`${authorizedUser}@http-1e.test`);
    expect((await getResult(aCookie, foreignRequest, foreignPartner)).statusCode).toBe(403);
    expect((await getResult(aCookie, request, scoCompany)).statusCode).toBe(403);
    const scoCookie = await login(`${scoUser}@http-1e.test`);
    expect((await getResult(scoCookie, request, partnerCompany)).statusCode).toBe(403);
    expect((await getResult(aCookie, request, 'not-a-uuid')).statusCode).toBe(403);
  });

  it('a suspended Partner is denied at PARTNER_ELIGIBILITY and the denial is not recorded as a purpose success', async () => {
    const cookie = await login(`${suspendedUser}@http-1e.test`);
    expect((await getResult(cookie, request, suspendedPartner)).statusCode).toBe(404);
    await owner.query(`UPDATE company_partnerships SET status='SUSPENDED' WHERE company_id=$1 AND type='BUYER_PARTNERSHIP'`, [suspendedPartner]);
    const allowedBefore = (await auditRows(suspendedUser, 'authorization.purpose_allowed')).length;
    expect((await getResult(cookie, request, suspendedPartner)).statusCode).toBe(403);
    expect((await auditRows(suspendedUser, 'authorization.purpose_allowed')).length).toBe(allowedBefore);
    expect((await auditRows(suspendedUser, 'authorization.operation_denied'))[0].metadata).toMatchObject({ reason: 'PARTNER_NOT_ELIGIBLE', failedLayer: 'PARTNER_ELIGIBILITY' });
  });

  it('a Partner without Binding Confidentiality is denied despite an ACTIVE partnership, portal access and permission', async () => {
    const cookie = await login(`${noBcUser}@http-1e.test`);
    expect((await getResult(cookie, request, noBcPartner)).statusCode).toBe(403);
    expect((await auditRows(noBcUser, 'authorization.operation_denied'))[0].metadata).toMatchObject({ reason: 'PARTNER_NOT_ELIGIBLE' });
  });

  it('an agreement acceptance that is no longer in a satisfying state (SUSPENDED event) denies', async () => {
    const cookie = await login(`${agreementUser}@http-1e.test`);
    expect((await getResult(cookie, request, agreementPartner)).statusCode).toBe(404);
    const acceptance = (await owner.query<{ id: string }>('SELECT id FROM partner_agreement_acceptances WHERE company_id=$1', [agreementPartner])).rows[0].id;
    await owner.query(
      `INSERT INTO partner_agreement_acceptance_events(acceptance_id, company_id, status, actor_user_id, correlation_id) VALUES ($1,$2,'SUSPENDED',$3,$4)`,
      [acceptance, agreementPartner, agreementUser, id()],
    );
    expect((await getResult(cookie, request, agreementPartner)).statusCode).toBe(403);
    expect((await auditRows(agreementUser, 'authorization.operation_denied'))[0].metadata).toMatchObject({ reason: 'PARTNER_NOT_ELIGIBLE' });
  });

  it('forged purpose headers and query claims cannot change the registry-owned VERIFY purpose', async () => {
    const cookie = await login(`${authorizedUser}@http-1e.test`);
    const response = await getResult(cookie, request, partnerCompany, {
      headers: { 'x-sco-purpose': 'PUR-02', 'x-purpose': 'PUR-02', 'x-purpose-code': 'PUR-02' },
      query: '?purpose=PUR-02&purposeCode=PUR-02&flow=CPF_02',
    });
    expect(response.statusCode).toBe(200);
    expect((await auditRows(authorizedUser, 'authorization.purpose_allowed'))[0].purpose_code).toBe('PUR-14');

    const denied = await login(`${noPermissionUser}@http-1e.test`);
    const forgedDenied = await getResult(denied, request, partnerCompany, { headers: { 'x-sco-purpose': 'PUR-14' }, query: '?purpose=PUR-14' });
    expect(forgedDenied.statusCode).toBe(403);
  });
});
