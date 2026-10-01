import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import argon2 from 'argon2';
import { AppModule } from '../../src/app.module.js';

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

async function getResult(cookie: string | undefined, requestId: string, companyId?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/partner/verify/requests/${requestId}/result`,
    headers: { ...(cookie ? { cookie } : {}), ...(companyId ? { 'x-sco-company-id': companyId } : {}) },
  });
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
  await grant(scoUser, scoCompany, 'partner_verify.read');
  await grant(writer, partnerCompany, 'partner_verify.write');
  await grant(analyst, scoCompany, 'verify.analyst');
  await grant(approver, scoCompany, 'verify.approver');

  // Build one authorized FINAL request end-to-end via the existing approved gateway chain (no new lifecycle).
  const partner = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
  await partner.connect();
  await partner.query(`SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false)`, [writer, partnerCompany]);
  let revision: string;
  try {
    request = (await partner.query('SELECT partner_verify_request_create($1,$2,$3) request_id', [writer, partnerCompany, id()])).rows[0].request_id;
    const line = [{ lineNumber: 1, itemDescription: 'HTTP line', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 10, isPriceBearing: true }];
    revision = (await partner.query(
      `SELECT partner_verify_revision_create($1,$2,$3,$4,$5::text[],$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12) revision_id`,
      [writer, partnerCompany, request, null, ['SAR'], JSON.stringify({}), null, null, `http-input-${id()}`, JSON.stringify(line), `http-key-${id()}`, id()],
    )).rows[0].revision_id;
    const lineId = (await owner.query('SELECT id FROM verify_quote_lines WHERE verify_quote_revision_id=$1', [revision])).rows[0].id;
    await partner.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, partnerCompany, lineId, 'READY_FOR_VERIFICATION', null, id()]);
    await partner.query('SELECT partner_verify_request_submit($1,$2,$3,$4,$5)', [writer, partnerCompany, request, revision, id()]);
  } finally { await partner.end(); }

  const lineId = (await owner.query('SELECT id FROM verify_quote_lines WHERE verify_quote_revision_id=$1', [revision!])).rows[0].id;
  const run = (await system.query('SELECT internal_verify_system_run_create($1,$2,$3,$4,$5) run_id', [revision!, 'verify-v0.1', `ev-http-${id()}`, null, id()])).rows[0].run_id;
  await system.query('SELECT internal_verify_system_run_start($1,$2)', [run, id()]);
  await system.query('SELECT internal_verify_system_line_result_record($1,$2,$3,$4,$5,$6) result_id', [run, lineId, 'VERIFIED', null, null, id()]);
  await system.query('SELECT internal_verify_system_run_complete($1,$2)', [run, id()]);

  await internal.query(`SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false)`, [analyst, scoCompany]);
  const result = (await internal.query('SELECT internal_verify_result_prepare_computed($1,$2,$3,$4) result_id', [analyst, run, null, id()])).rows[0].result_id;
  await internal.query(`SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false)`, [approver, scoCompany]);
  await internal.query('SELECT internal_verify_result_finalize($1,$2,$3)', [approver, result, id()]);

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
    expect(Object.keys(body).sort()).toEqual(['classification', 'coverage', 'finalizedAt', 'requestId', 'resultId', 'revisionId', 'runId', 'status'].sort());
    expect(body.requestId).toBe(request);
    expect(body.classification).toBe('FULL');
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
