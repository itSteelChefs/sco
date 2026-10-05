import { randomBytes, randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import argon2 from 'argon2';
import { AppModule } from '../../src/app.module.js';
import { deriveStage } from '../../src/modules/partner-journey/partner-journey.service.js';

// Real HTTP coverage of the H2 Partner Journey projection and of the lifecycle it derives from. The lifecycle is driven
// only through the existing 0102 SCO-internal gateways and the Partner agreement endpoint; the journey stores nothing.

const id = () => randomUUID();
const password = randomBytes(32).toString('base64url');
const AGREEMENT_MARKER = 'H2-AGREEMENT-CONTENT-MARKER';
const VERSION = `h2-${randomUUID()}`;

let app: NestFastifyApplication;
let owner: Client;
let internal: Pool;
let scoCompany: string;
let scoOperator: string;

async function grant(userId: string, companyId: string, code: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, companyId])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, companyId, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), companyId, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), companyId, role, code]);
}

async function createCompany(label: string, type: 'PARTNER' | 'SCO') {
  const companyId = id();
  await owner.query(`INSERT INTO "Company"(id,name,type) VALUES($1,$2,$3)`, [companyId, `H2 ${label}`, type]);
  return companyId;
}

async function createUser(companyId: string, permissions: string[]) {
  const userId = id();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,'ACTIVE')`, [userId, `${userId}@h2.test`, passwordHash]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
  for (const permission of permissions) await grant(userId, companyId, permission);
  return userId;
}

async function login(userId: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${userId}@h2.test`, password } });
  expect(response.statusCode).toBe(201);
  return response.headers['set-cookie'] as string;
}

const get = (cookie: string | undefined, url: string, companyId?: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers: { ...(cookie ? { cookie } : {}), ...(companyId ? { 'x-sco-company-id': companyId } : {}), ...headers } });

const journey = (cookie: string | undefined, companyId?: string, headers: Record<string, string> = {}) => get(cookie, '/api/v1/partner/journey', companyId, headers);
const verifyRead = (cookie: string, companyId: string) => get(cookie, `/api/v1/partner/verify/requests/${id()}/result`, companyId);
const extractDocument = (cookie: string, companyId: string) => app.inject({
  method: 'POST', url: `/api/v1/procurement-documents/${id()}/extract`, headers: { cookie, 'x-sco-company-id': companyId }, payload: { lines: [] },
});

async function acceptAgreement(cookie: string, companyId: string) {
  return app.inject({
    method: 'POST', url: '/api/v1/partner/admission/agreements/accept', headers: { cookie, 'x-sco-company-id': companyId },
    payload: { agreementType: 'BINDING_CONFIDENTIALITY', versionCode: VERSION, idempotencyKey: `h2-accept-${id()}` },
  });
}

async function startAdmission(companyId: string) {
  const qualification = (await internal.query('SELECT * FROM public.internal_qualification_create_for_company($1,$2,$3,$4)', [scoOperator, companyId, 'H2 Partner Ltd', 'h2@example.test'])).rows[0];
  await internal.query('SELECT * FROM public.internal_qualification_decide($1,$2,$3,$4)', [scoOperator, qualification.id, 'APPROVED', 'Qualification evidence checked']);
  return (await internal.query('SELECT * FROM public.internal_partnership_create($1,$2,$3)', [scoOperator, companyId, 'BUYER_PARTNERSHIP'])).rows[0].id as string;
}

const approve = (partnershipId: string) => internal.query('SELECT * FROM public.internal_partnership_approve($1,$2,$3,$4)', [scoOperator, partnershipId, 'H2 approval', id()]);
const activate = (partnershipId: string) => internal.query('SELECT * FROM public.internal_partnership_activate($1,$2)', [scoOperator, partnershipId]);
const suspend = (partnershipId: string) => internal.query('SELECT * FROM public.internal_partnership_suspend($1,$2,$3,$4)', [scoOperator, partnershipId, 'H2 suspension', id()]);
const revoke = (partnershipId: string) => internal.query('SELECT * FROM public.internal_partnership_revoke($1,$2,$3,$4)', [scoOperator, partnershipId, 'H2 revocation', id()]);

const ALL_PARTNER_PERMISSIONS = ['partner.admission.read', 'partner.agreement.accept', 'partner.portal.read', 'partner_verify.read', 'procurement_document.extract'];

async function activePartner(label: string) {
  const companyId = await createCompany(label, 'PARTNER');
  const userId = await createUser(companyId, ALL_PARTNER_PERMISSIONS);
  const partnershipId = await startAdmission(companyId);
  expect((await acceptAgreement(await login(userId), companyId)).statusCode).toBe(201);
  await approve(partnershipId);
  await activate(partnershipId);
  return { companyId, userId, partnershipId };
}

async function auditRows(actorUserId: string, action: string) {
  return (await owner.query(
    `SELECT metadata, authorization_decision, purpose_code, entity_type FROM audit_logs WHERE actor_user_id=$1 AND action=$2 ORDER BY created_at DESC, id DESC`,
    [actorUserId, action],
  )).rows as Array<{ metadata: Record<string, unknown>; authorization_decision: string; purpose_code: string; entity_type: string | null }>;
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

const capability = (body: { capabilities: Array<{ code: string }> }, code: string) => body.capabilities.find((entry) => entry.code === code);
const experience = (body: { experiences: Array<{ code: string }> }, code: string) => body.experiences.find((entry) => entry.code === code);

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });

  scoCompany = await createCompany('SCO', 'SCO');
  scoOperator = await createUser(scoCompany, ['qualification.manage', 'partnership.manage', 'agreement.policy.manage']);
  // Effective just after the latest published policy so it is the current one and publishing never conflicts on rerun.
  // It is non-reacceptance, so it never invalidates other suites' acceptances.
  const effectiveAt = (await owner.query<{ effective_at: Date }>(
    `SELECT GREATEST(TIMESTAMPTZ '2000-01-02 00:00:00+00', COALESCE(max(effective_at), TIMESTAMPTZ '2000-01-02 00:00:00+00')) + interval '1 millisecond' AS effective_at
       FROM partner_agreement_policy_versions WHERE agreement_type='BINDING_CONFIDENTIALITY' AND state IN ('PUBLISHED','SUSPENDED','TERMINATED')`,
  )).rows[0].effective_at;
  const policy = (await internal.query(
    `SELECT * FROM public.internal_partner_agreement_policy_create(
       $1,'BINDING_CONFIDENTIALITY',$2,$3,$4,'partner.agreement.accept',
       false,'NO_ACCESS_CHANGE','NO_ACCESS_CHANGE','H2_TEST',true,$5)`,
    [scoOperator, VERSION, `${AGREEMENT_MARKER} ${id()}`, effectiveAt.toISOString(), id()],
  )).rows[0];
  await internal.query('SELECT * FROM public.internal_partner_agreement_policy_publish($1,$2,$3)', [scoOperator, policy.id, id()]);

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await internal?.end();
  await owner?.end();
});

describe('H2 stage derivation (pure, from existing lifecycle facts)', () => {
  const cases: Array<[Parameters<typeof deriveStage>, string]> = [
    [['NONE', 'NONE', false], 'REGISTRATION'],
    [['APPLICATION', 'NONE', false], 'QUALIFICATION'],
    [['UNDER_REVIEW', 'NONE', false], 'QUALIFICATION'],
    [['REJECTED', 'NONE', false], 'REJECTED'],
    [['APPROVED', 'NONE', false], 'AGREEMENT'],
    [['APPROVED', 'NONE', true], 'APPROVAL'],
    [['APPROVED', 'UNDER_REVIEW', false], 'AGREEMENT'],
    [['APPROVED', 'UNDER_REVIEW', true], 'APPROVAL'],
    [['UNDER_REVIEW', 'UNDER_REVIEW', true], 'QUALIFICATION'],
    [['APPROVED', 'APPROVED', true], 'ONBOARDING'],
    [['APPROVED', 'ACTIVE', true], 'ACTIVE'],
    [['APPROVED', 'ACTIVE', false], 'ACTIVE'],
    [['APPROVED', 'SUSPENDED', true], 'SUSPENDED'],
    [['APPROVED', 'REVOKED', true], 'REVOKED'],
    [['APPROVED', 'REJECTED', true], 'REJECTED'],
  ];
  it.each(cases)('%j -> %s', (input, stage) => {
    expect(deriveStage(...input)).toBe(stage);
  });
});

describe('H2 Partner lifecycle through the real HTTP boundary', () => {
  let companyId: string;
  let userId: string;
  let cookie: string;
  let partnershipId: string;

  beforeAll(async () => {
    companyId = await createCompany('Lifecycle Partner', 'PARTNER');
    // Onboarding actor: admission + agreement authority and the Class D operation permissions, but no portal access yet.
    userId = await createUser(companyId, ['partner.admission.read', 'partner.agreement.accept', 'partner_verify.read', 'procurement_document.extract']);
    cookie = await login(userId);
  });

  it('REGISTRATION: nothing exists yet; shell/procurement are closed, onboarding is open, nothing leaks', async () => {
    const response = await journey(cookie, companyId);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Object.keys(body).sort()).toEqual(['actor', 'capabilities', 'company', 'experiences', 'nextAction', 'operational', 'relationship']);
    expect(body.company).toEqual({ id: companyId, name: 'H2 Lifecycle Partner' });
    expect(body.actor).toMatchObject({ userId });
    expect(body.relationship).toMatchObject({ stage: 'REGISTRATION', qualification: 'NONE', partnership: 'NONE' });
    expect(body.operational).toEqual({ procurementAccess: 'RESTRICTED', reason: 'RELATIONSHIP_NOT_ACTIVE' });
    expect(body.nextAction).toEqual({ code: 'AWAIT_SCO_REVIEW', owner: 'SCO', permitted: true });
    expect(experience(body, 'PARTNER_SHELL')).toMatchObject({ enterable: false, reason: 'PERMISSION_REQUIRED' });
    expect(experience(body, 'ONBOARDING')).toMatchObject({ enterable: true });
    expect(experience(body, 'PROCUREMENT')).toMatchObject({ classification: 'D', enterable: false, reason: 'RELATIONSHIP_NOT_ACTIVE' });
    expect(capability(body, 'VERIFY_RESULT_READ')).toMatchObject({ available: false, reason: 'RELATIONSHIP_NOT_ACTIVE' });
    expect(capability(body, 'PROCUREMENT_DOCUMENT_EXTRACTION')).toMatchObject({ available: false, reason: 'RELATIONSHIP_NOT_ACTIVE' });
  });

  it('pre-admission (not Active): Class D routes deny while Class B admission stays readable', async () => {
    expect((await verifyRead(cookie, companyId)).statusCode).toBe(403);
    expect((await extractDocument(cookie, companyId)).statusCode).toBe(403);
    const admission = await get(cookie, '/api/v1/partner/admission/status', companyId);
    expect(admission.statusCode).toBe(200);
  });

  it('QUALIFICATION then AGREEMENT: an accepted-qualification, unaccepted-agreement Partner is asked to accept, without content or hashes', async () => {
    const qualification = (await internal.query('SELECT * FROM public.internal_qualification_create_for_company($1,$2,$3,$4)', [scoOperator, companyId, 'H2 Partner Ltd', 'h2@example.test'])).rows[0];
    let body = JSON.parse((await journey(cookie, companyId)).body);
    expect(body.relationship).toMatchObject({ stage: 'QUALIFICATION', qualification: expect.stringMatching(/APPLICATION|UNDER_REVIEW/) });

    await internal.query('SELECT * FROM public.internal_qualification_decide($1,$2,$3,$4)', [scoOperator, qualification.id, 'APPROVED', 'Qualification evidence checked']);
    partnershipId = (await internal.query('SELECT * FROM public.internal_partnership_create($1,$2,$3)', [scoOperator, companyId, 'BUYER_PARTNERSHIP'])).rows[0].id;
    const response = await journey(cookie, companyId);
    body = JSON.parse(response.body);
    expect(body.relationship).toMatchObject({ stage: 'AGREEMENT', partnership: 'UNDER_REVIEW', agreementsSatisfied: false });
    expect(body.relationship.pendingAgreements).toEqual([{ agreementType: 'BINDING_CONFIDENTIALITY', version: VERSION, status: 'NOT_ACCEPTED', actionable: true }]);
    expect(body.nextAction).toEqual({ code: 'ACCEPT_AGREEMENTS', owner: 'PARTNER', permitted: true });
    expect(capability(body, 'AGREEMENT_ACCEPTANCE')).toMatchObject({ available: true });
    expect(response.body).not.toContain(AGREEMENT_MARKER);
    expect(response.body).not.toMatch(/content|sha256|hash/i);
  });

  it('APPROVAL: after the Partner accepts, the next step is SCO approval', async () => {
    expect((await acceptAgreement(cookie, companyId)).statusCode).toBe(201);
    const body = JSON.parse((await journey(cookie, companyId)).body);
    expect(body.relationship).toMatchObject({ stage: 'APPROVAL', agreementsSatisfied: true, pendingAgreements: [] });
    expect(body.nextAction).toEqual({ code: 'AWAIT_SCO_REVIEW', owner: 'SCO', permitted: true });
    expect((await verifyRead(cookie, companyId)).statusCode).toBe(403);
  });

  it('ONBOARDING: approved but not active; activation is refused until a portal member exists (existing 0102 contract)', async () => {
    await approve(partnershipId);
    const body = JSON.parse((await journey(cookie, companyId)).body);
    expect(body.relationship).toMatchObject({ stage: 'ONBOARDING', partnership: 'APPROVED' });
    expect(experience(body, 'PROCUREMENT')).toMatchObject({ enterable: false, reason: 'RELATIONSHIP_NOT_ACTIVE' });
    expect((await verifyRead(cookie, companyId)).statusCode).toBe(403);
    await expect(activate(partnershipId)).rejects.toThrow('PARTNERSHIP_ONBOARDING_INCOMPLETE');
  });

  it('ACTIVE: activation is the existing partnership transition; Class D opens and the journey reflects it on the next request', async () => {
    await grant(userId, companyId, 'partner.portal.read');
    await activate(partnershipId);
    const body = JSON.parse((await journey(cookie, companyId)).body);
    expect(body.relationship).toMatchObject({ stage: 'ACTIVE', partnership: 'ACTIVE', agreementsSatisfied: true });
    expect(body.operational).toEqual({ procurementAccess: 'AVAILABLE' });
    expect(body.nextAction).toEqual({ code: 'NONE', owner: 'NONE', permitted: true });
    expect(experience(body, 'PARTNER_SHELL')).toMatchObject({ enterable: true });
    expect(experience(body, 'PROCUREMENT')).toMatchObject({ enterable: true });
    expect(capability(body, 'VERIFY_RESULT_READ')).toEqual({ code: 'VERIFY_RESULT_READ', classification: 'D', available: true });
    expect(capability(body, 'PROCUREMENT_DOCUMENT_EXTRACTION')).toEqual({ code: 'PROCUREMENT_DOCUMENT_EXTRACTION', classification: 'D', available: true });
    // Authorized and reaching the downstream gateways (safe not-found for an unknown resource).
    expect((await verifyRead(cookie, companyId)).statusCode).toBe(404);
    expect((await extractDocument(cookie, companyId)).statusCode).toBe(404);
  });

  it('SUSPENDED: Class D denies on the very next operation; shell and onboarding remain available', async () => {
    await suspend(partnershipId);
    expect((await verifyRead(cookie, companyId)).statusCode).toBe(403);
    expect((await extractDocument(cookie, companyId)).statusCode).toBe(403);
    const response = await journey(cookie, companyId);
    const body = JSON.parse(response.body);
    expect(body.relationship).toMatchObject({ stage: 'SUSPENDED', partnership: 'SUSPENDED' });
    expect(body.operational).toEqual({ procurementAccess: 'RESTRICTED', reason: 'RELATIONSHIP_NOT_ACTIVE' });
    expect(body.nextAction).toEqual({ code: 'CONTACT_SCO', owner: 'SCO', permitted: true });
    expect(experience(body, 'PARTNER_SHELL')).toMatchObject({ enterable: true });
    expect(experience(body, 'ONBOARDING')).toMatchObject({ enterable: true });
    expect(experience(body, 'PROCUREMENT')).toMatchObject({ enterable: false, reason: 'RELATIONSHIP_NOT_ACTIVE' });
    expect(capability(body, 'VERIFY_RESULT_READ')).toMatchObject({ available: false, reason: 'RELATIONSHIP_NOT_ACTIVE' });
    expect((await get(cookie, '/api/v1/partner/admission/status', companyId)).statusCode).toBe(200);
    // Class C shell (partner.portal.read, AUTHORIZATION purpose) is intentionally not gated on Active Partner status.
    expect((await get(cookie, '/api/v1/partner/me', companyId)).statusCode).toBe(200);
  });

  it('reactivation restores Class D on the next operation, and REVOKED closes it again', async () => {
    await activate(partnershipId);
    expect((await verifyRead(cookie, companyId)).statusCode).toBe(404);
    await revoke(partnershipId);
    expect((await verifyRead(cookie, companyId)).statusCode).toBe(403);
    expect((await extractDocument(cookie, companyId)).statusCode).toBe(403);
    const body = JSON.parse((await journey(cookie, companyId)).body);
    expect(body.relationship).toMatchObject({ stage: 'REVOKED', partnership: 'REVOKED' });
    expect(body.nextAction).toEqual({ code: 'CONTACT_SCO', owner: 'SCO', permitted: true });
    expect(experience(body, 'PROCUREMENT')).toMatchObject({ enterable: false, reason: 'RELATIONSHIP_NOT_ACTIVE' });
  });
});

describe('H2 agreement no longer satisfying a sensitive operation', () => {
  it('an Active Partner whose acceptance leaves a satisfying state is denied Class D, with an honest non-actionable journey', async () => {
    const partner = await activePartner('Agreement Partner');
    const cookie = await login(partner.userId);
    expect((await verifyRead(cookie, partner.companyId)).statusCode).toBe(404);
    const acceptance = (await owner.query<{ id: string }>('SELECT id FROM partner_agreement_acceptances WHERE company_id=$1', [partner.companyId])).rows[0].id;
    await owner.query(
      `INSERT INTO partner_agreement_acceptance_events(acceptance_id, company_id, status, actor_user_id, correlation_id) VALUES ($1,$2,'SUSPENDED',$3,$4)`,
      [acceptance, partner.companyId, partner.userId, id()],
    );
    expect((await verifyRead(cookie, partner.companyId)).statusCode).toBe(403);
    expect((await extractDocument(cookie, partner.companyId)).statusCode).toBe(403);
    const body = JSON.parse((await journey(cookie, partner.companyId)).body);
    // Relationship stays ACTIVE; only operational procurement access is restricted.
    expect(body.relationship).toMatchObject({ stage: 'ACTIVE', partnership: 'ACTIVE', agreementsSatisfied: false });
    expect(body.operational).toEqual({ procurementAccess: 'RESTRICTED', reason: 'AGREEMENT_REQUIRED' });
    expect((await owner.query(`SELECT status FROM company_partnerships WHERE company_id=$1`, [partner.companyId])).rows[0].status).toBe('ACTIVE');
    expect(body.relationship.pendingAgreements).toEqual([{ agreementType: 'BINDING_CONFIDENTIALITY', version: VERSION, status: 'SUSPENDED', actionable: false }]);
    expect(body.nextAction).toEqual({ code: 'CONTACT_SCO', owner: 'SCO', permitted: true });
    expect(experience(body, 'PROCUREMENT')).toMatchObject({ enterable: false, reason: 'AGREEMENT_REQUIRED' });
    expect(capability(body, 'VERIFY_RESULT_READ')).toMatchObject({ available: false, reason: 'AGREEMENT_REQUIRED' });
  });
});

describe('H2 authorization of the journey read', () => {
  let partner: Awaited<ReturnType<typeof activePartner>>;
  let foreign: Awaited<ReturnType<typeof activePartner>>;

  beforeAll(async () => {
    partner = await activePartner('Journey Partner');
    foreign = await activePartner('Foreign Partner');
  });

  it('requires authentication', async () => {
    expect((await journey(undefined)).statusCode).toBe(401);
  });

  it('denies a member holding neither portal nor admission access, and audits the denial truthfully', async () => {
    const bare = await createUser(partner.companyId, ['procurement_document.extract']);
    const response = await journey(await login(bare), partner.companyId);
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({ error: { code: 'FORBIDDEN' } });
    const rows = await auditRows(bare, 'authorization.operation_denied');
    expect(rows[0]).toMatchObject({ authorization_decision: 'DENIED', purpose_code: 'PUR-02', entity_type: 'Company' });
    expect(rows[0].metadata).toMatchObject({ operation: 'partner_journey.read', reason: 'PERMISSION_MISSING', failedLayer: 'PERMISSION' });
    expect(await auditRows(bare, 'authorization.purpose_allowed')).toEqual([]);
  });

  it('a portal-only member gets the shell context but no relationship state', async () => {
    const portalOnly = await createUser(partner.companyId, ['partner.portal.read']);
    const body = JSON.parse((await journey(await login(portalOnly), partner.companyId)).body);
    expect(body.relationship).toBeNull();
    expect(body.nextAction).toBeNull();
    expect(experience(body, 'PARTNER_SHELL')).toMatchObject({ enterable: true });
    expect(experience(body, 'ONBOARDING')).toMatchObject({ enterable: false, reason: 'PERMISSION_REQUIRED' });
    expect(experience(body, 'PROCUREMENT')).toMatchObject({ enterable: true });
    expect(capability(body, 'VERIFY_RESULT_READ')).toMatchObject({ available: false, reason: 'PERMISSION_REQUIRED' });
    expect(capability(body, 'AGREEMENT_ACCEPTANCE')).toMatchObject({ available: false, reason: 'PERMISSION_REQUIRED' });
  });

  it('wrong company, foreign tenant, wrong company type and malformed context all fail closed', async () => {
    const cookie = await login(partner.userId);
    expect((await journey(cookie, foreign.companyId)).statusCode).toBe(403);
    expect((await journey(cookie, scoCompany)).statusCode).toBe(403);
    expect((await journey(cookie, 'not-a-uuid')).statusCode).toBe(403);
    expect((await journey(cookie, id())).statusCode).toBe(403);
    const scoCookie = await login(scoOperator);
    expect((await journey(scoCookie, scoCompany)).statusCode).toBe(403);
    expect((await journey(scoCookie, partner.companyId)).statusCode).toBe(403);
  });

  it('A↔B substitution: each Partner sees only its own company, and headers/query cannot switch it', async () => {
    const aCookie = await login(partner.userId);
    const bCookie = await login(foreign.userId);
    const a = JSON.parse((await journey(aCookie, partner.companyId)).body);
    const b = JSON.parse((await journey(bCookie, foreign.companyId)).body);
    expect(a.company.id).toBe(partner.companyId);
    expect(b.company.id).toBe(foreign.companyId);
    const forged = await app.inject({
      method: 'GET', url: `/api/v1/partner/journey?companyId=${foreign.companyId}&tenantId=${foreign.companyId}`,
      headers: { cookie: aCookie, 'x-sco-company-id': partner.companyId, 'x-forwarded-company': foreign.companyId, 'x-sco-membership-id': id() },
    });
    expect(JSON.parse(forged.body).company.id).toBe(partner.companyId);
  });

  it('a revoked membership is denied on the next request', async () => {
    const user = await createUser(partner.companyId, ['partner.portal.read']);
    const cookie = await login(user);
    expect((await journey(cookie, partner.companyId)).statusCode).toBe(200);
    await owner.query(`UPDATE "CompanyMembership" SET status='REVOKED' WHERE "userId"=$1 AND "companyId"=$2`, [user, partner.companyId]);
    expect((await journey(cookie, partner.companyId)).statusCode).toBe(403);
  });

  it('writes one truthful final-outcome audit event with the registry purpose and ignores forged purpose claims', async () => {
    const cookie = await login(partner.userId);
    const before = (await auditRows(partner.userId, 'authorization.purpose_allowed')).length;
    const response = await journey(cookie, partner.companyId, { 'x-sco-purpose': 'PUR-17', 'x-purpose': 'PUR-17' });
    expect(response.statusCode).toBe(200);
    const rows = await auditRows(partner.userId, 'authorization.purpose_allowed');
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ authorization_decision: 'ALLOWED', purpose_code: 'PUR-02', entity_type: 'Company' });
    expect(JSON.stringify(rows[0].metadata)).not.toContain('PUR-17');
  });

  it('the projection discloses no policy internals, storage details or commercial/supplier data', async () => {
    const response = await journey(await login(partner.userId), partner.companyId);
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toMatch(/partner_verify\.|procurement_document\.|partner\.(portal|admission|agreement)|storage|bucket|credential|supplier|margin|purchase.?cost|negotiation|sha256|hash|content/i);
    const body = JSON.parse(response.body);
    for (const entry of [...body.capabilities, ...body.experiences]) {
      expect(Object.keys(entry).every((key) => ['code', 'classification', 'available', 'enterable', 'reason'].includes(key))).toBe(true);
    }
  });

  it('keeps Class D enforcement independent of the journey: an Active Partner still reaches the gateways, a foreign resource is a safe not-found', async () => {
    const cookie = await login(partner.userId);
    expect((await verifyRead(cookie, partner.companyId)).statusCode).toBe(404);
    expect((await verifyRead(cookie, foreign.companyId)).statusCode).toBe(403);
    expect((await get(cookie, '/api/v1/partner/verify/requests/not-a-uuid/result', partner.companyId)).statusCode).toBe(403);
  });
});

describe('H2 permission removal is reflected on the very next request (no cached authority)', () => {
  it('removing partner.portal.read: relationship stays ACTIVE, procurement access becomes RESTRICTED, Verify denies', async () => {
    const partner = await activePartner('Portal Removal Partner');
    const cookie = await login(partner.userId);
    let body = JSON.parse((await journey(cookie, partner.companyId)).body);
    expect(body.operational).toEqual({ procurementAccess: 'AVAILABLE' });
    expect((await verifyRead(cookie, partner.companyId)).statusCode).toBe(404);

    await revokePermission(partner.userId, partner.companyId, 'partner.portal.read');

    // The journey stays readable through partner.admission.read, so the new projection can be inspected.
    const response = await journey(cookie, partner.companyId);
    expect(response.statusCode).toBe(200);
    body = JSON.parse(response.body);
    expect(body.relationship).toMatchObject({ stage: 'ACTIVE', partnership: 'ACTIVE', agreementsSatisfied: true });
    expect(body.operational).toEqual({ procurementAccess: 'RESTRICTED', reason: 'PERMISSION_REQUIRED' });
    expect(experience(body, 'PARTNER_SHELL')).toMatchObject({ enterable: false, reason: 'PERMISSION_REQUIRED' });
    expect(experience(body, 'PROCUREMENT')).toMatchObject({ enterable: false });
    expect((await verifyRead(cookie, partner.companyId)).statusCode).toBe(403);
    expect((await extractDocument(cookie, partner.companyId)).statusCode).toBe(403);
    expect((await owner.query('SELECT status FROM company_partnerships WHERE company_id=$1', [partner.companyId])).rows[0].status).toBe('ACTIVE');
  });

  it('removing only partner_verify.read: procurement access stays AVAILABLE, only the Verify capability and route close', async () => {
    const partner = await activePartner('Verify Removal Partner');
    const cookie = await login(partner.userId);
    let body = JSON.parse((await journey(cookie, partner.companyId)).body);
    expect(capability(body, 'VERIFY_RESULT_READ')).toMatchObject({ available: true });
    expect((await verifyRead(cookie, partner.companyId)).statusCode).toBe(404);

    await revokePermission(partner.userId, partner.companyId, 'partner_verify.read');

    body = JSON.parse((await journey(cookie, partner.companyId)).body);
    expect(body.relationship).toMatchObject({ stage: 'ACTIVE', partnership: 'ACTIVE', agreementsSatisfied: true });
    // Generic Class D eligibility is unchanged: removing one operation permission does not restrict procurement access.
    expect(body.operational).toEqual({ procurementAccess: 'AVAILABLE' });
    expect(experience(body, 'PROCUREMENT')).toMatchObject({ enterable: true });
    expect(capability(body, 'VERIFY_RESULT_READ')).toEqual({ code: 'VERIFY_RESULT_READ', classification: 'D', available: false, reason: 'PERMISSION_REQUIRED' });
    expect(capability(body, 'PROCUREMENT_DOCUMENT_EXTRACTION')).toMatchObject({ available: true });
    expect((await verifyRead(cookie, partner.companyId)).statusCode).toBe(403);
    expect((await extractDocument(cookie, partner.companyId)).statusCode).toBe(404);
  });
});
