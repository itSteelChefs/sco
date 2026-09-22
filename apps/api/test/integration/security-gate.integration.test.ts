import { createHash, randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import argon2 from 'argon2';
import { AppModule } from '../../src/app.module.js';
import { RuntimeDatabaseService } from '../../src/database/runtime-database.service.js';
import { TenantTransactionService } from '../../src/database/tenant-transaction.service.js';

const companyA = '00000000-0000-4000-8000-000000000001';
const companyB = '00000000-0000-4000-8000-000000000002';
const companyC = '00000000-0000-4000-8000-000000000003';
const userA = '10000000-0000-4000-8000-000000000001';
const multiUser = '10000000-0000-4000-8000-000000000002';
const suspendedUser = '10000000-0000-4000-8000-000000000003';
const revokedUser = '10000000-0000-4000-8000-000000000004';
const disabledUser = '10000000-0000-4000-8000-000000000005';
const password = randomBytes(32).toString('base64url');

let app: NestFastifyApplication;
let owner: Client;

async function login(email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  return response.headers['set-cookie'] as string;
}

async function requestAs(
  cookie: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  companyId?: string,
  payload?: unknown,
) {
  return app.inject({
    method: method as never,
    url,
    headers: {
      cookie,
      ...(companyId ? { 'x-sco-company-id': companyId } : {}),
    },
    payload: payload as never,
  });
}

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  await owner.query('DELETE FROM "Session"');
  await owner.query('DELETE FROM "CompanyMembership"');
  await owner.query('DELETE FROM "User"');
  await owner.query('DELETE FROM "Company"');
  await owner.query(
    `INSERT INTO "Company" (id, name, type) VALUES
      ($1, 'Partner A', 'PARTNER'),
      ($2, 'Partner B', 'PARTNER'),
      ($3, 'Partner C', 'PARTNER')`,
    [companyA, companyB, companyC],
  );
  await owner.query(
    `INSERT INTO "User" (id, email, "passwordHash", status) VALUES
      ($1, 'partner-a@sco.test', $6, 'ACTIVE'),
      ($2, 'multi@sco.test', $6, 'ACTIVE'),
      ($3, 'suspended@sco.test', $6, 'ACTIVE'),
      ($4, 'revoked@sco.test', $6, 'ACTIVE'),
      ($5, 'disabled@sco.test', $6, 'ACTIVE')`,
    [userA, multiUser, suspendedUser, revokedUser, disabledUser, passwordHash],
  );
  await owner.query(
    `INSERT INTO "CompanyMembership" ("userId", "companyId", status) VALUES
      ($1, $6, 'ACTIVE'),
      ($2, $6, 'ACTIVE'),
      ($2, $7, 'ACTIVE'),
      ($3, $6, 'SUSPENDED'),
      ($4, $6, 'REVOKED'),
      ($5, $6, 'ACTIVE')`,
    [userA, multiUser, suspendedUser, revokedUser, disabledUser, companyA, companyB],
  );

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

describe('Security Gate: request → authentication → membership → tenant → RLS', () => {
  it('does not create a tenant transaction for an unauthenticated request', async () => {
    const tenantTransactions = app.get(TenantTransactionService);
    const tenantQuery = vi.spyOn(tenantTransactions, 'withTenant');
    const response = await app.inject({ method: 'GET', url: '/api/v1/companies/current/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: 'UNAUTHENTICATED' } });
    expect(tenantQuery).not.toHaveBeenCalled();
    tenantQuery.mockRestore();
  });

  it('does not disclose whether an email exists on failed login', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'unknown@sco.test', password: 'wrong-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: 'INVALID_CREDENTIALS' } });
  });

  it('allows Partner A to read its own resolved company and sets the PostgreSQL tenant context', async () => {
    const cookie = await login('partner-a@sco.test');
    const response = await requestAs(cookie, 'GET', '/api/v1/companies/current/me');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: companyA, tenantId: companyA });
  });

  it('prevents Partner A from reading, updating, or deleting Partner B data by known UUID', async () => {
    const cookie = await login('partner-a@sco.test');
    const probeB = '20000000-0000-4000-8000-000000000002';

    for (const [method, payload] of [
      ['GET', undefined],
      ['PATCH', { label: 'cross-tenant-attack' }],
      ['DELETE', undefined],
    ] as const) {
      const response = await requestAs(cookie, method, `/api/v1/tenant-probes/${probeB}`, companyA, payload);
      expect(response.statusCode).toBe(404);
    }

    const unchanged = await owner.query('SELECT label FROM tenant_probes WHERE id = $1', [probeB]);
    expect(unchanged.rows[0].label).toBe('company-b');
  });

  it('rejects a manually changed tenant header that names Company B', async () => {
    const cookie = await login('partner-a@sco.test');
    const tenantTransactions = app.get(TenantTransactionService);
    const tenantQuery = vi.spyOn(tenantTransactions, 'withTenant');
    const response = await requestAs(cookie, 'GET', '/api/v1/companies/current/me', companyB);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: 'FORBIDDEN' } });
    expect(tenantQuery).not.toHaveBeenCalled();
    tenantQuery.mockRestore();
  });

  it('rejects SUSPENDED and REVOKED memberships before a tenant query starts', async () => {
    for (const email of ['suspended@sco.test', 'revoked@sco.test']) {
      const cookie = await login(email);
      const response = await requestAs(cookie, 'GET', '/api/v1/companies/current/me', companyA);
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: { code: 'FORBIDDEN' } });
    }
  });

  it('rejects a disabled user even when the session was created while active', async () => {
    const cookie = await login('disabled@sco.test');
    await owner.query('UPDATE "User" SET status = $2 WHERE id = $1', [disabledUser, 'DISABLED']);

    const response = await requestAs(cookie, 'GET', '/api/v1/companies/current/me', companyA);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('requires explicit tenant selection for a user with multiple active memberships', async () => {
    const cookie = await login('multi@sco.test');
    const absent = await requestAs(cookie, 'GET', '/api/v1/companies/current/me');
    const selected = await requestAs(cookie, 'GET', '/api/v1/companies/current/me', companyB);

    expect(absent.statusCode).toBe(400);
    expect(absent.json()).toEqual({ error: { code: 'TENANT_CONTEXT_REQUIRED' } });
    expect(selected.statusCode).toBe(200);
    expect(selected.json()).toMatchObject({ id: companyB, tenantId: companyB });
  });

  it('uses the non-owner, non-BYPASSRLS role for API database access', async () => {
    const runtime = app.get(RuntimeDatabaseService);
    expect(await runtime.currentRole()).toBe('sco_runtime');

    const metadata = await owner.query(
      `SELECT r.rolbypassrls, EXISTS (
        SELECT 1 FROM pg_class c WHERE c.relowner = r.oid
      ) AS owns_table
      FROM pg_roles r WHERE r.rolname = 'sco_runtime'`,
    );
    expect(metadata.rows[0]).toEqual({ rolbypassrls: false, owns_table: false });
  });

  it('stores opaque session identifiers only as hashes', async () => {
    const cookie = await login('partner-a@sco.test');
    const token = /sco_session=([^;]+)/.exec(cookie)?.[1];
    expect(token).toBeTruthy();
    const expectedHash = createHash('sha256').update(token!).digest('hex');
    const stored = await owner.query(
      'SELECT "tokenHash" FROM "Session" WHERE "userId" = $1 AND "tokenHash" = $2',
      [userA, expectedHash],
    );
    expect(stored.rows[0].tokenHash).toBe(expectedHash);
    expect(stored.rows[0].tokenHash).not.toBe(token);
  });
});
