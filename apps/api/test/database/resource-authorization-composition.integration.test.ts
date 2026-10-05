import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthorizationModule } from '../../src/modules/authorization/authorization.module.js';
import { AUTHORIZATION_OPERATION, operationDescriptor } from '../../src/modules/authorization/authorization-operations.js';
import { AuthorizeOperation } from '../../src/modules/authorization/require-authorization.decorator.js';
import { ResourceAuthorizationGuard } from '../../src/modules/authorization/resource-authorization.guard.js';
import { ResourceAuthorizationService } from '../../src/modules/authorization/resource-authorization.service.js';
import type { ResourceAuthorizationRequest } from '../../src/modules/authorization/resource-authorization.types.js';
import { PURPOSE_REQUIREMENT, PURPOSE_FLOW } from '../../src/modules/rbac/purpose-registry.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { MembershipsService } from '../../src/modules/identity/memberships.service.js';
import { PartnerProcurementAccessService } from '../../src/modules/identity/partner-procurement-access.service.js';
import { PurposeAuthorizationService } from '../../src/modules/rbac/purpose-authorization.service.js';
import { RuntimeDatabaseService } from '../../src/database/runtime-database.service.js';
import { establishClassDPartnerEligibility } from './class-d-eligibility.fixture.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
const id = () => randomUUID();
const VERIFY = AUTHORIZATION_OPERATION.PARTNER_VERIFY_RESULT_READ;
const EXTRACT = AUTHORIZATION_OPERATION.PROCUREMENT_DOCUMENT_EXTRACT;
const SUPPORT_SERVICE = 'PARTNER_CONTEXT_SUPPORT';

let moduleRef: TestingModule;
let authz: ResourceAuthorizationService;
let partnerOk: string;
let partnerOther: string;
let partnerNoAgreement: string;
let sco: string;
let eligible: string;
let membershipOnly: string;
let noAgreementUser: string;
let otherPartnerUser: string;
let scoWorker: string;
let scoManager: string;

async function createUser(label: string) {
  const userId = id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [userId, `${userId}@${label}.h1.test`]);
  return userId;
}

async function createMembership(userId: string, companyId: string) {
  const membershipId = id();
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membershipId, userId, companyId]);
  return membershipId;
}

async function grant(userId: string, companyId: string, code: string) {
  const membershipId = (await owner.query<{ id: string }>('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, companyId])).rows[0].id;
  const roleId = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [roleId, companyId, `h1-${roleId}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), companyId, membershipId, roleId]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), companyId, roleId, code]);
}

async function context(userId: string, companyId: string) {
  const membershipId = (await owner.query<{ id: string }>('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, companyId])).rows[0].id;
  return { membershipId, userId, companyId, status: 'ACTIVE' as const };
}

const verifyRequest = async (userId: string, companyId: string, extra: Partial<ResourceAuthorizationRequest> = {}): Promise<ResourceAuthorizationRequest> => ({
  tenant: await context(userId, companyId),
  operation: VERIFY,
  resource: { id: id() },
  ...extra,
});

const extractRequest = async (userId: string, companyId: string, extra: Partial<ResourceAuthorizationRequest> = {}): Promise<ResourceAuthorizationRequest> => ({
  tenant: await context(userId, companyId),
  operation: EXTRACT,
  resource: { id: id() },
  ...extra,
});

async function auditRows(actorUserId: string, action: string) {
  return (await owner.query<{ metadata: Record<string, unknown>; authorization_decision: string; purpose_code: string; entity_type: string | null }>(
    `SELECT metadata, authorization_decision, purpose_code, entity_type FROM audit_logs WHERE actor_user_id=$1 AND action=$2 ORDER BY created_at DESC`,
    [actorUserId, action],
  )).rows;
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AuthorizationModule] }).compile();
  authz = moduleRef.get(ResourceAuthorizationService);

  partnerOk = id(); partnerOther = id(); partnerNoAgreement = id(); sco = id();
  await owner.query(
    `INSERT INTO "Company"(id,name,type) VALUES ($1,'H1 Partner OK','PARTNER'),($2,'H1 Partner Other','PARTNER'),($3,'H1 Partner No Agreement','PARTNER'),($4,'H1 SCO','SCO')`,
    [partnerOk, partnerOther, partnerNoAgreement, sco],
  );
  eligible = await createUser('eligible');
  membershipOnly = await createUser('membership-only');
  noAgreementUser = await createUser('no-agreement');
  otherPartnerUser = await createUser('other-partner');
  scoWorker = await createUser('sco-worker');
  scoManager = await createUser('sco-manager');

  await createMembership(eligible, partnerOk);
  await createMembership(membershipOnly, partnerOk);
  await createMembership(noAgreementUser, partnerNoAgreement);
  await createMembership(otherPartnerUser, partnerOther);
  await createMembership(scoWorker, sco);
  await createMembership(scoManager, sco);

  await grant(eligible, partnerOk, 'partner_verify.read');
  await grant(eligible, partnerOk, 'procurement_document.extract');
  await establishClassDPartnerEligibility(owner, eligible, partnerOk);
  // Membership + Class D readiness, but deliberately none of the operation permissions.
  await grant(membershipOnly, partnerOk, 'partner.portal.read');

  await grant(noAgreementUser, partnerNoAgreement, 'partner_verify.read');
  await grant(noAgreementUser, partnerNoAgreement, 'procurement_document.extract');
  await grant(noAgreementUser, partnerNoAgreement, 'partner.portal.read');
  await owner.query(`INSERT INTO company_partnerships(company_id,type,status) VALUES($1,'BUYER_PARTNERSHIP','ACTIVE')`, [partnerNoAgreement]);

  await grant(scoWorker, sco, 'partner_verify.read');
  await grant(scoWorker, sco, 'procurement_document.extract');
  await grant(scoWorker, sco, 'service_access.use');
  await grant(scoManager, sco, 'service_access.manage');
});

afterAll(async () => {
  await moduleRef?.close();
  await Promise.all([owner.end(), internal.end()]);
});

describe('H1 operation registry preserves the 0102 Class D contract', () => {
  it('binds Partner Verify result read to Active Partner + agreements + partner_verify.read + VERIFY purpose', () => {
    const descriptor = operationDescriptor(VERIFY);
    expect(descriptor).toMatchObject({ permission: 'partner_verify.read', partnerClassD: true, companyTypes: ['PARTNER'] });
    expect(descriptor?.purpose).toEqual(PURPOSE_REQUIREMENT.VERIFY);
  });

  it('binds procurement document extraction to the Class D gate and document custody purpose', () => {
    const descriptor = operationDescriptor(EXTRACT);
    expect(descriptor).toMatchObject({ permission: 'procurement_document.extract', partnerClassD: true, companyTypes: null });
    expect(descriptor?.purpose).toEqual(PURPOSE_REQUIREMENT.DOCUMENT_CUSTODY);
  });

  it('is closed: prototype keys and non-string operations are not operations', () => {
    for (const unknown of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 'partner_verify.result.write', 42, null, undefined, {}]) {
      expect(operationDescriptor(unknown)).toBeUndefined();
    }
  });
});

describe('H1 composition ALLOW paths', () => {
  it('allows an eligible Active Partner with permission, purpose, company and resource shape', async () => {
    const decision = await authz.decide(await verifyRequest(eligible, partnerOk));
    expect(decision.allowed).toBe(true);
    expect(decision.evidence.evaluatedLayers).toEqual(['CONTEXT', 'OPERATION', 'RESOURCE_CONTEXT', 'MEMBERSHIP', 'COMPANY', 'PERMISSION', 'PURPOSE', 'PARTNER_ELIGIBILITY']);
    expect(decision.evidence.failedLayer).toBeNull();
  });

  it('allows procurement document extraction for the same eligible Partner', async () => {
    const decision = await authz.decide(await extractRequest(eligible, partnerOk));
    expect(decision.allowed).toBe(true);
  });

  it('accepts a declared purpose only when it equals the registry purpose', async () => {
    expect((await authz.decide(await verifyRequest(eligible, partnerOk, { purpose: PURPOSE_REQUIREMENT.VERIFY }))).allowed).toBe(true);
  });

  it('applies the Class D Partner gate only to Partner companies (SCO tenant members use their own company scope)', async () => {
    expect((await authz.decide(await extractRequest(scoWorker, sco))).allowed).toBe(true);
  });
});

describe('H1 composition DENY paths', () => {
  const denied = async (request: ResourceAuthorizationRequest) => {
    const decision = await authz.decide(request);
    expect(decision.allowed).toBe(false);
    return decision as Extract<Awaited<ReturnType<typeof authz.decide>>, { allowed: false }>;
  };

  it('denies a missing actor / tenant context', async () => {
    expect((await denied({ tenant: undefined, operation: VERIFY, resource: { id: id() } })).reason).toBe('ACTOR_CONTEXT_REQUIRED');
  });

  it('denies missing, malformed and non-ACTIVE context fields', async () => {
    const base = await context(eligible, partnerOk);
    for (const tenant of [
      { ...base, companyId: undefined },
      { ...base, companyId: '' },
      { ...base, companyId: 'not-a-uuid' },
      { ...base, userId: undefined },
      { ...base, membershipId: undefined },
      { ...base, status: 'SUSPENDED' },
    ]) {
      expect((await denied({ tenant: tenant as never, operation: VERIFY, resource: { id: id() } })).reason).toBe('ACTOR_CONTEXT_MALFORMED');
    }
  });

  it('denies a foreign company context even when the user is an ACTIVE member elsewhere', async () => {
    const forged = { ...(await context(eligible, partnerOk)), companyId: partnerOther };
    expect((await denied({ tenant: forged, operation: VERIFY, resource: { id: id() } })).reason).toBe('MEMBERSHIP_INACTIVE');
  });

  it('denies a forged membership id for the right user and company', async () => {
    const forged = { ...(await context(eligible, partnerOk)), membershipId: id() };
    expect((await denied({ tenant: forged, operation: VERIFY, resource: { id: id() } })).reason).toBe('MEMBERSHIP_MISMATCH');
  });

  it('denies an Active-eligible membership that lacks the operation permission (membership is not resource authorization)', async () => {
    expect((await denied(await verifyRequest(membershipOnly, partnerOk))).reason).toBe('PERMISSION_MISSING');
    expect((await denied(await extractRequest(membershipOnly, partnerOk))).reason).toBe('PERMISSION_MISSING');
  });

  it('denies a Partner without Binding Confidentiality even with an Active partnership, portal access and permission', async () => {
    expect((await denied(await verifyRequest(noAgreementUser, partnerNoAgreement))).reason).toBe('PARTNER_NOT_ELIGIBLE');
    expect((await denied(await extractRequest(noAgreementUser, partnerNoAgreement))).reason).toBe('PARTNER_NOT_ELIGIBLE');
  });

  it('denies once the Partner is no longer Active', async () => {
    await owner.query(`UPDATE company_partnerships SET status='SUSPENDED' WHERE company_id=$1 AND type='BUYER_PARTNERSHIP'`, [partnerOk]);
    try {
      expect((await denied(await verifyRequest(eligible, partnerOk))).reason).toBe('PARTNER_NOT_ELIGIBLE');
    } finally {
      await owner.query(`UPDATE company_partnerships SET status='ACTIVE' WHERE company_id=$1 AND type='BUYER_PARTNERSHIP'`, [partnerOk]);
    }
    expect((await authz.decide(await verifyRequest(eligible, partnerOk))).allowed).toBe(true);
  });

  it('denies a wrong or elevated declared purpose', async () => {
    expect((await denied(await verifyRequest(eligible, partnerOk, { purpose: PURPOSE_REQUIREMENT.AUTHORIZATION }))).reason).toBe('PURPOSE_MISMATCH');
    expect((await denied(await verifyRequest(eligible, partnerOk, { purpose: { kind: 'CROSS_PURPOSE_FLOW', purpose: PURPOSE_REQUIREMENT.VERIFY.purpose, flow: PURPOSE_FLOW.CPF_20 } }))).reason).toBe('PURPOSE_MISMATCH');
    expect((await denied(await extractRequest(eligible, partnerOk, { purpose: PURPOSE_REQUIREMENT.VERIFY }))).reason).toBe('PURPOSE_MISMATCH');
  });

  it('denies a non-Partner company on a Partner-only operation even with the permission', async () => {
    expect((await denied(await verifyRequest(scoWorker, sco))).reason).toBe('COMPANY_TYPE_INELIGIBLE');
  });

  it('denies malformed and unknown operations', async () => {
    for (const operation of ['', 'nope', '__proto__', 'constructor', 42, null, undefined, {}]) {
      expect((await denied({ tenant: await context(eligible, partnerOk), operation, resource: { id: id() } })).reason).toBe('OPERATION_UNKNOWN');
    }
  });

  it('denies missing and malformed resource context on resource-bound operations', async () => {
    const tenant = await context(eligible, partnerOk);
    for (const resource of [undefined, {}, { id: '' }, { id: null }]) {
      expect((await denied({ tenant, operation: VERIFY, resource: resource as never })).reason).toBe('RESOURCE_CONTEXT_REQUIRED');
    }
    for (const resource of [{ id: 'not-a-uuid' }, { id: 7 }]) {
      expect((await denied({ tenant, operation: VERIFY, resource: resource as never })).reason).toBe('RESOURCE_CONTEXT_MALFORMED');
    }
  });

  it('fails closed (never allows) when an authoritative layer cannot be evaluated', async () => {
    const failing = new ResourceAuthorizationService(
      moduleRef.get(MembershipsService, { strict: false }),
      moduleRef.get(RuntimeDatabaseService, { strict: false }),
      { has: async () => { throw new Error('permission store unavailable'); } } as never,
      moduleRef.get(PurposeAuthorizationService, { strict: false }),
      moduleRef.get(PartnerProcurementAccessService, { strict: false }),
      moduleRef.get(AuditService, { strict: false }),
    );
    const decision = await failing.decide(await verifyRequest(eligible, partnerOk));
    expect(decision).toMatchObject({ allowed: false, reason: 'AUTHORIZATION_UNAVAILABLE' });
  });
});

describe('H1 Service Access stays independent from Partner membership', () => {
  let grantId: string;

  beforeAll(async () => {
    await internal.query('SELECT public.internal_service_entitlement_set($1,$2,$3,$4::"ServiceEntitlementState")', [scoManager, partnerOk, SUPPORT_SERVICE, 'ACTIVE']);
    grantId = (await internal.query<{ id: string }>(
      'SELECT public.internal_service_access_grant_create($1,$2,$3,$4,$5::timestamptz,$6,$7) AS id',
      [scoManager, scoWorker, partnerOk, SUPPORT_SERVICE, new Date(Date.now() + 60 * 60_000).toISOString(), 'h1-composition-grant', id()],
    )).rows[0].id;
  });

  it('does not turn an SCO workforce actor with an ACTIVE grant into a Partner member', async () => {
    const asPartner = { membershipId: (await context(scoWorker, sco)).membershipId, userId: scoWorker, companyId: partnerOk, status: 'ACTIVE' as const };
    for (const operation of [VERIFY, EXTRACT]) {
      const decision = await authz.decide({ tenant: asPartner, operation, resource: { id: id() } });
      expect(decision).toMatchObject({ allowed: false, reason: 'MEMBERSHIP_INACTIVE' });
    }
  });

  it('keeps denying after the grant is revoked (revocation cannot be a precondition for denial)', async () => {
    await internal.query('SELECT public.internal_service_access_grant_revoke($1,$2,$3,$4)', [scoManager, grantId, 'h1 composition revoke', id()]);
    const asPartner = { membershipId: (await context(scoWorker, sco)).membershipId, userId: scoWorker, companyId: partnerOk, status: 'ACTIVE' as const };
    expect(await authz.decide({ tenant: asPartner, operation: VERIFY, resource: { id: id() } })).toMatchObject({ allowed: false, reason: 'MEMBERSHIP_INACTIVE' });
  });
});

describe('H1 require() enforcement and audit evidence', () => {
  it('throws a uniform FORBIDDEN and records minimal denial evidence without leaking content', async () => {
    const resourceId = id();
    const before = (await auditRows(membershipOnly, 'authorization.operation_denied')).length;
    await expect(authz.require(await verifyRequest(membershipOnly, partnerOk, { resource: { id: resourceId }, correlationId: id() }))).rejects.toMatchObject({ status: 403 });
    const rows = await auditRows(membershipOnly, 'authorization.operation_denied');
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ authorization_decision: 'DENIED', purpose_code: 'PUR-14', entity_type: 'VERIFY_REQUEST' });
    expect(rows[0].metadata).toMatchObject({ operation: VERIFY, reason: 'PERMISSION_MISSING', failedLayer: 'PERMISSION' });
    expect(JSON.stringify(rows[0].metadata)).not.toMatch(/storage|secret|password|token|content_sha256|supplier/i);
  });

  it('writes purpose_allowed ALLOWED only for a finally allowed operation', async () => {
    const before = (await auditRows(eligible, 'authorization.purpose_allowed')).length;
    await authz.require(await verifyRequest(eligible, partnerOk));
    const rows = await auditRows(eligible, 'authorization.purpose_allowed');
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ authorization_decision: 'ALLOWED', purpose_code: 'PUR-14' });
  });

  it('records a purpose denial once, as the legacy purpose_denied event carrying the stable reason', async () => {
    const purposeBefore = (await auditRows(eligible, 'authorization.purpose_denied')).length;
    const operationBefore = (await auditRows(eligible, 'authorization.operation_denied')).length;
    await expect(authz.require(await verifyRequest(eligible, partnerOk, { purpose: PURPOSE_REQUIREMENT.AUTHORIZATION }))).rejects.toMatchObject({ status: 403 });
    const rows = await auditRows(eligible, 'authorization.purpose_denied');
    expect(rows.length).toBe(purposeBefore + 1);
    expect(rows[0].metadata).toMatchObject({ reason: 'PURPOSE_MISMATCH', failedLayer: 'PURPOSE' });
    expect((await auditRows(eligible, 'authorization.operation_denied')).length).toBe(operationBefore);
  });

  it('never emits a false purpose_allowed when purpose passes but a later layer denies (R1)', async () => {
    const allowedBefore = (await auditRows(noAgreementUser, 'authorization.purpose_allowed')).length;
    const purposeDeniedBefore = (await auditRows(noAgreementUser, 'authorization.purpose_denied')).length;
    const operationBefore = (await auditRows(noAgreementUser, 'authorization.operation_denied')).length;
    await expect(authz.require(await verifyRequest(noAgreementUser, partnerNoAgreement))).rejects.toMatchObject({ status: 403 });
    expect((await auditRows(noAgreementUser, 'authorization.purpose_allowed')).length).toBe(allowedBefore);
    expect((await auditRows(noAgreementUser, 'authorization.purpose_denied')).length).toBe(purposeDeniedBefore);
    const rows = await auditRows(noAgreementUser, 'authorization.operation_denied');
    expect(rows.length).toBe(operationBefore + 1);
    expect(rows[0]).toMatchObject({ authorization_decision: 'DENIED', purpose_code: 'PUR-14' });
    expect(rows[0].metadata).toMatchObject({ operation: VERIFY, reason: 'PARTNER_NOT_ELIGIBLE', failedLayer: 'PARTNER_ELIGIBILITY' });
    expect((rows[0].metadata as { layers: string[] }).layers).toContain('PURPOSE');
    const everything = await owner.query(`SELECT authorization_decision FROM audit_logs WHERE actor_user_id=$1 AND action LIKE 'authorization.%'`, [noAgreementUser]);
    expect(everything.rows.every((row) => row.authorization_decision === 'DENIED')).toBe(true);
  });

  it('attributes a malformed resource id to its own request with RESOURCE_CONTEXT_MALFORMED', async () => {
    const before = (await auditRows(eligible, 'authorization.operation_denied')).length;
    await expect(authz.require(await verifyRequest(eligible, partnerOk, { resource: { id: 'not-a-uuid' } }))).rejects.toMatchObject({ status: 403 });
    const rows = await auditRows(eligible, 'authorization.operation_denied');
    expect(rows.length).toBe(before + 1);
    expect(rows[0].metadata).toMatchObject({ reason: 'RESOURCE_CONTEXT_MALFORMED', failedLayer: 'RESOURCE_CONTEXT' });
  });

  it('writes no audit evidence when no tenant can be attributed', async () => {
    await expect(authz.require({ tenant: undefined, operation: VERIFY, resource: { id: id() } })).rejects.toMatchObject({ status: 403 });
  });
});

describe('H1 ResourceAuthorizationGuard', () => {
  class Declared { @AuthorizeOperation(VERIFY) handler() {} }
  class Undeclared { handler() {} }

  const executionContext = (target: new () => object, request: Record<string, unknown>) => ({
    getHandler: () => target.prototype.handler,
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

  it('fails closed when a route declares no authorization operation', async () => {
    const guard = new ResourceAuthorizationGuard(new Reflector(), authz);
    await expect(guard.canActivate(executionContext(Undeclared, { tenantContext: await context(eligible, partnerOk), params: {} }))).rejects.toMatchObject({ status: 403 });
  });

  it('derives the resource id from the server-declared route parameter, never from the body or headers', async () => {
    const guard = new ResourceAuthorizationGuard(new Reflector(), authz);
    const tenantContext = await context(eligible, partnerOk);
    await expect(guard.canActivate(executionContext(Declared, { tenantContext, params: {}, body: { requestId: id() }, headers: { 'x-resource-id': id() } }))).rejects.toMatchObject({ status: 403 });
    const request: Record<string, unknown> = { tenantContext, params: { requestId: id() } };
    await expect(guard.canActivate(executionContext(Declared, request))).resolves.toBe(true);
    expect(request.purposeContext).toMatchObject({ actorUserId: eligible, companyId: partnerOk, purpose: PURPOSE_REQUIREMENT.VERIFY });
  });

  it('denies when the tenant context is absent', async () => {
    const guard = new ResourceAuthorizationGuard(new Reflector(), authz);
    await expect(guard.canActivate(executionContext(Declared, { params: { requestId: id() } }))).rejects.toMatchObject({ status: 403 });
  });
});
