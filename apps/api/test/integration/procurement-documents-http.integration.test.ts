import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import argon2 from 'argon2';
import { AppModule } from '../../src/app.module.js';
import { establishClassDPartnerEligibility } from '../database/class-d-eligibility.fixture.js';

// Real HTTP coverage for POST /api/v1/procurement-documents/:id/extract through the actual guard chain
// (AuthGuard, TenantGuard, ResourceAuthorizationGuard), the domain service and tenant RLS. Document ownership is
// proven by the downstream tenant RLS / domain service, not by any resource owner passed into the guard.

const id = () => randomUUID();
const password = randomBytes(32).toString('base64url');
const STORAGE_MARKER = 'h1-storage-internal-marker';

let app: NestFastifyApplication;
let owner: Client;
let partnerA: string; let partnerB: string; let partnerIneligible: string; let scoCompany: string;
let userA: string; let userNoPermission: string; let userB: string; let userIneligible: string; let userSco: string;

async function grant(userId: string, companyId: string, code: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, companyId])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, companyId, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), companyId, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), companyId, role, code]);
}

async function createUser(companyId: string, permissions: string[], classD: boolean) {
  const userId = id();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,'ACTIVE')`, [userId, `${userId}@h1-docs.test`, passwordHash]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
  for (const permission of permissions) await grant(userId, companyId, permission);
  if (classD) await establishClassDPartnerEligibility(owner, userId, companyId);
  return userId;
}

async function createCompany(label: string, type: 'PARTNER' | 'SCO') {
  const companyId = id();
  await owner.query(`INSERT INTO "Company"(id,name,type) VALUES($1,$2,$3)`, [companyId, `H1 Docs ${label}`, type]);
  return companyId;
}

async function createDocument(companyId: string, uploader: string) {
  const documentId = id();
  await owner.query(
    'INSERT INTO documents (id, company_id, filename, detected_mime_type, byte_size, storage_key, sha256, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [documentId, companyId, 'h1.pdf', 'application/pdf', 1, `${STORAGE_MARKER}/${companyId}/${documentId}`, `hash-${documentId}`, 'AVAILABLE'],
  );
  return (await owner.query<{ id: string }>(
    'INSERT INTO procurement_documents(company_id,uploader_user_id,document_id,filename,document_type) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [companyId, uploader, documentId, 'h1.pdf', 'OTHER'],
  )).rows[0].id;
}

async function login(userId: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${userId}@h1-docs.test`, password } });
  expect(response.statusCode).toBe(201);
  return response.headers['set-cookie'] as string;
}

async function extract(cookie: string, documentId: string, companyId: string, extra: { headers?: Record<string, string>; query?: string; body?: Record<string, unknown> } = {}) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/procurement-documents/${documentId}/extract${extra.query ?? ''}`,
    headers: { cookie, 'x-sco-company-id': companyId, ...(extra.headers ?? {}) },
    payload: extra.body ?? { lines: [] },
  });
}

async function documentState(documentId: string) {
  const row = (await owner.query<{ processing_status: string; extraction_status: string; updated_at: Date }>(
    'SELECT processing_status, extraction_status, updated_at FROM procurement_documents WHERE id=$1', [documentId],
  )).rows[0];
  const lines = Number((await owner.query('SELECT count(*)::int AS count FROM procurement_document_lines WHERE document_id=$1', [documentId])).rows[0].count);
  return { ...row, lines };
}

async function auditRows(actorUserId: string, action: string) {
  return (await owner.query(
    `SELECT metadata, authorization_decision, purpose_code FROM audit_logs WHERE actor_user_id=$1 AND action=$2 ORDER BY created_at DESC, id DESC`,
    [actorUserId, action],
  )).rows as Array<{ metadata: Record<string, unknown>; authorization_decision: string; purpose_code: string }>;
}

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  partnerA = await createCompany('Partner A', 'PARTNER');
  partnerB = await createCompany('Partner B', 'PARTNER');
  partnerIneligible = await createCompany('Partner Ineligible', 'PARTNER');
  scoCompany = await createCompany('SCO', 'SCO');
  userA = await createUser(partnerA, ['procurement_document.extract'], true);
  userNoPermission = await createUser(partnerA, ['partner.portal.read'], true);
  userB = await createUser(partnerB, ['procurement_document.extract'], true);
  userIneligible = await createUser(partnerIneligible, ['procurement_document.extract'], false);
  userSco = await createUser(scoCompany, ['procurement_document.extract'], false);

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

describe('H1 real HTTP: POST /api/v1/procurement-documents/:id/extract', () => {
  it('extracts a same-tenant document for an authorized, eligible Partner and exposes no storage internals', async () => {
    const documentId = await createDocument(partnerA, userA);
    const cookie = await login(userA);
    const before = (await auditRows(userA, 'authorization.purpose_allowed')).length;
    const response = await extract(cookie, documentId, partnerA, { body: { lines: [{ lineNumber: '1', rawValue: { raw: 'Gree 20TR' }, description: 'Gree 20TR', quantity: 2, unit: 'EA' }] } });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(Object.keys(body).sort()).toEqual(['id', 'lineCount', 'status']);
    expect(body).toMatchObject({ id: documentId, lineCount: 1, status: 'READY_FOR_REVIEW' });
    expect(response.body).not.toMatch(/storage|bucket|credential|secret|signed|https?:\/\/|s3:/i);
    expect(response.body).not.toContain(STORAGE_MARKER);
    expect(await documentState(documentId)).toMatchObject({ processing_status: 'EXTRACTED', extraction_status: 'READY_FOR_REVIEW', lines: 1 });
    const rows = await auditRows(userA, 'authorization.purpose_allowed');
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ authorization_decision: 'ALLOWED', purpose_code: 'PUR-15' });
  });

  it('an existing foreign document is safely not found and is not mutated', async () => {
    const foreignDocument = await createDocument(partnerB, userB);
    const before = await documentState(foreignDocument);
    const cookie = await login(userA);
    const response = await extract(cookie, foreignDocument, partnerA, { body: { lines: [{ rawValue: { raw: 'x' }, description: 'x' }] } });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(foreignDocument);
    expect(await documentState(foreignDocument)).toEqual(before);
    const absent = await extract(cookie, id(), partnerA);
    expect(absent.statusCode).toBe(404);
    expect(absent.body.replace(/[0-9a-f-]{36}/g, '')).toBe(response.body.replace(/[0-9a-f-]{36}/g, ''));
  });

  it('resource substitution: document A authority cannot be used to extract document B, in either direction', async () => {
    const documentA = await createDocument(partnerA, userA);
    const documentB = await createDocument(partnerB, userB);
    const aCookie = await login(userA);
    const bCookie = await login(userB);
    expect((await extract(aCookie, documentB, partnerA)).statusCode).toBe(404);
    expect((await extract(bCookie, documentA, partnerB)).statusCode).toBe(404);
    expect((await extract(aCookie, documentB, partnerB)).statusCode).toBe(403);
    expect(await documentState(documentA)).toMatchObject({ processing_status: 'UPLOADED', lines: 0 });
    expect(await documentState(documentB)).toMatchObject({ processing_status: 'UPLOADED', lines: 0 });
    expect((await extract(aCookie, documentA, partnerA)).statusCode).toBe(201);
    expect(await documentState(documentB)).toMatchObject({ processing_status: 'UPLOADED', lines: 0 });
  });

  it('a malformed document id returns the uniform H1 403 before any database access to the document', async () => {
    const cookie = await login(userA);
    const before = (await auditRows(userA, 'authorization.operation_denied')).length;
    const response = await extract(cookie, 'not-a-uuid', partnerA);
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({ error: { code: 'FORBIDDEN' } });
    const rows = await auditRows(userA, 'authorization.operation_denied');
    expect(rows.length).toBe(before + 1);
    expect(rows[0].metadata).toMatchObject({ operation: 'procurement_document.extract', reason: 'RESOURCE_CONTEXT_MALFORMED', failedLayer: 'RESOURCE_CONTEXT' });
  });

  it('missing the exact extraction permission denies, even with Class D readiness, and does not mutate', async () => {
    const documentId = await createDocument(partnerA, userA);
    const cookie = await login(userNoPermission);
    const response = await extract(cookie, documentId, partnerA);
    expect(response.statusCode).toBe(403);
    expect(await documentState(documentId)).toMatchObject({ processing_status: 'UPLOADED', lines: 0 });
    expect((await auditRows(userNoPermission, 'authorization.operation_denied'))[0].metadata).toMatchObject({ reason: 'PERMISSION_MISSING', failedLayer: 'PERMISSION' });
  });

  it('forged client purpose headers, query and body claims cannot change the registry-owned DOCUMENT_CUSTODY purpose', async () => {
    const documentId = await createDocument(partnerA, userA);
    const cookie = await login(userA);
    const response = await extract(cookie, documentId, partnerA, {
      headers: { 'x-sco-purpose': 'PUR-02', 'x-purpose': 'PUR-17', 'x-purpose-code': 'PUR-17' },
      query: '?purpose=PUR-17&purposeCode=PUR-17&flow=CPF_34',
      body: { lines: [], purpose: 'PUR-17', purposeCode: 'PUR-17', flow: 'CPF_34' },
    });
    expect(response.statusCode).toBe(201);
    const rows = await auditRows(userA, 'authorization.purpose_allowed');
    expect(rows[0]).toMatchObject({ authorization_decision: 'ALLOWED', purpose_code: 'PUR-15' });
    expect(JSON.stringify(rows[0].metadata)).not.toContain('PUR-17');
  });

  it('a PARTNER company failing 0102 procurement eligibility is denied and nothing is mutated', async () => {
    const documentId = await createDocument(partnerIneligible, userIneligible);
    const cookie = await login(userIneligible);
    const allowedBefore = (await auditRows(userIneligible, 'authorization.purpose_allowed')).length;
    const response = await extract(cookie, documentId, partnerIneligible);
    expect(response.statusCode).toBe(403);
    expect(await documentState(documentId)).toMatchObject({ processing_status: 'UPLOADED', lines: 0 });
    expect((await auditRows(userIneligible, 'authorization.purpose_allowed')).length).toBe(allowedBefore);
    expect((await auditRows(userIneligible, 'authorization.operation_denied'))[0].metadata).toMatchObject({ reason: 'PARTNER_NOT_ELIGIBLE', failedLayer: 'PARTNER_ELIGIBILITY' });
  });

  it('a non-PARTNER company keeps working on its own documents, as the 0102 Class D gate intentionally applies only to Partners', async () => {
    const documentId = await createDocument(scoCompany, userSco);
    const cookie = await login(userSco);
    const response = await extract(cookie, documentId, scoCompany);
    expect(response.statusCode).toBe(201);
    expect(await documentState(documentId)).toMatchObject({ processing_status: 'EXTRACTED' });
  });

  it('a foreign company header cannot widen access: the user has no membership in the target company', async () => {
    const documentId = await createDocument(partnerB, userB);
    const cookie = await login(userA);
    expect((await extract(cookie, documentId, partnerB)).statusCode).toBe(403);
    expect((await extract(cookie, documentId, 'not-a-uuid')).statusCode).toBe(403);
    expect(await documentState(documentId)).toMatchObject({ processing_status: 'UPLOADED', lines: 0 });
  });

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'POST', url: `/api/v1/procurement-documents/${id()}/extract`, payload: { lines: [] } });
    expect(response.statusCode).toBe(401);
  });
});
