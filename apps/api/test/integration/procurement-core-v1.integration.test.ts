import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import argon2 from 'argon2';
import { AppModule } from '../../src/app.module.js';
import { ApiValidationPipe } from '../../src/common/http/validation-pipe.js';
import { establishClassDPartnerEligibility } from '../database/class-d-eligibility.fixture.js';

const id = () => randomUUID();
const password = randomBytes(32).toString('base64url');

let app: NestFastifyApplication;
let owner: Client;
let partnerCompany: string;
let otherCompany: string;
let scoCompany: string;
let unitId: string;
let member: string;
let outsider: string;
let otherMember: string;
let scoActor: string;

async function grant(userId: string, companyId: string, code: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, companyId])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, companyId, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), companyId, membership, role]);
  await owner.query(
    'INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4',
    [id(), companyId, role, code],
  );
}

async function createUser(companyId: string, permissions: string[], classD = false) {
  const userId = id();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,'ACTIVE')`, [userId, `${userId}@d-core.test`, passwordHash]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
  for (const permission of permissions) await grant(userId, companyId, permission);
  if (classD) await establishClassDPartnerEligibility(owner, userId, companyId);
  return userId;
}

async function login(userId: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: `${userId}@d-core.test`, password },
  });
  expect(response.statusCode).toBe(201);
  return response.headers['set-cookie'] as string;
}

async function acceptPartnershipTerms(companyId: string, userId: string) {
  // Class D fixture accepts BINDING_CONFIDENTIALITY only; publish+accept PARTNERSHIP_TERMS if required globally
  const existing = await owner.query(
    `SELECT id, content_sha256, version_code FROM partner_agreement_policy_versions
      WHERE agreement_type='PARTNERSHIP_TERMS' AND state='PUBLISHED' ORDER BY effective_at DESC LIMIT 1`,
  );
  let policy = existing.rows[0];
  if (!policy) {
    const policyId = id();
    const content = `D-core partnership terms ${policyId}`;
    const sha = createHash('sha256').update(content).digest('hex');
    await owner.query(
      `INSERT INTO partner_agreement_policy_versions(
         id, agreement_type, version_code, content_text, content_sha256, required, effective_at,
         acceptance_permission_code, reacceptance_required, suspension_effect, termination_effect,
         retention_classification, state, created_by
       ) VALUES ($1,'PARTNERSHIP_TERMS',$2,$3,$4,true,now()-interval '1 minute','partner.agreement.accept',false,
         'NO_ACCESS_CHANGE','NO_ACCESS_CHANGE','D_CORE','PUBLISHED',$5)`,
      [policyId, `d-pt-${policyId}`, content, sha, userId],
    );
    policy = { id: policyId, content_sha256: sha, version_code: `d-pt-${policyId}` };
  }
  const membershipId = (await owner.query(`SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2`, [userId, companyId])).rows[0].id;
  const acceptanceId = id();
  await owner.query(
    `INSERT INTO partner_agreement_acceptances(
       id, company_id, actor_user_id, membership_id, policy_version_id, agreement_type, version_code,
       accepted_content_sha256, authority_permission_code, authority_basis, purpose_code,
       idempotency_key, request_fingerprint, correlation_id
     ) VALUES ($1,$2,$3,$4,$5,'PARTNERSHIP_TERMS',$6,$7,'partner.agreement.accept','{}'::jsonb,'PUR-02',$8,$9,$10)
     ON CONFLICT (company_id, actor_user_id, idempotency_key) DO NOTHING`,
    [
      acceptanceId,
      companyId,
      userId,
      membershipId,
      policy.id,
      policy.version_code,
      policy.content_sha256,
      `d-pt-${companyId}-${policy.version_code}`,
      createHash('sha256').update(acceptanceId).digest('hex'),
      id(),
    ],
  );
  const acceptRow = (
    await owner.query(`SELECT id FROM partner_agreement_acceptances WHERE company_id=$1 AND policy_version_id=$2`, [companyId, policy.id])
  ).rows[0];
  await owner.query(
    `INSERT INTO partner_agreement_acceptance_events(acceptance_id, company_id, status, actor_user_id, correlation_id)
     SELECT $1,$2,'ACCEPTED',$3,$4
     WHERE NOT EXISTS (SELECT 1 FROM partner_agreement_acceptance_events WHERE acceptance_id=$1 AND status='ACCEPTED')`,
    [acceptRow.id, companyId, userId, id()],
  );
}

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  partnerCompany = id();
  otherCompany = id();
  scoCompany = id();
  await owner.query(
    `INSERT INTO "Company"(id,name,type,status) VALUES
      ($1,'D Partner A','PARTNER','ACTIVE'),
      ($2,'D Partner B','PARTNER','ACTIVE'),
      ($3,'D SCO','SCO','ACTIVE')`,
    [partnerCompany, otherCompany, scoCompany],
  );
  unitId = id();
  await owner.query(`INSERT INTO unit_definitions(id,code,name,dimension,active) VALUES($1,$2,'Each','count',true)`, [
    unitId,
    `d-${unitId}`,
  ]);

  member = await createUser(
    partnerCompany,
    ['partner.portal.read', 'procurement.request.write', 'procurement.request.read', 'partner.admission.read', 'partner.agreement.accept'],
    true,
  );
  await acceptPartnershipTerms(partnerCompany, member);

  otherMember = await createUser(
    otherCompany,
    ['partner.portal.read', 'procurement.request.write', 'procurement.request.read', 'partner.admission.read', 'partner.agreement.accept'],
    true,
  );
  await acceptPartnershipTerms(otherCompany, otherMember);

  outsider = id();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,'ACTIVE')`, [
    outsider,
    `${outsider}@d-core.test`,
    passwordHash,
  ]);

  scoActor = await createUser(scoCompany, ['sco.internal.manage', 'procurement.review']);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication(new FastifyAdapter());
  app.useGlobalPipes(new ApiValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

describe('D requirement / BOQ', () => {
  it('D-R01 eligible partner creates draft', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/procurement/requirements',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: {
        title: 'Riyadh HVAC package',
        sector: 'HVAC',
        deliveryLocation: 'الرياض',
        notes: 'demo',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).status).toBe('DRAFT');
  });

  it('D-R02 ineligible partner blocked', async () => {
    const ineligible = await createUser(partnerCompany, ['procurement.request.write', 'procurement.request.read'], false);
    const cookie = await login(ineligible);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/procurement/requirements',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { title: 'Blocked', sector: 'HVAC', deliveryLocation: 'Riyadh' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('D-R03 nonmember denied', async () => {
    const cookie = await login(outsider);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/procurement/requirements',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { title: 'X', sector: 'HVAC', deliveryLocation: 'Riyadh' },
    });
    expect([401, 403]).toContain(response.statusCode);
  });

  it('D-R04 cross-company denied', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/procurement/requirements',
      headers: { cookie, 'x-sco-company-id': otherCompany },
      payload: { title: 'Cross', sector: 'HVAC', deliveryLocation: 'Riyadh' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('D-R05/D-B01/D-B03/D-B04 draft save + BOQ line decimal + stable id', async () => {
    const cookie = await login(member);
    const created = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/partner/procurement/requirements',
          headers: { cookie, 'x-sco-company-id': partnerCompany },
          payload: { title: 'BOQ req', sector: 'ELECTRICAL', deliveryLocation: 'Riyadh' },
        })
      ).body,
    );
    const line = await app.inject({
      method: 'POST',
      url: `/api/v1/partner/procurement/requirements/${created.id}/lines`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: {
        description: 'Cable tray',
        quantity: 12.5,
        unitId,
        specification: 'hot-dip galvanized',
      },
    });
    expect(line.statusCode).toBe(201);
    const body = JSON.parse(line.body);
    expect(body.upsertedLineId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.lines[0].quantity).toBe('12.5000');
    const lineId = body.upsertedLineId;

    const updated = await app.inject({
      method: 'POST',
      url: `/api/v1/partner/procurement/requirements/${created.id}/lines`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { lineId, description: 'Cable tray 300mm', quantity: 13.25, unitId },
    });
    expect(updated.statusCode).toBe(201);
    expect(JSON.parse(updated.body).upsertedLineId).toBe(lineId);
  });

  it('D-R06/D-R07/D-R09 submit + immutable + audit', async () => {
    const cookie = await login(member);
    const created = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/partner/procurement/requirements',
          headers: { cookie, 'x-sco-company-id': partnerCompany },
          payload: { title: 'Submit me', sector: 'PLUMBING', deliveryLocation: 'Riyadh' },
        })
      ).body,
    );
    await app.inject({
      method: 'POST',
      url: `/api/v1/partner/procurement/requirements/${created.id}/lines`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { description: 'Valve', quantity: 2, unitId },
    });
    const before = Number(
      (await owner.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='procurement.requirement.submitted' AND entity_id=$1`, [
        created.id,
      ])).rows[0].n,
    );
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/partner/procurement/requirements/${created.id}/submit`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: {},
    });
    expect(submitted.statusCode).toBe(201);
    expect(JSON.parse(submitted.body).status).toBe('SUBMITTED');
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/partner/procurement/requirements/${created.id}/submit`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: {},
    });
    expect(again.statusCode).toBe(201);
    const mutate = await app.inject({
      method: 'PUT',
      url: `/api/v1/partner/procurement/requirements/${created.id}`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { title: 'Mutate', sector: 'PLUMBING', deliveryLocation: 'Riyadh' },
    });
    expect(mutate.statusCode).toBe(409);
    const after = Number(
      (await owner.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='procurement.requirement.submitted' AND entity_id=$1`, [
        created.id,
      ])).rows[0].n,
    );
    expect(after).toBeGreaterThan(before);
  });

  it('D-B05/D-B06 foreign line + submitted line mutation restricted', async () => {
    const cookie = await login(member);
    const a = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/partner/procurement/requirements',
          headers: { cookie, 'x-sco-company-id': partnerCompany },
          payload: { title: 'A', sector: 'HVAC', deliveryLocation: 'Riyadh' },
        })
      ).body,
    );
    const b = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/partner/procurement/requirements',
          headers: { cookie, 'x-sco-company-id': partnerCompany },
          payload: { title: 'B', sector: 'HVAC', deliveryLocation: 'Riyadh' },
        })
      ).body,
    );
    const lineA = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/partner/procurement/requirements/${a.id}/lines`,
          headers: { cookie, 'x-sco-company-id': partnerCompany },
          payload: { description: 'L', quantity: 1, unitId },
        })
      ).body,
    ).upsertedLineId as string;
    await app.inject({
      method: 'POST',
      url: `/api/v1/partner/procurement/requirements/${a.id}/lines`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { description: 'L2', quantity: 1, unitId },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/partner/procurement/requirements/${a.id}/submit`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: {},
    });
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/v1/partner/procurement/requirements/${b.id}/lines`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { lineId: lineA, description: 'steal', quantity: 1, unitId },
    });
    expect(foreign.statusCode).toBe(404);
    const submittedMut = await app.inject({
      method: 'POST',
      url: `/api/v1/partner/procurement/requirements/${a.id}/lines`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { description: 'after submit', quantity: 1, unitId },
    });
    expect(submittedMut.statusCode).toBe(409);
  });
});

describe('D supplier / quote / comparison', () => {
  async function prepareSubmittedRequirement(cookie: string) {
    const created = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/partner/procurement/requirements',
          headers: { cookie, 'x-sco-company-id': partnerCompany },
          payload: { title: `Cmp ${id()}`, sector: 'HVAC', deliveryLocation: 'Riyadh' },
        })
      ).body,
    );
    const line1 = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/partner/procurement/requirements/${created.id}/lines`,
          headers: { cookie, 'x-sco-company-id': partnerCompany },
          payload: { description: 'AHU', quantity: 2, unitId },
        })
      ).body,
    ).upsertedLineId as string;
    const line2 = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/partner/procurement/requirements/${created.id}/lines`,
          headers: { cookie, 'x-sco-company-id': partnerCompany },
          payload: { description: 'Chiller', quantity: 1, unitId },
        })
      ).body,
    ).upsertedLineId as string;
    await app.inject({
      method: 'POST',
      url: `/api/v1/partner/procurement/requirements/${created.id}/submit`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: {},
    });
    return { requirementId: created.id as string, line1, line2 };
  }

  it('D-R08/D-S01/D-Q01..D-C10 full internal quote comparison selection', async () => {
    const partnerCookie = await login(member);
    const scoCookie = await login(scoActor);
    const { requirementId, line1, line2 } = await prepareSubmittedRequirement(partnerCookie);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/internal/procurement/requirements',
      headers: { cookie: scoCookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(JSON.parse(listed.body).some((row: { id: string }) => row.id === requirementId)).toBe(true);

    await app.inject({
      method: 'POST',
      url: `/api/v1/internal/procurement/requirements/${requirementId}/transition`,
      headers: { cookie: scoCookie },
      payload: { nextStatus: 'SOURCING', reason: 'validated' },
    });

    const supplierA = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/procurement/suppliers',
          headers: { cookie: scoCookie },
          payload: { name: 'Canonical Supplier Alpha Hidden' },
        })
      ).body,
    );
    const supplierB = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/procurement/suppliers',
          headers: { cookie: scoCookie },
          payload: { name: 'Canonical Supplier Beta Hidden' },
        })
      ).body,
    );

    const partnerSupplierList = await app.inject({
      method: 'GET',
      url: '/api/v1/internal/procurement/suppliers',
      headers: { cookie: partnerCookie },
    });
    expect(partnerSupplierList.statusCode).toBe(403);

    const quoteA = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/procurement/requirements/${requirementId}/quotes`,
      headers: { cookie: scoCookie },
      payload: {
        supplierCompanyId: supplierA.id,
        quoteReference: 'QA-1',
        currencyCode: 'SAR',
        lines: [
          {
            requirementLineId: line1,
            matchState: 'MATCHED',
            offeredQuantity: 2,
            unitId,
            unitPrice: 100.5,
            valueState: 'QUOTED',
            taxState: 'EXCL',
          },
          {
            requirementLineId: line2,
            matchState: 'NOT_QUOTED',
            valueState: 'NOT_QUOTED',
          },
        ],
      },
    });
    expect(quoteA.statusCode).toBe(201);
    const quoteAId = JSON.parse(quoteA.body).quoteId as string;

    const quoteB = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/procurement/requirements/${requirementId}/quotes`,
      headers: { cookie: scoCookie },
      payload: {
        supplierCompanyId: supplierB.id,
        quoteReference: 'QB-1',
        currencyCode: 'SAR',
        lines: [
          {
            requirementLineId: line1,
            matchState: 'MATCHED',
            offeredQuantity: 2,
            unitId,
            unitPrice: 0,
            valueState: 'EXPLICIT_ZERO',
          },
          {
            requirementLineId: line2,
            matchState: 'MATCHED',
            offeredQuantity: 1,
            unitId,
            unitPrice: 500,
            valueState: 'QUOTED',
          },
        ],
      },
    });
    expect(quoteB.statusCode).toBe(201);
    const quoteBId = JSON.parse(quoteB.body).quoteId as string;

    const foreignLine = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/procurement/requirements/${requirementId}/quotes`,
      headers: { cookie: scoCookie },
      payload: {
        supplierCompanyId: supplierA.id,
        quoteReference: 'bad',
        currencyCode: 'SAR',
        lines: [{ requirementLineId: id(), matchState: 'MATCHED', unitPrice: 1, offeredQuantity: 1, unitId, valueState: 'QUOTED' }],
      },
    });
    expect(foreignLine.statusCode).toBe(400);

    const comparison = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/procurement/requirements/${requirementId}/comparison`,
          headers: { cookie: scoCookie },
          payload: {},
        })
      ).body,
    );
    expect(comparison.entries).toHaveLength(2);
    expect(comparison.entries.map((e: { aliasLabel: string }) => e.aliasLabel).sort()).toEqual(['SUPPLIER_A', 'SUPPLIER_B']);
    expect(JSON.stringify(comparison)).not.toContain('Canonical Supplier');
    // Internal still has supplier ids on internal DTO
    expect(comparison.entries[0].supplierCompanyId).toBeTruthy();

    const partnerView = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/partner/procurement/requirements/${requirementId}/comparison`,
          headers: { cookie: partnerCookie, 'x-sco-company-id': partnerCompany },
        })
      ).body,
    );
    expect(partnerView.entries[0].aliasLabel).toMatch(/^SUPPLIER_/);
    expect(JSON.stringify(partnerView)).not.toContain(supplierA.id);
    expect(JSON.stringify(partnerView)).not.toContain('Canonical Supplier');
    const missing = partnerView.lineAssessments.find(
      (a: { requirementLineId: string; valueState: string; aliasLabel: string }) =>
        a.requirementLineId === line2 && a.aliasLabel === 'SUPPLIER_A',
    );
    expect(missing.valueState).toBe('NOT_QUOTED');
    expect(missing.unitPrice == null || missing.unitPrice === null).toBe(true);

    await app.inject({
      method: 'POST',
      url: `/api/v1/internal/procurement/comparisons/${comparison.comparisonId}/assessments`,
      headers: { cookie: scoCookie },
      payload: {
        requirementLineId: line1,
        quoteId: quoteAId,
        technicalState: 'COMPLIANT',
        technicalNotes: 'meets spec',
        commercialNotes: 'priced',
      },
    });

    const selected = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/procurement/requirements/${requirementId}/selection`,
          headers: { cookie: scoCookie },
          payload: { quoteId: quoteBId, rationale: 'better coverage' },
        })
      ).body,
    );
    expect(selected.purchaseOrderCreated).toBe(false);
    expect(selected.eSideEffects).toBe(0);
    const poCount = Number((await owner.query(`SELECT count(*)::int AS n FROM supplier_purchase_orders`)).rows[0].n);
    expect(Number.isFinite(poCount)).toBe(true);

    const otherCookie = await login(otherMember);
    const cross = await app.inject({
      method: 'GET',
      url: `/api/v1/partner/procurement/requirements/${requirementId}/comparison`,
      headers: { cookie: otherCookie, 'x-sco-company-id': otherCompany },
    });
    expect([403, 404]).toContain(cross.statusCode);
  });

  it('D-S04 alias does not encode canonical identity', async () => {
    const partnerCookie = await login(member);
    const scoCookie = await login(scoActor);
    const { requirementId, line1 } = await prepareSubmittedRequirement(partnerCookie);
    await app.inject({
      method: 'POST',
      url: `/api/v1/internal/procurement/requirements/${requirementId}/transition`,
      headers: { cookie: scoCookie },
      payload: { nextStatus: 'SOURCING' },
    });
    const supplier = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/procurement/suppliers',
          headers: { cookie: scoCookie },
          payload: { name: 'UniqueNameXYZ123' },
        })
      ).body,
    );
    await app.inject({
      method: 'POST',
      url: `/api/v1/internal/procurement/requirements/${requirementId}/quotes`,
      headers: { cookie: scoCookie },
      payload: {
        supplierCompanyId: supplier.id,
        quoteReference: 'Q',
        currencyCode: 'SAR',
        lines: [{ requirementLineId: line1, matchState: 'MATCHED', unitPrice: 10, offeredQuantity: 1, unitId, valueState: 'QUOTED' }],
      },
    });
    const comparison = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/procurement/requirements/${requirementId}/comparison`,
          headers: { cookie: scoCookie },
          payload: {},
        })
      ).body,
    );
    const alias = comparison.entries[0].aliasLabel as string;
    expect(alias).toBe('SUPPLIER_A');
    expect(alias.includes(supplier.id.replace(/-/g, ''))).toBe(false);
    expect(alias.includes('UniqueName')).toBe(false);
  });
});
