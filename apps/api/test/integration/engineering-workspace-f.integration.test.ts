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
let engineer: string;

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
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,'ACTIVE')`, [userId, `${userId}@f-core.test`, passwordHash]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
  for (const permission of permissions) await grant(userId, companyId, permission);
  if (classD) await establishClassDPartnerEligibility(owner, userId, companyId);
  return userId;
}

async function login(userId: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: `${userId}@f-core.test`, password },
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
    const content = `F-core partnership terms ${policyId}`;
    const sha = createHash('sha256').update(content).digest('hex');
    await owner.query(
      `INSERT INTO partner_agreement_policy_versions(
         id, agreement_type, version_code, content_text, content_sha256, required, effective_at,
         acceptance_permission_code, reacceptance_required, suspension_effect, termination_effect,
         retention_classification, state, created_by
       ) VALUES ($1,'PARTNERSHIP_TERMS',$2,$3,$4,true,now()-interval '1 minute','partner.agreement.accept',false,
         'NO_ACCESS_CHANGE','NO_ACCESS_CHANGE','F_CORE','PUBLISHED',$5)`,
      [policyId, `f-pt-${policyId}`, content, sha, userId],
    );
    policy = { id: policyId, content_sha256: sha, version_code: `f-pt-${policyId}` };
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
      `f-pt-${companyId}-${policy.version_code}`, createHash('sha256').update(acceptanceId).digest('hex'), id(),
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

async function insertPartnerDocument(companyId: string, userId: string) {
  const documentId = id();
  await owner.query(
    `INSERT INTO documents(id,company_id,uploader_user_id,filename,detected_mime_type,byte_size,storage_key,sha256,status,access_scope)
     VALUES($1,$2,$3,'drawing.pdf','application/pdf',100,$4,$5,'AVAILABLE','TENANT')`,
    [documentId, companyId, userId, `eng/${documentId}`, createHash('sha256').update(documentId).digest('hex')],
  );
  return documentId;
}

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  partnerA = id();
  partnerB = id();
  scoCompany = id();
  await owner.query(
    `INSERT INTO "Company"(id,name,type,status) VALUES
      ($1,'F Partner A','PARTNER','ACTIVE'),
      ($2,'F Partner B','PARTNER','ACTIVE'),
      ($3,'F SCO','SCO','ACTIVE')`,
    [partnerA, partnerB, scoCompany],
  );
  unitId = id();
  await owner.query(`INSERT INTO unit_definitions(id,code,name,dimension,active) VALUES($1,$2,'Each','count',true)`, [
    unitId,
    `f-${unitId}`,
  ]);

  memberA = await createUser(
    partnerA,
    ['engineering.request.write', 'engineering.request.read', 'partner.portal.read', 'partner.agreement.accept'],
    true,
  );
  memberB = await createUser(
    partnerB,
    ['engineering.request.write', 'engineering.request.read', 'partner.portal.read', 'partner.agreement.accept'],
    true,
  );
  scoActor = await createUser(scoCompany, [
    'sco.internal.manage',
    'engineering.request.review',
    'engineering.request.assign',
    'engineering.boq.edit',
    'engineering.boq.approve',
  ]);
  engineer = await createUser(scoCompany, ['sco.internal.manage', 'engineering.request.review', 'engineering.boq.edit']);
  await acceptPartnershipTerms(partnerA, memberA);
  await acceptPartnershipTerms(partnerB, memberB);

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

describe('F engineering workspace', () => {
  it('F-R/D/B/RES/H request BOQ approval Partner result and D handoff', async () => {
    const cookieA = await login(memberA);
    const cookieB = await login(memberB);
    const scoCookie = await login(scoActor);

    // F-R01/R02 create + draft save
    const created = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/partner/engineering/requests',
          headers: { cookie: cookieA, 'x-sco-company-id': partnerA },
          payload: { title: 'Riyadh HVAC BOQ', sector: 'HVAC', description: 'Need engineered BOQ', projectReference: 'PRJ-1' },
        })
      ).body,
    );
    expect(created.status).toBe('DRAFT');

    const updated = JSON.parse(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/v1/partner/engineering/requests/${created.id}`,
          headers: { cookie: cookieA, 'x-sco-company-id': partnerA },
          payload: { title: 'Riyadh HVAC BOQ v1', sector: 'HVAC', description: 'Updated', projectReference: 'PRJ-1' },
        })
      ).body,
    );
    expect(updated.title).toBe('Riyadh HVAC BOQ v1');

    // F-D01/D03 document link + classification
    const docId = await insertPartnerDocument(partnerA, memberA);
    const linked = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/partner/engineering/requests/${created.id}/documents`,
          headers: { cookie: cookieA, 'x-sco-company-id': partnerA },
          payload: { documentId: docId, classification: 'DRAWING' },
        })
      ).body,
    );
    expect(linked.classification).toBe('DRAWING');

    // F-D02 foreign doc denied
    const foreignDoc = await insertPartnerDocument(partnerB, memberB);
    const foreignLink = await app.inject({
      method: 'POST',
      url: `/api/v1/partner/engineering/requests/${created.id}/documents`,
      headers: { cookie: cookieA, 'x-sco-company-id': partnerA },
      payload: { documentId: foreignDoc, classification: 'SPECIFICATION' },
    });
    expect([400, 403, 404]).toContain(foreignLink.statusCode);

    // F-R03 submit
    const submitted = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/partner/engineering/requests/${created.id}/submit`,
          headers: { cookie: cookieA, 'x-sco-company-id': partnerA },
          payload: {},
        })
      ).body,
    );
    expect(submitted.status).toBe('SUBMITTED');

    // F-R04 cross-company denied
    const cross = await app.inject({
      method: 'GET',
      url: `/api/v1/partner/engineering/requests/${created.id}`,
      headers: { cookie: cookieB, 'x-sco-company-id': partnerB },
    });
    expect([403, 404]).toContain(cross.statusCode);

    // F-R05 internal queue
    const queueResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/internal/engineering/requests',
      headers: { cookie: scoCookie },
    });
    expect(queueResponse.statusCode).toBe(200);
    const queue = JSON.parse(queueResponse.body);
    expect(Array.isArray(queue)).toBe(true);
    expect(queue.some((r: { id: string }) => r.id === created.id)).toBe(true);

    // F-R07 Partner assignment denied
    const partnerAssign = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/engineering/requests/${created.id}/assign`,
      headers: { cookie: cookieA, 'x-sco-company-id': partnerA },
      payload: { engineerUserId: engineer },
    });
    expect(partnerAssign.statusCode).toBe(403);

    // F-R06 assignment
    const assigned = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/engineering/requests/${created.id}/assign`,
          headers: { cookie: scoCookie },
          payload: { engineerUserId: engineer },
        })
      ).body,
    );
    expect(assigned.assignedEngineerId).toBe(engineer);
    expect(assigned.status).toBe('ASSIGNED');

    await app.inject({
      method: 'POST',
      url: `/api/v1/internal/engineering/requests/${created.id}/transition`,
      headers: { cookie: scoCookie },
      payload: { nextStatus: 'IN_REVIEW' },
    });

    // F-R08 action required
    const actionReq = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/engineering/requests/${created.id}/transition`,
          headers: { cookie: scoCookie },
          payload: { nextStatus: 'ACTION_REQUIRED', reason: 'Missing duct schedule' },
        })
      ).body,
    );
    expect(actionReq.status).toBe('ACTION_REQUIRED');

    // F-R09 Partner resubmit
    const resubmit = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/partner/engineering/requests/${created.id}/submit`,
          headers: { cookie: cookieA, 'x-sco-company-id': partnerA },
          payload: {},
        })
      ).body,
    );
    expect(['IN_REVIEW', 'SUBMITTED']).toContain(resubmit.status);

    // F-B01 create draft BOQ
    await app.inject({
      method: 'POST',
      url: `/api/v1/internal/engineering/requests/${created.id}/transition`,
      headers: { cookie: scoCookie },
      payload: { nextStatus: 'BOQ_IN_PROGRESS' },
    });
    // may already be IN_REVIEW — create BOQ from assigned/in_review/boq
    const boq = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/engineering/requests/${created.id}/boq-versions`,
          headers: { cookie: scoCookie },
          payload: {},
        })
      ).body,
    );
    expect(boq.status).toBe('DRAFT');
    expect(boq.versionNumber).toBe(1);

    // F-B02/B03/B04/B05 line
    const withLine = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/engineering/boq-versions/${boq.id}/lines`,
          headers: { cookie: scoCookie },
          payload: {
            description: 'AHU-01',
            specification: '50 TR',
            discipline: 'HVAC',
            quantity: 2.5,
            unitId,
            brandPreference: 'Carrier',
            sourceDocumentId: docId,
            sourceReference: 'Sheet M-101',
            engineeringNotes: 'internal sizing note',
            partnerVisibleNotes: 'Approved AHU',
          },
        })
      ).body,
    );
    const lineId = withLine.upsertedLineId as string;
    expect(lineId).toBeTruthy();
    expect(withLine.lines[0].id).toBe(lineId);

    const badQty = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/engineering/boq-versions/${boq.id}/lines`,
      headers: { cookie: scoCookie },
      payload: { description: 'bad', quantity: 0, unitId },
    });
    expect(badQty.statusCode).toBe(400);

    // F-RES03 unapproved hidden as approvedResult null
    const beforeApprove = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/partner/engineering/requests/${created.id}/result`,
          headers: { cookie: cookieA, 'x-sco-company-id': partnerA },
        })
      ).body,
    );
    expect(beforeApprove.approvedResult).toBeNull();

    // F-B07 approve
    const approved = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/engineering/boq-versions/${boq.id}/approve`,
          headers: { cookie: scoCookie },
          payload: {},
        })
      ).body,
    );
    expect(approved.status).toBe('APPROVED');

    // F-B08 immutable
    const mutateApproved = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/engineering/boq-versions/${boq.id}/lines`,
      headers: { cookie: scoCookie },
      payload: { description: 'should fail', quantity: 1, unitId },
    });
    expect(mutateApproved.statusCode).toBe(400);

    // F-B10 concurrent approval idempotent
    const approveAgain = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/engineering/boq-versions/${boq.id}/approve`,
          headers: { cookie: scoCookie },
          payload: {},
        })
      ).body,
    );
    expect(approveAgain.status).toBe('APPROVED');

    // F-RES01/02/04 Partner result
    const result = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/partner/engineering/requests/${created.id}/result`,
          headers: { cookie: cookieA, 'x-sco-company-id': partnerA },
        })
      ).body,
    );
    expect(result.approvedResult.versionNumber).toBe(1);
    expect(result.approvedResult.lines[0].description).toBe('AHU-01');
    expect(JSON.stringify(result)).not.toContain('internal sizing note');
    expect(JSON.stringify(result)).not.toContain('engineeringNotes');

    const csv = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/partner/engineering/requests/${created.id}/result/export`,
          headers: { cookie: cookieA, 'x-sco-company-id': partnerA },
        })
      ).body,
    );
    expect(csv.body).toContain('AHU-01');
    expect(csv.contentType).toContain('text/csv');

    // F-H01/H03/H05 handoff
    const handoff = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/engineering/boq-versions/${boq.id}/handoff-to-d`,
          headers: { cookie: scoCookie },
          payload: { deliveryLocation: 'Riyadh Warehouse', idempotencyKey: 'handoff-v1' },
        })
      ).body,
    );
    expect(handoff.procurementRequirementId).toBeTruthy();
    const handoffDup = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/engineering/boq-versions/${boq.id}/handoff-to-d`,
          headers: { cookie: scoCookie },
          payload: { deliveryLocation: 'Riyadh Warehouse', idempotencyKey: 'handoff-v1' },
        })
      ).body,
    );
    expect(handoffDup.handoffId).toBe(handoff.handoffId);

    const dLines = await owner.query(
      `SELECT description, quantity, unit_id, brand_preference FROM procurement_requirement_lines WHERE requirement_id=$1`,
      [handoff.procurementRequirementId],
    );
    expect(dLines.rows).toHaveLength(1);
    expect(dLines.rows[0].description).toBe('AHU-01');
    expect(Number(dLines.rows[0].quantity)).toBe(2.5);
    expect(dLines.rows[0].brand_preference).toBe('Carrier');

    // F-H02 unapproved blocked — create v2 draft then try handoff before approve
    const boq2 = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/engineering/requests/${created.id}/boq-versions`,
          headers: { cookie: scoCookie },
          payload: {},
        })
      ).body,
    );
    expect(boq2.versionNumber).toBe(2);
    expect(boq2.lines.length).toBeGreaterThanOrEqual(1); // copied from v1
    const unapprovedHandoff = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/engineering/boq-versions/${boq2.id}/handoff-to-d`,
      headers: { cookie: scoCookie },
      payload: { deliveryLocation: 'Riyadh', idempotencyKey: 'handoff-v2-early' },
    });
    expect(unapprovedHandoff.statusCode).toBe(400);

    // F-B09 revision preserves history — approve v2 after line change
    await app.inject({
      method: 'POST',
      url: `/api/v1/internal/engineering/boq-versions/${boq2.id}/lines`,
      headers: { cookie: scoCookie },
      payload: {
        lineId: boq2.lines[0].id,
        description: 'AHU-01 revised',
        quantity: 3,
        unitId,
        specification: '60 TR',
      },
    });
    const approved2 = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/engineering/boq-versions/${boq2.id}/approve`,
          headers: { cookie: scoCookie },
          payload: {},
        })
      ).body,
    );
    expect(approved2.status).toBe('APPROVED');
    const v1After = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/internal/engineering/boq-versions/${boq.id}`, headers: { cookie: scoCookie } })).body,
    );
    expect(v1After.status).toBe('SUPERSEDED');
    expect(v1After.lines[0].description).toBe('AHU-01'); // history preserved

    // F-H06 v2 approval does not mutate v1 D requirement
    const dLinesAfter = await owner.query(
      `SELECT description, quantity FROM procurement_requirement_lines WHERE requirement_id=$1`,
      [handoff.procurementRequirementId],
    );
    expect(dLinesAfter.rows[0].description).toBe('AHU-01');
    expect(Number(dLinesAfter.rows[0].quantity)).toBe(2.5);

    // New handoff for v2 creates separate D requirement
    const handoff2 = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/engineering/boq-versions/${boq2.id}/handoff-to-d`,
          headers: { cookie: scoCookie },
          payload: { deliveryLocation: 'Riyadh Warehouse', idempotencyKey: 'handoff-v2' },
        })
      ).body,
    );
    expect(handoff2.procurementRequirementId).not.toBe(handoff.procurementRequirementId);

    // F-H07 cross-tenant handoff blocked (partner cannot call)
    const partnerHandoff = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/engineering/boq-versions/${boq2.id}/handoff-to-d`,
      headers: { cookie: cookieA, 'x-sco-company-id': partnerA },
      payload: { deliveryLocation: 'x', idempotencyKey: 'bad' },
    });
    expect(partnerHandoff.statusCode).toBe(403);

    // Partner B cannot see Partner A result
    const crossResult = await app.inject({
      method: 'GET',
      url: `/api/v1/partner/engineering/requests/${created.id}/result`,
      headers: { cookie: cookieB, 'x-sco-company-id': partnerB },
    });
    expect([403, 404]).toContain(crossResult.statusCode);
  });
});
