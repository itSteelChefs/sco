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
let unitId: string;
let member: string;
let outsider: string;
let otherMember: string;

async function grant(userId: string, companyId: string, code: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, companyId])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, companyId, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), companyId, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), companyId, role, code]);
}

async function createUser(companyId: string, permissions: string[], classD = false) {
  const userId = id();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,'ACTIVE')`, [userId, `${userId}@wave2.test`, passwordHash]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
  for (const permission of permissions) await grant(userId, companyId, permission);
  if (classD) await establishClassDPartnerEligibility(owner, userId, companyId);
  return userId;
}

async function login(userId: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${userId}@wave2.test`, password } });
  expect(response.statusCode).toBe(201);
  return response.headers['set-cookie'] as string;
}

const draftBody = {
  companyName: 'Wave2 Partner Co',
  commercialIdentifier: 'CR-123',
  responsiblePerson: 'Ada Partner',
  contact: 'ada@wave2.test',
  city: 'Riyadh',
  sector: 'HVAC_REFRIGERATION',
  needType: 'VERIFY_QUOTE_CHECK',
  procurementSize: 'MEDIUM',
  procurementFrequency: 'MONTHLY',
};

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  partnerCompany = id();
  otherCompany = id();
  await owner.query(`INSERT INTO "Company"(id,name,type,status) VALUES($1,'Wave2 Partner','PARTNER','ACTIVE'),($2,'Other Partner','PARTNER','ACTIVE')`, [partnerCompany, otherCompany]);
  unitId = id();
  await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,\'Each\',\'count\')', [unitId, `w2-${unitId}`]);

  member = await createUser(partnerCompany, [
    'partner.admission.read',
    'partner.qualification.write',
    'partner.document.upload',
    'partner_verify.write',
    'partner_verify.read',
    'partner.portal.read',
  ], true);
  outsider = id();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,'ACTIVE')`, [outsider, `${outsider}@wave2.test`, passwordHash]);
  otherMember = await createUser(otherCompany, ['partner.qualification.write', 'partner.document.upload', 'partner_verify.write', 'partner.admission.read'], true);

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

describe('Wave2 qualification self-serve', () => {
  it('Q-01 member can create draft', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/qualification/draft',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: draftBody,
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({ status: 'DRAFT', companyName: draftBody.companyName, sector: 'HVAC_REFRIGERATION' });
  });

  it('Q-02 nonmember denied', async () => {
    const cookie = await login(outsider);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/qualification/draft',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: draftBody,
    });
    expect([400, 401, 403]).toContain(response.statusCode);
  });

  it('Q-03 cross-company denied', async () => {
    const cookie = await login(otherMember);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/qualification/draft',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: draftBody,
    });
    expect([400, 403]).toContain(response.statusCode);
  });

  it('Q-04 launch required fields validated', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/partner/qualification/draft',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { ...draftBody, city: '' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('Q-05 business identifier optional', async () => {
    const cookie = await login(member);
    const { commercialIdentifier: _, ...without } = draftBody;
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/partner/qualification/draft',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: without,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).commercialIdentifier).toBeNull();
  });

  it('Q-06 draft update works', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/partner/qualification/draft',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { ...draftBody, city: 'Jeddah' },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).city).toBe('Jeddah');
  });

  it('Q-07 submit works', async () => {
    const cookie = await login(member);
    await app.inject({
      method: 'PUT',
      url: '/api/v1/partner/qualification/draft',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: draftBody,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/qualification/submit',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
    });
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).status).toBe('SUBMITTED');
  });

  it('Q-08 duplicate submit converges', async () => {
    const cookie = await login(member);
    const first = await app.inject({ method: 'POST', url: '/api/v1/partner/qualification/submit', headers: { cookie, 'x-sco-company-id': partnerCompany } });
    const second = await app.inject({ method: 'POST', url: '/api/v1/partner/qualification/submit', headers: { cookie, 'x-sco-company-id': partnerCompany } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(JSON.parse(first.body).id).toBe(JSON.parse(second.body).id);
    expect(JSON.parse(second.body).status).toBe('SUBMITTED');
  });

  it('Q-09 submitted cannot be silently edited', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/partner/qualification/draft',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { ...draftBody, city: 'Dammam' },
    });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe('QUALIFICATION_ALREADY_SUBMITTED');
  });

  it('Q-10 only approved launch fields exposed', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/partner/qualification/current',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).not.toHaveProperty('decisionReason');
    expect(body).not.toHaveProperty('reviewedBy');
    expect(Object.keys(body).sort()).toEqual([
      'city',
      'commercialIdentifier',
      'companyName',
      'contact',
      'id',
      'needType',
      'procurementFrequency',
      'procurementSize',
      'responsiblePerson',
      'reviewState',
      'actionRequired',
      'actionRequiredReason',
      'sector',
      'status',
      'submittedAt',
      'updatedAt',
    ].sort());
  });
});

describe('Wave2 partner document upload', () => {
  it('D-01 authorized upload', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/documents/upload',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: {
        category: 'VERIFY_QUOTE',
        filename: 'quote.pdf',
        contentType: 'application/pdf',
        contentBase64: Buffer.from('%PDF-1.4 wave2').toString('base64'),
      },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({ category: 'VERIFY_QUOTE', retentionClass: 'PARTNER_ORIGINAL' });
    expect(body).not.toHaveProperty('storageKey');
    expect(body.documentId).toBeTruthy();
    expect(body.versionId).toBeTruthy();
  });

  it('D-02 unauthenticated denied', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/documents/upload',
      headers: { 'x-sco-company-id': partnerCompany },
      payload: { category: 'GENERAL', filename: 'a.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('x').toString('base64') },
    });
    expect(response.statusCode).toBe(401);
  });

  it('D-03 cross-tenant denied', async () => {
    const cookie = await login(otherMember);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/documents/upload',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { category: 'GENERAL', filename: 'a.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('x').toString('base64') },
    });
    expect([400, 403]).toContain(response.statusCode);
  });

  it('D-04 invalid category denied', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/documents/upload',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { category: 'ARBITRARY_TABLE', filename: 'a.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('x').toString('base64') },
    });
    expect(response.statusCode).toBe(400);
  });

  it('D-05 unsafe filename rejected', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/documents/upload',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { category: 'GENERAL', filename: '../etc/passwd', contentType: 'application/pdf', contentBase64: Buffer.from('x').toString('base64') },
    });
    expect(response.statusCode).toBe(400);
  });

  it('D-06 unsupported content type denied', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/documents/upload',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { category: 'GENERAL', filename: 'a.exe', contentType: 'application/x-msdownload', contentBase64: Buffer.from('x').toString('base64') },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe('DOCUMENT_TYPE_NOT_ALLOWED');
  });

  it('D-07 size limit enforced', async () => {
    const cookie = await login(member);
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/documents/upload',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { category: 'GENERAL', filename: 'big.bin', contentType: 'application/pdf', contentBase64: huge.toString('base64') },
    });
    expect([400, 413]).toContain(response.statusCode);
  });

  it('D-08/D-09 metadata company binding and retention class', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/documents/upload',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { category: 'QUALIFICATION_SUPPORT', filename: 'support.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('support').toString('base64') },
    });
    const body = JSON.parse(response.body);
    const row = (await owner.query('SELECT company_id, retention_class, document_category FROM documents WHERE id=$1', [body.documentId])).rows[0];
    expect(row.company_id).toBe(partnerCompany);
    expect(row.retention_class).toBe('PARTNER_ORIGINAL');
    expect(row.document_category).toBe('QUALIFICATION_SUPPORT');
  });

  it('D-10 audit emitted', async () => {
    const before = Number((await owner.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='document.uploaded' AND actor_user_id=$1`, [member])).rows[0].n);
    const cookie = await login(member);
    await app.inject({
      method: 'POST',
      url: '/api/v1/partner/documents/upload',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { category: 'GENERAL', filename: 'audited.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('a').toString('base64') },
    });
    const after = Number((await owner.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='document.uploaded' AND actor_user_id=$1`, [member])).rows[0].n);
    expect(after).toBeGreaterThan(before);
  });

  it('D-11 arbitrary entity linkage rejected', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/documents/upload',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: {
        category: 'GENERAL',
        filename: 'x.pdf',
        contentType: 'application/pdf',
        contentBase64: Buffer.from('x').toString('base64'),
        linkedEntityType: 'Company',
        linkedEntityId: partnerCompany,
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('D-12 lists tenant metadata and downloads only the authorized private object', async () => {
    const cookie = await login(member);
    const upload = await app.inject({
      method: 'POST', url: '/api/v1/partner/documents/upload',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { category: 'GENERAL', filename: 'downloadable.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('private-document').toString('base64') },
    });
    const documentId = JSON.parse(upload.body).documentId as string;
    const list = await app.inject({ method: 'GET', url: '/api/v1/partner/documents?page=1&pageSize=100', headers: { cookie, 'x-sco-company-id': partnerCompany } });
    expect(list.statusCode).toBe(200);
    const listed = JSON.parse(list.body).items.find((item: { documentId: string }) => item.documentId === documentId);
    expect(listed).toMatchObject({ documentId, filename: 'downloadable.pdf' });
    expect(listed).not.toHaveProperty('storageKey');
    const download = await app.inject({ method: 'GET', url: `/api/v1/partner/documents/${documentId}/download`, headers: { cookie, 'x-sco-company-id': partnerCompany } });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.body).toBe('private-document');
    const audit = await owner.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='document.accessed' AND entity_id=$1`, [documentId]);
    expect(audit.rows[0].n).toBe(1);
  });
});

describe('Wave2 verify write/submit', () => {
  async function uploadQuote(cookie: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/documents/upload',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { category: 'VERIFY_QUOTE', filename: 'q.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF quote').toString('base64') },
    });
    expect(response.statusCode).toBe(201);
    return JSON.parse(response.body) as { documentId: string; versionId: string };
  }

  it('V-01 authorized partner creates Quote Check draft', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/verify/requests',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { productMode: 'QUOTE_CHECK' },
    });
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'DRAFT', productMode: 'QUOTE_CHECK' });
  });

  it('V-02 request type cannot become Price Check', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/verify/requests',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { productMode: 'PRICE_CHECK' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('V-03/V-04 quote document must belong to same company', async () => {
    const cookie = await login(member);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/verify/requests',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { productMode: 'QUOTE_CHECK' },
    });
    const requestId = JSON.parse(created.body).requestId as string;
    const foreignDoc = id();
    const foreignVersion = id();
    await owner.query(
      `INSERT INTO documents(id,company_id,uploader_user_id,filename,detected_mime_type,byte_size,storage_key,sha256,status,access_scope)
       VALUES($1,$2,$3,'f.pdf','application/pdf',1,$4,$5,'AVAILABLE','TENANT')`,
      [foreignDoc, otherCompany, otherMember, `foreign/${foreignDoc}`, createHash('sha256').update('f').digest('hex')],
    );
    await owner.query(`INSERT INTO document_versions(id,company_id,document_id,version,storage_key,sha256) VALUES($1,$2,$3,1,$4,$5)`, [
      foreignVersion, otherCompany, foreignDoc, `foreign/${foreignVersion}`, createHash('sha256').update('f').digest('hex'),
    ]);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/partner/verify/requests/${requestId}/quote`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: {
        documentId: foreignDoc,
        documentVersionId: foreignVersion,
        currencies: ['SAR'],
        idempotencyKey: `idem-${id()}`,
        lines: [{ lineNumber: 1, itemDescription: 'Item', unitId, quantity: 1, currencyCode: 'SAR', unitPrice: 10 }],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe('DOCUMENT_LINK_INVALID');
  });

  it('V-05 submit without quote denied', async () => {
    const cookie = await login(member);
    const created = JSON.parse((await app.inject({
      method: 'POST', url: '/api/v1/partner/verify/requests',
      headers: { cookie, 'x-sco-company-id': partnerCompany }, payload: { productMode: 'QUOTE_CHECK' },
    })).body);
    // Attach with null document is blocked at SQL/service — create revision via SQL without doc then submit via HTTP
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
    await runtime.connect();
    await runtime.query(`SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false)`, [member, partnerCompany]);
    const revision = (await runtime.query(
      `SELECT partner_verify_revision_create($1,$2,$3,$4,$5::text[],$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12) revision_id`,
      [member, partnerCompany, created.requestId, null, ['SAR'], JSON.stringify({}), null, null, `fp-${id()}`,
        JSON.stringify([{ lineNumber: 1, itemDescription: 'Item', unitId, quantity: 1, currencyCode: 'SAR', unitPrice: 10, isPriceBearing: true }]),
        `key-${id()}`, id()],
    )).rows[0].revision_id as string;
    await runtime.end();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/partner/verify/requests/${created.requestId}/submit`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { revisionId: revision },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe('VERIFY_QUOTE_REQUIRED');
  });

  it('V-06 submit with valid quote succeeds', async () => {
    const cookie = await login(member);
    const created = JSON.parse((await app.inject({
      method: 'POST', url: '/api/v1/partner/verify/requests',
      headers: { cookie, 'x-sco-company-id': partnerCompany }, payload: { productMode: 'QUOTE_CHECK' },
    })).body);
    const doc = await uploadQuote(cookie);
    const attached = await app.inject({
      method: 'POST',
      url: `/api/v1/partner/verify/requests/${created.requestId}/quote`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: {
        documentId: doc.documentId,
        documentVersionId: doc.versionId,
        currencies: ['SAR'],
        idempotencyKey: `idem-${id()}`,
        lines: [{ lineNumber: 1, itemDescription: 'Chiller', unitId, quantity: 2, currencyCode: 'SAR', unitPrice: 100 }],
      },
    });
    expect(attached.statusCode).toBe(201);
    const revisionId = JSON.parse(attached.body).revisionId as string;
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/partner/verify/requests/${created.requestId}/submit`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { revisionId },
    });
    expect(submitted.statusCode).toBe(201);
    expect(JSON.parse(submitted.body).status).toBe('SUBMITTED');
  });

  it('V-07 duplicate submit deterministic', async () => {
    const cookie = await login(member);
    const created = JSON.parse((await app.inject({
      method: 'POST', url: '/api/v1/partner/verify/requests',
      headers: { cookie, 'x-sco-company-id': partnerCompany }, payload: { productMode: 'QUOTE_CHECK' },
    })).body);
    const doc = await uploadQuote(cookie);
    const attached = JSON.parse((await app.inject({
      method: 'POST',
      url: `/api/v1/partner/verify/requests/${created.requestId}/quote`,
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: {
        documentId: doc.documentId, documentVersionId: doc.versionId, currencies: ['SAR'], idempotencyKey: `idem-${id()}`,
        lines: [{ lineNumber: 1, itemDescription: 'Pump', unitId, quantity: 1, currencyCode: 'SAR', unitPrice: 50 }],
      },
    })).body);
    const first = await app.inject({
      method: 'POST', url: `/api/v1/partner/verify/requests/${created.requestId}/submit`,
      headers: { cookie, 'x-sco-company-id': partnerCompany }, payload: { revisionId: attached.revisionId },
    });
    const second = await app.inject({
      method: 'POST', url: `/api/v1/partner/verify/requests/${created.requestId}/submit`,
      headers: { cookie, 'x-sco-company-id': partnerCompany }, payload: { revisionId: attached.revisionId },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(JSON.parse(second.body).status).toBe('SUBMITTED');
  });

  it('V-08 Partner cannot set result/confidence via create payload', async () => {
    const cookie = await login(member);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/partner/verify/requests',
      headers: { cookie, 'x-sco-company-id': partnerCompany },
      payload: { productMode: 'QUOTE_CHECK', classification: 'FULL', confidence: 0.99, resultStatus: 'FINAL' },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body).not.toHaveProperty('classification');
    expect(body).not.toHaveProperty('confidence');
    expect(body.status).toBe('DRAFT');
  });

  it('V-11 audit emitted on create', async () => {
    const before = Number((await owner.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='verify.request.created' AND actor_user_id=$1`, [member])).rows[0].n);
    const cookie = await login(member);
    await app.inject({
      method: 'POST', url: '/api/v1/partner/verify/requests',
      headers: { cookie, 'x-sco-company-id': partnerCompany }, payload: { productMode: 'QUOTE_CHECK' },
    });
    const after = Number((await owner.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='verify.request.created' AND actor_user_id=$1`, [member])).rows[0].n);
    expect(after).toBeGreaterThan(before);
  });

  it('V-12 no procurement side effect', async () => {
    const beforeNeeds = Number((await owner.query('SELECT count(*)::int AS n FROM procurement_needs').catch(() => ({ rows: [{ n: 0 }] }))).rows?.[0]?.n ?? 0);
    const cookie = await login(member);
    await app.inject({
      method: 'POST', url: '/api/v1/partner/verify/requests',
      headers: { cookie, 'x-sco-company-id': partnerCompany }, payload: { productMode: 'QUOTE_CHECK' },
    });
    const afterNeeds = Number((await owner.query('SELECT count(*)::int AS n FROM procurement_needs').catch(() => ({ rows: [{ n: 0 }] }))).rows?.[0]?.n ?? 0);
    expect(afterNeeds).toBe(beforeNeeds);
  });
});
