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
let partnerA: string;
let partnerB: string;
let scoCompany: string;
let unitId: string;
let memberA: string;
let memberB: string;
let scoActor: string;
let supplierId: string;

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
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,'ACTIVE')`, [userId, `${userId}@e-core.test`, passwordHash]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
  for (const permission of permissions) await grant(userId, companyId, permission);
  if (classD) await establishClassDPartnerEligibility(owner, userId, companyId);
  return userId;
}

async function login(userId: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: `${userId}@e-core.test`, password },
  });
  expect(response.statusCode).toBe(201);
  return response.headers['set-cookie'] as string;
}

async function acceptPartnershipTerms(companyId: string, userId: string) {
  const existing = await owner.query(
    `SELECT id, content_sha256, version_code FROM partner_agreement_policy_versions
      WHERE agreement_type='PARTNERSHIP_TERMS' AND state='PUBLISHED' ORDER BY effective_at DESC LIMIT 1`,
  );
  let policy = existing.rows[0];
  if (!policy) {
    const policyId = id();
    const content = `E-core partnership terms ${policyId}`;
    const sha = createHash('sha256').update(content).digest('hex');
    await owner.query(
      `INSERT INTO partner_agreement_policy_versions(
         id, agreement_type, version_code, content_text, content_sha256, required, effective_at,
         acceptance_permission_code, reacceptance_required, suspension_effect, termination_effect,
         retention_classification, state, created_by
       ) VALUES ($1,'PARTNERSHIP_TERMS',$2,$3,$4,true,now()-interval '1 minute','partner.agreement.accept',false,
         'NO_ACCESS_CHANGE','NO_ACCESS_CHANGE','E_CORE','PUBLISHED',$5)`,
      [policyId, `e-pt-${policyId}`, content, sha, userId],
    );
    policy = { id: policyId, content_sha256: sha, version_code: `e-pt-${policyId}` };
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
      acceptanceId, companyId, userId, membershipId, policy.id, policy.version_code, policy.content_sha256,
      `e-pt-${companyId}-${policy.version_code}`, createHash('sha256').update(acceptanceId).digest('hex'), id(),
    ],
  );
  const acceptRow = (await owner.query(`SELECT id FROM partner_agreement_acceptances WHERE company_id=$1 AND policy_version_id=$2`, [companyId, policy.id])).rows[0];
  await owner.query(
    `INSERT INTO partner_agreement_acceptance_events(acceptance_id, company_id, status, actor_user_id, correlation_id)
     SELECT $1,$2,'ACCEPTED',$3,$4
     WHERE NOT EXISTS (SELECT 1 FROM partner_agreement_acceptance_events WHERE acceptance_id=$1 AND status='ACCEPTED')`,
    [acceptRow.id, companyId, userId, id()],
  );
}

async function prepareSelection(partnerCookie: string, companyId: string, scoCookie: string, qty: number, title: string) {
  const created = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/partner/procurement/requirements',
        headers: { cookie: partnerCookie, 'x-sco-company-id': companyId },
        payload: { title, sector: 'HVAC', deliveryLocation: 'Riyadh' },
      })
    ).body,
  );
  const lineResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/partner/procurement/requirements/${created.id}/lines`,
    headers: { cookie: partnerCookie, 'x-sco-company-id': companyId },
    payload: { description: `${title} AHU`, quantity: qty, unitId, specification: 'spec' },
  });
  expect(lineResponse.statusCode).toBe(201);
  const lineBody = JSON.parse(lineResponse.body);
  const lineId = (lineBody.upsertedLineId ?? lineBody.lines?.[0]?.id) as string;
  expect(lineId).toBeTruthy();
  const submit = await app.inject({
    method: 'POST',
    url: `/api/v1/partner/procurement/requirements/${created.id}/submit`,
    headers: { cookie: partnerCookie, 'x-sco-company-id': companyId },
    payload: {},
  });
  expect(submit.statusCode).toBe(201);
  const transition = await app.inject({
    method: 'POST',
    url: `/api/v1/internal/procurement/requirements/${created.id}/transition`,
    headers: { cookie: scoCookie },
    payload: { nextStatus: 'SOURCING' },
  });
  expect(transition.statusCode).toBe(201);
  const quoteResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/internal/procurement/requirements/${created.id}/quotes`,
    headers: { cookie: scoCookie },
    payload: {
      supplierCompanyId: supplierId,
      quoteReference: `Q-${title}`,
      currencyCode: 'SAR',
      lines: [
        {
          requirementLineId: lineId,
          matchState: 'MATCHED',
          offeredQuantity: qty,
          unitId,
          unitPrice: 100,
          valueState: 'QUOTED',
        },
      ],
    },
  });
  expect(quoteResponse.statusCode).toBe(201);
  const quote = JSON.parse(quoteResponse.body);
  const comparison = await app.inject({
    method: 'POST',
    url: `/api/v1/internal/procurement/requirements/${created.id}/comparison`,
    headers: { cookie: scoCookie },
    payload: {},
  });
  expect(comparison.statusCode).toBe(201);
  const selectedResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/internal/procurement/requirements/${created.id}/selection`,
    headers: { cookie: scoCookie },
    payload: { quoteId: quote.quoteId, rationale: 'selected for E' },
  });
  expect(selectedResponse.statusCode).toBe(201);
  const selected = JSON.parse(selectedResponse.body);
  const selectionId = (
    await owner.query(`SELECT id FROM procurement_selection_candidates WHERE requirement_id=$1`, [created.id])
  ).rows[0].id as string;
  return {
    requirementId: created.id as string,
    lineId,
    quoteId: quote.quoteId as string,
    selectionId,
    selectionResponse: selected,
  };
}

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  partnerA = id();
  partnerB = id();
  scoCompany = id();
  await owner.query(
    `INSERT INTO "Company"(id,name,type,status) VALUES
      ($1,'E Partner A','PARTNER','ACTIVE'),
      ($2,'E Partner B','PARTNER','ACTIVE'),
      ($3,'E SCO','SCO','ACTIVE')`,
    [partnerA, partnerB, scoCompany],
  );
  unitId = (await owner.query(`SELECT id FROM unit_definitions ORDER BY code LIMIT 1`)).rows[0]?.id;
  if (!unitId) {
    unitId = id();
    await owner.query(`INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,'Each','count')`, [
      unitId,
      `e-unit-${unitId}`,
    ]);
  }
  memberA = await createUser(partnerA, ['procurement.request.write', 'procurement.request.read', 'commercial.order.partner_read', 'partner.portal.read', 'partner.agreement.accept'], true);
  memberB = await createUser(partnerB, ['procurement.request.write', 'procurement.request.read', 'commercial.order.partner_read', 'partner.portal.read', 'partner.agreement.accept'], true);
  scoActor = await createUser(scoCompany, [
    'sco.internal.manage',
    'procurement.review',
    'commercial.purchase.manage',
    'commercial.purchase.approve',
    'commercial.resale.manage',
    'commercial.resale.approve',
  ]);
  await acceptPartnershipTerms(partnerA, memberA);
  await acceptPartnershipTerms(partnerB, memberB);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication(new FastifyAdapter());
  app.useGlobalPipes(new ApiValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const scoCookie = await login(scoActor);
  const supplier = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/internal/procurement/suppliers',
        headers: { cookie: scoCookie },
        payload: { name: 'Canonical Supplier E Co' },
      })
    ).body,
  );
  supplierId = supplier.id as string;
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

describe('E buy & resell', () => {
  it('E-P/C/R/S/X full consolidation resale security path', async () => {
    const cookieA = await login(memberA);
    const cookieB = await login(memberB);
    const scoCookie = await login(scoActor);

    const selA = await prepareSelection(cookieA, partnerA, scoCookie, 10, 'PartnerA-HVAC');
    const selB = await prepareSelection(cookieB, partnerB, scoCookie, 20, 'PartnerB-HVAC');

    // E-P04 Partner forbidden
    const partnerCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/commercial/purchases/from-selection',
      headers: { cookie: cookieA, 'x-sco-company-id': partnerA },
      payload: { selectionCandidateId: selA.selectionId, idempotencyKey: 'p-forbidden' },
    });
    expect(partnerCreate.statusCode).toBe(403);

    // E-P01 / E-P03 idempotent create
    const intentA1 = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/commercial/purchases/from-selection',
          headers: { cookie: scoCookie },
          payload: { selectionCandidateId: selA.selectionId, idempotencyKey: 'intent-a' },
        })
      ).body,
    );
    expect(intentA1.status).toBe('DRAFT');
    expect(intentA1.supplierCompanyId).toBe(supplierId);
    expect(Number(intentA1.purchaseTotal)).toBe(1000);
    const intentA2 = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/commercial/purchases/from-selection',
          headers: { cookie: scoCookie },
          payload: { selectionCandidateId: selA.selectionId, idempotencyKey: 'intent-a' },
        })
      ).body,
    );
    expect(intentA2.id).toBe(intentA1.id);

    // E-P02 invalid selection
    const badSel = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/commercial/purchases/from-selection',
      headers: { cookie: scoCookie },
      payload: { selectionCandidateId: id(), idempotencyKey: 'bad' },
    });
    expect([400, 404]).toContain(badSel.statusCode);

    const intentB = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/commercial/purchases/from-selection',
          headers: { cookie: scoCookie },
          payload: { selectionCandidateId: selB.selectionId, idempotencyKey: 'intent-b' },
        })
      ).body,
    );

    await app.inject({ method: 'POST', url: `/api/v1/internal/commercial/purchases/${intentA1.id}/approve`, headers: { cookie: scoCookie }, payload: {} });
    await app.inject({ method: 'POST', url: `/api/v1/internal/commercial/purchases/${intentB.id}/approve`, headers: { cookie: scoCookie }, payload: {} });

    // E-C01 consolidate
    const order = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/commercial/supplier-orders',
          headers: { cookie: scoCookie },
          payload: { intentIds: [intentA1.id, intentB.id], idempotencyKey: 'po-1', deliveryContext: 'Riyadh warehouse' },
        })
      ).body,
    );
    expect(order.lines).toHaveLength(2);
    expect(Number(order.purchaseTotal)).toBe(3000);
    expect(order.supplierCompanyId).toBe(supplierId);
    expect(order.scoBuyerCompanyId).toBeTruthy();

    // E-C02 incompatible supplier — create second supplier intent path skipped; create order with same intents blocked
    const dupOrder = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/commercial/supplier-orders',
          headers: { cookie: scoCookie },
          payload: { intentIds: [intentA1.id, intentB.id], idempotencyKey: 'po-1' },
        })
      ).body,
    );
    expect(dupOrder.id).toBe(order.id);

    await app.inject({ method: 'POST', url: `/api/v1/internal/commercial/supplier-orders/${order.id}/approve`, headers: { cookie: scoCookie }, payload: {} });
    const issued = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/commercial/supplier-orders/${order.id}/issue`,
          headers: { cookie: scoCookie },
          payload: {},
        })
      ).body,
    );
    expect(issued.status).toBe('ISSUED');
    const issuedAgain = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/commercial/supplier-orders/${order.id}/issue`,
          headers: { cookie: scoCookie },
          payload: {},
        })
      ).body,
    );
    expect(issuedAgain.status).toBe('ISSUED');

    const auditIssue = Number(
      (await owner.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='commercial.supplier_order.issued' AND entity_id=$1`, [order.id]))
        .rows[0].n,
    );
    expect(auditIssue).toBeGreaterThanOrEqual(1);

    const lineA = order.lines.find((l: { partnerCompanyId: string }) => l.partnerCompanyId === partnerA);
    const lineB = order.lines.find((l: { partnerCompanyId: string }) => l.partnerCompanyId === partnerB);
    expect(lineA && lineB).toBeTruthy();

    // E-C04 over-allocation blocked
    const over = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/commercial/allocations',
      headers: { cookie: scoCookie },
      payload: { orderLineId: lineA.id, quantity: 999, idempotencyKey: 'over' },
    });
    expect(over.statusCode).toBe(400);

    const allocA = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/commercial/allocations',
          headers: { cookie: scoCookie },
          payload: { orderLineId: lineA.id, quantity: 10, idempotencyKey: 'alloc-a' },
        })
      ).body,
    );
    const allocB = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/commercial/allocations',
          headers: { cookie: scoCookie },
          payload: { orderLineId: lineB.id, quantity: 20, idempotencyKey: 'alloc-b' },
        })
      ).body,
    );
    expect(Number(allocA.allocatedQuantity)).toBe(10);
    expect(Number(allocB.allocatedQuantity)).toBe(20);

    // Partial confirmation then full
    const partial = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/commercial/supplier-orders/${order.id}/confirm`,
          headers: { cookie: scoCookie },
          payload: {
            confirmationReference: 'SUP-CONF-1',
            lineConfirmations: [
              { lineId: lineA.id, confirmedQuantity: 10 },
              { lineId: lineB.id, confirmedQuantity: 15 },
            ],
          },
        })
      ).body,
    );
    expect(partial.status).toBe('PARTIALLY_CONFIRMED');

    const full = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/commercial/supplier-orders/${order.id}/confirm`,
          headers: { cookie: scoCookie },
          payload: {
            confirmationReference: 'SUP-CONF-2',
            lineConfirmations: [
              { lineId: lineA.id, confirmedQuantity: 10 },
              { lineId: lineB.id, confirmedQuantity: 20 },
            ],
          },
        })
      ).body,
    );
    expect(full.status).toBe('CONFIRMED');

    // Resale per partner with separate sale prices
    const resaleA = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/commercial/resale-orders',
          headers: { cookie: scoCookie },
          payload: {
            partnerCompanyId: partnerA,
            idempotencyKey: 'resale-a',
            paymentTerms: 'CASH',
            allocations: [{ allocationId: allocA.id, saleUnitPrice: 150 }],
          },
        })
      ).body,
    );
    const resaleADup = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/commercial/resale-orders',
          headers: { cookie: scoCookie },
          payload: {
            partnerCompanyId: partnerA,
            idempotencyKey: 'resale-a',
            allocations: [{ allocationId: allocA.id, saleUnitPrice: 150 }],
          },
        })
      ).body,
    );
    expect(resaleADup.id).toBe(resaleA.id);
    expect(Number(resaleA.saleTotal)).toBe(1500);
    expect(Number(resaleA.purchaseCostTotal)).toBe(1000);
    expect(Number(resaleA.grossMargin)).toBe(500);

    const resaleB = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/commercial/resale-orders',
          headers: { cookie: scoCookie },
          payload: {
            partnerCompanyId: partnerB,
            idempotencyKey: 'resale-b',
            allocations: [{ allocationId: allocB.id, saleUnitPrice: 140 }],
          },
        })
      ).body,
    );
    expect(Number(resaleB.saleTotal)).toBe(2800);

    await app.inject({ method: 'POST', url: `/api/v1/internal/commercial/resale-orders/${resaleA.id}/approve`, headers: { cookie: scoCookie }, payload: {} });
    await app.inject({ method: 'POST', url: `/api/v1/internal/commercial/resale-orders/${resaleB.id}/approve`, headers: { cookie: scoCookie }, payload: {} });
    const confirmedA = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/commercial/resale-orders/${resaleA.id}/confirm`,
          headers: { cookie: scoCookie },
          payload: {},
        })
      ).body,
    );
    expect(confirmedA.status).toBe('CONFIRMED');
    expect(confirmedA.fulfillmentReady).toBe(true);
    await app.inject({ method: 'POST', url: `/api/v1/internal/commercial/resale-orders/${resaleB.id}/confirm`, headers: { cookie: scoCookie }, payload: {} });

    // Partner-safe reads
    const listA = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/partner/commercial/orders', headers: { cookie: cookieA, 'x-sco-company-id': partnerA } })).body,
    );
    expect(listA).toHaveLength(1);
    expect(listA[0].orderReference).toBe(resaleA.orderReference);
    expect(JSON.stringify(listA)).not.toContain(supplierId);
    expect(JSON.stringify(listA)).not.toContain('Canonical Supplier');
    expect(JSON.stringify(listA)).not.toContain('grossMargin');
    expect(JSON.stringify(listA)).not.toContain('purchaseCost');

    const viewA = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/partner/commercial/orders/${resaleA.id}`,
          headers: { cookie: cookieA, 'x-sco-company-id': partnerA },
        })
      ).body,
    );
    expect(Number(viewA.saleTotal)).toBe(1500);
    expect(viewA.lines[0].saleUnitPrice).toBeDefined();
    expect(viewA.lines[0].purchaseUnitPrice).toBeUndefined();
    expect(JSON.stringify(viewA)).not.toContain(supplierId);
    expect(viewA.supplierAliasLabel).toMatch(/^SUPPLIER_/);

    // E-C05 / E-X01 cross partner
    const cross = await app.inject({
      method: 'GET',
      url: `/api/v1/partner/commercial/orders/${resaleA.id}`,
      headers: { cookie: cookieB, 'x-sco-company-id': partnerB },
    });
    expect([403, 404]).toContain(cross.statusCode);

    const listB = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/partner/commercial/orders', headers: { cookie: cookieB, 'x-sco-company-id': partnerB } })).body,
    );
    expect(listB).toHaveLength(1);
    expect(listB[0].id).toBe(resaleB.id);
    expect(JSON.stringify(listB)).not.toContain(partnerA);
    expect(JSON.stringify(listB)).not.toContain(resaleA.id);

    // No accounting side effects
    const journal = await owner.query(`SELECT to_regclass('public.journal_entries') AS t`);
    expect(journal.rows[0].t).toBeNull();
    const zatca = await owner.query(`SELECT to_regclass('public.zatca_invoices') AS t`);
    expect(zatca.rows[0].t).toBeNull();
  });
});
