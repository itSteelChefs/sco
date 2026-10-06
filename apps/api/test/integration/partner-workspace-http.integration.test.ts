import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import argon2 from 'argon2';
import { AppModule } from '../../src/app.module.js';
import { establishClassDPartnerEligibility } from '../database/class-d-eligibility.fixture.js';
import { AUTHORIZATION_OPERATION, operationDescriptor, registryInvariantViolations } from '../../src/modules/authorization/authorization-operations.js';
import { PURPOSE_REQUIREMENT } from '../../src/modules/rbac/purpose-registry.js';
import { composeCapabilityStates } from '../../src/modules/workspaces/workspace-capability-composition.js';
import { DEFAULT_WORKSPACE_CAPABILITIES, validateWorkspaceCapabilityRegistry } from '../../src/modules/workspaces/workspace-capability-registry.js';

// Real HTTP coverage of GET/POST /api/v1/partner/workspace/current through the actual controller, H1 guard, service
// and tenant RLS. Capability mapping is injected through the registry token so the production registry stays minimal.

const id = () => randomUUID();
const password = randomBytes(32).toString('base64url');
const REGISTRY_TOKEN = 'WORKSPACE_CAPABILITY_REGISTRY';
const PLAIN = 'H3_TEST_PLAIN_SERVICE';
const SENSITIVE = 'H3_TEST_SENSITIVE_SERVICE';
const SUPPORT = 'PARTNER_CONTEXT_SUPPORT';
const UNKNOWN = 'H3_UNMAPPED_SERVICE';
const testRegistry = [
  { serviceCode: PLAIN, capability: 'TEST_PLAIN', requiredPermission: 'partner_verify.read', requiresOperationalAccess: false },
  { serviceCode: SENSITIVE, capability: 'TEST_SENSITIVE', requiredPermission: 'procurement_document.extract', requiresOperationalAccess: true },
];

let app: NestFastifyApplication;
let owner: Client;
let partnerA: string; let partnerB: string; let scoCompany: string;
let fullUser: string; let portalOnlyUser: string; let noPermissionUser: string; let scoUser: string; let multiUser: string;
let onboardingCompany: string; let onboardingUser: string; let restrictedCompany: string; let restrictedUser: string;

async function grant(userId: string, companyId: string, code: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, companyId])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, companyId, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), companyId, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), companyId, role, code]);
}

async function revokePermission(userId: string, companyId: string, code: string) {
  const result = await owner.query(
    `DELETE FROM "RolePermission" rp USING "Permission" p, "MembershipRole" mr, "CompanyMembership" cm
      WHERE rp.permission_id = p.id AND p.code = $3 AND mr.role_id = rp.role_id AND mr.membership_id = cm.id
        AND cm."userId" = $1 AND cm."companyId" = $2`,
    [userId, companyId, code],
  );
  expect(result.rowCount).toBeGreaterThan(0);
}

async function createCompany(label: string, type: 'PARTNER' | 'SCO') {
  const companyId = id();
  await owner.query(`INSERT INTO "Company"(id,name,type) VALUES($1,$2,$3)`, [companyId, `H3 ${label}`, type]);
  return companyId;
}

async function createUser(companyId: string, permissions: string[], classD = false) {
  const userId = id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,'ACTIVE')`, [userId, `${userId}@h3.test`, await argon2.hash(password, { type: argon2.argon2id })]);
  await join(userId, companyId, permissions);
  if (classD) await establishClassDPartnerEligibility(owner, userId, companyId);
  return userId;
}

async function join(userId: string, companyId: string, permissions: string[]) {
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
  for (const permission of permissions) await grant(userId, companyId, permission);
}

async function entitle(companyId: string, serviceCode: string, state: 'ACTIVE' | 'DISABLED' | 'REVOKED' = 'ACTIVE') {
  await owner.query(
    `INSERT INTO service_entitlements(company_id,service_code,state,changed_by) VALUES($1,$2,$3::"ServiceEntitlementState",$4)
     ON CONFLICT (company_id, service_code) DO UPDATE SET state=EXCLUDED.state`,
    [companyId, serviceCode, state, fullUser ?? (await owner.query(`SELECT id FROM "User" LIMIT 1`)).rows[0].id],
  );
}

async function login(userId: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${userId}@h3.test`, password } });
  expect(response.statusCode).toBe(201);
  return response.headers['set-cookie'] as string;
}

const call = (method: 'GET' | 'POST', cookie: string | undefined, companyId?: string, extra: Record<string, string> = {}, url = '/api/v1/partner/workspace/current') =>
  app.inject({ method, url, headers: { ...(cookie ? { cookie } : {}), ...(companyId ? { 'x-sco-company-id': companyId } : {}), ...extra }, ...(method === 'POST' ? { payload: {} } : {}) });

const getWorkspace = (cookie: string | undefined, companyId?: string, extra: Record<string, string> = {}) => call('GET', cookie, companyId, extra);
const provision = (cookie: string | undefined, companyId?: string, extra: Record<string, string> = {}) => call('POST', cookie, companyId, extra);

async function auditRows(actorUserId: string, action: string) {
  return (await owner.query(
    `SELECT metadata, authorization_decision, purpose_code, entity_type FROM audit_logs WHERE actor_user_id=$1 AND action=$2 ORDER BY created_at DESC, id DESC`,
    [actorUserId, action],
  )).rows as Array<{ metadata: Record<string, unknown>; authorization_decision: string; purpose_code: string; entity_type: string | null }>;
}

const workspaceCount = async (companyId: string) => Number((await owner.query('SELECT count(*)::int AS count FROM partner_workspaces WHERE company_id=$1', [companyId])).rows[0].count);

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  partnerA = await createCompany('Partner A', 'PARTNER');
  partnerB = await createCompany('Partner B', 'PARTNER');
  scoCompany = await createCompany('SCO', 'SCO');
  fullUser = await createUser(partnerA, ['partner.portal.read', 'partner_verify.read', 'procurement_document.extract'], true);
  portalOnlyUser = await createUser(partnerA, ['partner.portal.read']);
  noPermissionUser = await createUser(partnerA, ['procurement_document.extract']);
  scoUser = await createUser(scoCompany, ['partner.portal.read']);
  multiUser = await createUser(partnerA, ['partner.portal.read']);
  await join(multiUser, partnerB, ['partner.portal.read']);
  // Onboarding Partner: portal access only, no ACTIVE relationship, no agreement.
  onboardingCompany = await createCompany('Onboarding Partner', 'PARTNER');
  onboardingUser = await createUser(onboardingCompany, ['partner.portal.read', 'partner_verify.read', 'procurement_document.extract']);
  // Restricted Partner: Class D eligible, then its agreement acceptance leaves a satisfying state.
  restrictedCompany = await createCompany('Restricted Partner', 'PARTNER');
  restrictedUser = await createUser(restrictedCompany, ['partner.portal.read', 'partner_verify.read', 'procurement_document.extract'], true);

  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REGISTRY_TOKEN).useValue(testRegistry)
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

describe('H3 workspace routes: controller composition, H1 authorization, final-outcome audit', () => {
  it('an eligible Partner can read (no workspace yet), provision, and provision again idempotently', async () => {
    const cookie = await login(fullUser);
    const first = await getWorkspace(cookie, partnerA);
    expect(first.statusCode).toBe(200);
    expect(first.body === '' || first.body === 'null').toBe(true);
    expect(await workspaceCount(partnerA)).toBe(0);

    const created = await provision(cookie, partnerA);
    expect(created.statusCode).toBe(201);
    const body = JSON.parse(created.body);
    expect(body).toMatchObject({ displayName: 'Partner Private Workspace', state: 'ACTIVE', version: 1 });
    const again = await provision(cookie, partnerA);
    expect(again.statusCode).toBe(201);
    expect(JSON.parse(again.body)).toMatchObject({ id: body.id, version: 1 });
    expect(await workspaceCount(partnerA)).toBe(1);
    expect((await auditRows(fullUser, 'partner_workspace.created')).length).toBe(1);

    const read = await getWorkspace(cookie, partnerA);
    expect(read.statusCode).toBe(200);
    expect(JSON.parse(read.body)).toMatchObject({ id: body.id });
  });

  it('the response exposes only the safe shell fields: no storage, project, document or service-access internals', async () => {
    const cookie = await login(fullUser);
    const response = await getWorkspace(cookie, partnerA);
    const body = JSON.parse(response.body);
    expect(Object.keys(body).sort()).toEqual(['capabilities', 'capabilityStates', 'displayName', 'id', 'state', 'version']);
    expect(response.body).not.toMatch(/storage|bucket|credential|project|document|supplier|margin|grant|decision/i);
  });

  it('exposes no workspace/project/document identifier routes', async () => {
    const cookie = await login(fullUser);
    for (const url of [`/api/v1/partner/workspace/${id()}`, '/api/v1/partner/workspace/projects', '/api/v1/partner/workspace/documents', `/api/v1/partner/workspace/current/${id()}`]) {
      expect((await call('GET', cookie, partnerA, {}, url)).statusCode).toBe(404);
    }
    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const response = await app.inject({ method, url: '/api/v1/partner/workspace/current', headers: { cookie, 'x-sco-company-id': partnerA }, payload: {} });
      expect(response.statusCode).toBe(404);
    }
  });

  it('a member without partner.portal.read is denied with a truthful operation_denied and no allowed event', async () => {
    const cookie = await login(noPermissionUser);
    const allowedBefore = (await auditRows(noPermissionUser, 'authorization.purpose_allowed')).length;
    const response = await getWorkspace(cookie, partnerA);
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({ error: { code: 'FORBIDDEN' } });
    expect((await provision(cookie, partnerA)).statusCode).toBe(403);
    expect((await auditRows(noPermissionUser, 'authorization.purpose_allowed')).length).toBe(allowedBefore);
    const denied = await auditRows(noPermissionUser, 'authorization.operation_denied');
    expect(denied[0].metadata).toMatchObject({ reason: 'PERMISSION_MISSING', failedLayer: 'PERMISSION' });
  });

  it('writes exactly one final authorization event per allowed request, with the registry purpose and tenant', async () => {
    const cookie = await login(portalOnlyUser);
    const before = (await auditRows(portalOnlyUser, 'authorization.purpose_allowed')).length;
    expect((await getWorkspace(cookie, partnerA, { 'x-sco-purpose': 'PUR-17' })).statusCode).toBe(200);
    const rows = await auditRows(portalOnlyUser, 'authorization.purpose_allowed');
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ authorization_decision: 'ALLOWED', purpose_code: 'PUR-02', entity_type: 'Company' });
    expect(rows[0].metadata).toMatchObject({});
    expect(JSON.stringify(rows[0].metadata)).not.toContain('PUR-17');
  });

  it('a non-Partner company is denied at the authorization boundary (403, never a 500) and creates nothing', async () => {
    const cookie = await login(scoUser);
    const allowedBefore = (await auditRows(scoUser, 'authorization.purpose_allowed')).length;
    const read = await getWorkspace(cookie, scoCompany);
    const created = await provision(cookie, scoCompany);
    expect(read.statusCode).toBe(403);
    expect(created.statusCode).toBe(403);
    expect(await workspaceCount(scoCompany)).toBe(0);
    expect((await auditRows(scoUser, 'authorization.purpose_allowed')).length).toBe(allowedBefore);
    expect((await auditRows(scoUser, 'authorization.operation_denied'))[0].metadata).toMatchObject({ reason: 'COMPANY_TYPE_INELIGIBLE' });
  });

  it('requires authentication, and a user only in A cannot use B', async () => {
    expect((await getWorkspace(undefined, partnerA)).statusCode).toBe(401);
    const cookie = await login(fullUser);
    expect((await getWorkspace(cookie, partnerB)).statusCode).toBe(403);
    expect((await provision(cookie, partnerB)).statusCode).toBe(403);
    expect((await getWorkspace(cookie, 'not-a-uuid')).statusCode).toBe(403);
    expect((await getWorkspace(cookie, id())).statusCode).toBe(403);
    expect(await workspaceCount(partnerB)).toBe(0);
  });

  it('a user in A and B is reauthorized on every request: each header yields only that company, and no header is ambiguous', async () => {
    const cookie = await login(multiUser);
    const a = JSON.parse((await provision(cookie, partnerA)).body);
    const b = JSON.parse((await provision(cookie, partnerB)).body);
    expect(a.id).not.toBe(b.id);
    expect(JSON.parse((await getWorkspace(cookie, partnerA)).body).id).toBe(a.id);
    expect(JSON.parse((await getWorkspace(cookie, partnerB)).body).id).toBe(b.id);
    expect(JSON.parse((await getWorkspace(cookie, partnerA)).body).id).toBe(a.id);
    expect((await getWorkspace(cookie)).statusCode).toBe(400);
    expect((await owner.query('SELECT count(*)::int AS count FROM partner_workspaces WHERE company_id IN ($1,$2)', [partnerA, partnerB])).rows[0].count).toBe(2);
  });

  it('a revoked membership is denied on the next request', async () => {
    const user = await createUser(partnerA, ['partner.portal.read']);
    const cookie = await login(user);
    expect((await getWorkspace(cookie, partnerA)).statusCode).toBe(200);
    await owner.query(`UPDATE "CompanyMembership" SET status='REVOKED' WHERE "userId"=$1 AND "companyId"=$2`, [user, partnerA]);
    expect((await getWorkspace(cookie, partnerA)).statusCode).toBe(403);
    expect((await provision(cookie, partnerA)).statusCode).toBe(403);
  });
});

describe('H3 capability projection: entitlement x permission x H2 operational state (advisory only)', () => {
  const states = (body: { capabilityStates: Array<{ capability: string }> }) => body.capabilityStates.map((entry) => entry.capability).sort();

  it('no entitlement: the shell succeeds and capabilities are empty', async () => {
    const cookie = await login(fullUser);
    const body = JSON.parse((await getWorkspace(cookie, partnerA)).body);
    expect(body.capabilities).toEqual([]);
    expect(body.capabilityStates).toEqual([]);
  });

  it('permission without entitlement: the capability is absent, even for a fully permitted user', async () => {
    const cookie = await login(fullUser);
    await entitle(partnerB, PLAIN);
    const body = JSON.parse((await getWorkspace(cookie, partnerA)).body);
    expect(states(body)).toEqual([]);
  });

  it('entitlement + required permission (+ operational access): mapped capabilities are visible and available', async () => {
    const cookie = await login(fullUser);
    await entitle(partnerA, PLAIN);
    await entitle(partnerA, SENSITIVE);
    const body = JSON.parse((await getWorkspace(cookie, partnerA)).body);
    expect(body.capabilities.sort()).toEqual(['TEST_PLAIN', 'TEST_SENSITIVE']);
    expect(body.capabilityStates).toEqual(expect.arrayContaining([
      { capability: 'TEST_PLAIN', available: true },
      { capability: 'TEST_SENSITIVE', available: true },
    ]));
    expect(body.capabilityStates.every((entry: Record<string, unknown>) => !('allowed' in entry))).toBe(true);
  });

  it('entitlement without the required permission: the capability is omitted for that user only', async () => {
    const cookie = await login(portalOnlyUser);
    const body = JSON.parse((await getWorkspace(cookie, partnerA)).body);
    expect(body.capabilities).toEqual([]);
    expect(body.capabilityStates).toEqual([]);
    const partial = await createUser(partnerA, ['partner.portal.read', 'partner_verify.read']);
    const partialBody = JSON.parse((await getWorkspace(await login(partial), partnerA)).body);
    expect(states(partialBody)).toEqual(['TEST_PLAIN']);
  });

  it('unknown and support-consent entitlement codes are never leaked', async () => {
    const cookie = await login(fullUser);
    await entitle(partnerA, SUPPORT);
    await entitle(partnerA, UNKNOWN);
    await entitle(partnerA, 'PARTNER_WORKSPACE_SUPPORT');
    const response = await getWorkspace(cookie, partnerA);
    expect(response.body).not.toMatch(/SUPPORT|H3_UNMAPPED|H3_TEST_/);
    expect(JSON.parse(response.body).capabilities.sort()).toEqual(['TEST_PLAIN', 'TEST_SENSITIVE']);
  });

  it('permission revoked: the next request no longer shows the capability', async () => {
    const user = await createUser(partnerA, ['partner.portal.read', 'partner_verify.read']);
    const cookie = await login(user);
    expect(states(JSON.parse((await getWorkspace(cookie, partnerA)).body))).toEqual(['TEST_PLAIN']);
    await revokePermission(user, partnerA, 'partner_verify.read');
    expect(states(JSON.parse((await getWorkspace(cookie, partnerA)).body))).toEqual([]);
  });

  it('entitlement revoked: the next request no longer shows the capability, and re-activation restores it', async () => {
    const cookie = await login(fullUser);
    await entitle(partnerA, PLAIN, 'REVOKED');
    expect(JSON.parse((await getWorkspace(cookie, partnerA)).body).capabilities).toEqual(['TEST_SENSITIVE']);
    await entitle(partnerA, SENSITIVE, 'DISABLED');
    expect(JSON.parse((await getWorkspace(cookie, partnerA)).body).capabilityStates).toEqual([]);
    await entitle(partnerA, PLAIN);
    await entitle(partnerA, SENSITIVE);
    expect(JSON.parse((await getWorkspace(cookie, partnerA)).body).capabilities.sort()).toEqual(['TEST_PLAIN', 'TEST_SENSITIVE']);
  });

  it('onboarding Partner (relationship not ACTIVE): the shell and provisioning remain; the operational capability is advisory-restricted and Class D denies', async () => {
    await entitle(onboardingCompany, PLAIN);
    await entitle(onboardingCompany, SENSITIVE);
    const cookie = await login(onboardingUser);
    const created = await provision(cookie, onboardingCompany);
    expect(created.statusCode).toBe(201);
    const body = JSON.parse((await getWorkspace(cookie, onboardingCompany)).body);
    expect(body.capabilities).toEqual(['TEST_PLAIN']);
    expect(body.capabilityStates).toEqual(expect.arrayContaining([
      { capability: 'TEST_PLAIN', available: true },
      { capability: 'TEST_SENSITIVE', available: false, reason: 'OPERATIONAL_ACCESS_RESTRICTED' },
    ]));
    expect((await call('GET', cookie, onboardingCompany, {}, `/api/v1/partner/verify/requests/${id()}/result`)).statusCode).toBe(403);
  });

  it('ACTIVE relationship with RESTRICTED operational access: the shell stays, the sensitive capability is not usable, and the next request recomputes', async () => {
    await entitle(restrictedCompany, PLAIN);
    await entitle(restrictedCompany, SENSITIVE);
    const cookie = await login(restrictedUser);
    await provision(cookie, restrictedCompany);
    let body = JSON.parse((await getWorkspace(cookie, restrictedCompany)).body);
    expect(body.capabilities.sort()).toEqual(['TEST_PLAIN', 'TEST_SENSITIVE']);
    expect((await call('GET', cookie, restrictedCompany, {}, `/api/v1/partner/verify/requests/${id()}/result`)).statusCode).toBe(404);

    const acceptance = (await owner.query<{ id: string }>('SELECT id FROM partner_agreement_acceptances WHERE company_id=$1', [restrictedCompany])).rows[0].id;
    await owner.query(
      `INSERT INTO partner_agreement_acceptance_events(acceptance_id, company_id, status, actor_user_id, correlation_id) VALUES ($1,$2,'SUSPENDED',$3,$4)`,
      [acceptance, restrictedCompany, restrictedUser, id()],
    );
    const response = await getWorkspace(cookie, restrictedCompany);
    expect(response.statusCode).toBe(200);
    body = JSON.parse(response.body);
    expect(body.capabilities).toEqual(['TEST_PLAIN']);
    expect(body.capabilityStates).toEqual(expect.arrayContaining([
      { capability: 'TEST_PLAIN', available: true },
      { capability: 'TEST_SENSITIVE', available: false, reason: 'OPERATIONAL_ACCESS_RESTRICTED' },
    ]));
    expect((await owner.query('SELECT status FROM company_partnerships WHERE company_id=$1', [restrictedCompany])).rows[0].status).toBe('ACTIVE');
    // Advisory projection never enforces: the real Class D route still denies on its own.
    expect((await call('GET', cookie, restrictedCompany, {}, `/api/v1/partner/verify/requests/${id()}/result`)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/procurement-documents/${id()}/extract`, headers: { cookie, 'x-sco-company-id': restrictedCompany }, payload: { lines: [] } })).statusCode).toBe(403);
  });

  it('advisory capability projection writes no authorization audit of its own', async () => {
    const user = await createUser(partnerA, ['partner.portal.read', 'partner_verify.read']);
    const cookie = await login(user);
    await getWorkspace(cookie, partnerA);
    const allowed = await auditRows(user, 'authorization.purpose_allowed');
    const denied = await auditRows(user, 'authorization.operation_denied');
    expect(allowed.length).toBe(1);
    expect(denied.length).toBe(0);
    expect((await owner.query(`SELECT count(*)::int AS count FROM audit_logs WHERE actor_user_id=$1 AND action LIKE 'authorization.%'`, [user])).rows[0].count).toBe(1);
  });
});

describe('H3 registry and composition contract (pure)', () => {
  it('registers the workspace operations as resource-less Class C operations for PARTNER companies', () => {
    for (const operation of [AUTHORIZATION_OPERATION.PARTNER_WORKSPACE_READ, AUTHORIZATION_OPERATION.PARTNER_WORKSPACE_PROVISION]) {
      const descriptor = operationDescriptor(operation);
      expect(descriptor).toMatchObject({ permission: 'partner.portal.read', partnerClassD: false, companyTypes: ['PARTNER'], resource: { kind: 'COMPANY', routeParam: null } });
      expect(descriptor?.purpose).toEqual(PURPOSE_REQUIREMENT.AUTHORIZATION);
      expect(registryInvariantViolations({ [operation]: descriptor! })).toEqual([]);
    }
  });

  it('the production capability registry exposes nothing until a Partner-visible capability is explicitly mapped', () => {
    expect(DEFAULT_WORKSPACE_CAPABILITIES).toEqual([]);
    expect(Object.isFrozen(DEFAULT_WORKSPACE_CAPABILITIES)).toBe(true);
    expect(composeCapabilityStates(DEFAULT_WORKSPACE_CAPABILITIES, new Set(['PARTNER_CONTEXT_SUPPORT', 'ANYTHING']), new Set(['partner_verify.read']), true)).toEqual([]);
  });

  it('composition requires entitlement AND permission, and only operational-gated capabilities depend on H2 access', () => {
    const entries = [
      { serviceCode: 'SVC_PLAIN', capability: 'PLAIN', requiredPermission: 'p.a', requiresOperationalAccess: false },
      { serviceCode: 'SVC_GATED', capability: 'GATED', requiredPermission: 'p.b', requiresOperationalAccess: true },
    ];
    const both = new Set(['SVC_PLAIN', 'SVC_GATED']);
    const perms = new Set(['p.a', 'p.b']);
    expect(composeCapabilityStates(entries, both, perms, true)).toEqual([{ capability: 'PLAIN', available: true }, { capability: 'GATED', available: true }]);
    expect(composeCapabilityStates(entries, both, perms, false)).toEqual([{ capability: 'PLAIN', available: true }, { capability: 'GATED', available: false, reason: 'OPERATIONAL_ACCESS_RESTRICTED' }]);
    expect(composeCapabilityStates(entries, new Set(['SVC_PLAIN']), perms, true)).toEqual([{ capability: 'PLAIN', available: true }]);
    expect(composeCapabilityStates(entries, both, new Set(['p.a']), true)).toEqual([{ capability: 'PLAIN', available: true }]);
    expect(composeCapabilityStates(entries, both, new Set(), true)).toEqual([]);
    expect(composeCapabilityStates(entries, new Set(['SVC_OTHER']), perms, true)).toEqual([]);
  });

  it('rejects malformed or ambiguous registry mappings at start-up', () => {
    const ok = { serviceCode: 'SVC_ONE', capability: 'ONE', requiredPermission: 'p.a', requiresOperationalAccess: false };
    expect(validateWorkspaceCapabilityRegistry([ok])).toHaveLength(1);
    expect(() => validateWorkspaceCapabilityRegistry([{ ...ok, serviceCode: 'bad code' }])).toThrow('WORKSPACE_CAPABILITY_REGISTRY_INVALID');
    expect(() => validateWorkspaceCapabilityRegistry([{ ...ok, requiredPermission: ' ' }])).toThrow('WORKSPACE_CAPABILITY_REGISTRY_INVALID');
    expect(() => validateWorkspaceCapabilityRegistry([ok, { ...ok, capability: 'TWO' }])).toThrow('WORKSPACE_CAPABILITY_REGISTRY_AMBIGUOUS');
    expect(() => validateWorkspaceCapabilityRegistry([ok, { ...ok, serviceCode: 'SVC_TWO' }])).toThrow('WORKSPACE_CAPABILITY_REGISTRY_AMBIGUOUS');
  });
});
