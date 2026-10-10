import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import argon2 from 'argon2';
import { AppModule } from '../../src/app.module.js';

const id = () => randomUUID();
const password = randomBytes(32).toString('base64url');
let app: NestFastifyApplication;
let owner: Client;
let scoCompany: string;
let targetCompany: string;
let actor: string;
let unauthorizedActor: string;
let targetUser: string;
const users: string[] = [];
const companies: string[] = [];
const roles: string[] = [];

async function createCompany(type: 'SCO' | 'PARTNER') {
  const company = id();
  await owner.query('INSERT INTO "Company"(id,name,type,status) VALUES($1,$2,$3,\'ACTIVE\')', [company, `Stage016 HTTP ${type} ${company}`, type]);
  companies.push(company);
  return company;
}

async function createUser(company: string, label: string, login = false, member = true) {
  const user = id();
  const hash = login ? await argon2.hash(password, { type: argon2.argon2id }) : 'TEST_ONLY_NO_LOGIN';
  await owner.query('INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,\'ACTIVE\')', [user, `${label}-${user}@stage016-http.test`, hash]);
  if (member) await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), user, company]);
  users.push(user);
  return user;
}

async function grant(user: string, company: string, permission: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [user, company])).rows[0].id;
  const role = id();
  roles.push(role);
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, company, `${permission}-${role}`, permission]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), company, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), company, role, permission]);
}

async function login(user: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${user === actor ? 'actor' : 'unauthorized'}-${user}@stage016-http.test`, password } });
  expect(response.statusCode).toBe(201);
  return response.headers['set-cookie'] as string;
}

async function provision(cookie: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/internal/partner-memberships',
    headers: { cookie },
    payload: body,
  });
}

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  scoCompany = await createCompany('SCO');
  targetCompany = await createCompany('PARTNER');
  actor = await createUser(scoCompany, 'actor', true);
  unauthorizedActor = await createUser(scoCompany, 'unauthorized', true);
  targetUser = await createUser(targetCompany, 'target', false, false);
  await grant(actor, scoCompany, 'sco.internal.manage');
  await grant(actor, scoCompany, 'partner.provision.manage');
  await grant(unauthorizedActor, scoCompany, 'sco.internal.manage');

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  if (owner) {
    await owner.query('DELETE FROM "Session" WHERE "userId" = ANY($1::uuid[])', [users]);
    await owner.query('DELETE FROM audit_logs WHERE action=\'partner.membership.provisioned\' AND actor_user_id = ANY($1::uuid[])', [users]);
    await owner.query('DELETE FROM partner_membership_provision_operations WHERE actor_user_id = ANY($1::uuid[])', [users]);
    if (roles.length) {
      await owner.query('DELETE FROM "RolePermission" WHERE role_id = ANY($1::uuid[])', [roles]);
      await owner.query('DELETE FROM "MembershipRole" WHERE role_id = ANY($1::uuid[])', [roles]);
      await owner.query('DELETE FROM "Role" WHERE id = ANY($1::uuid[])', [roles]);
    }
    await owner.query('DELETE FROM "CompanyMembership" WHERE "userId" = ANY($1::uuid[]) OR "companyId" = ANY($2::uuid[])', [users, companies]);
    await owner.query('DELETE FROM "User" WHERE id = ANY($1::uuid[])', [users]);
    await owner.query('DELETE FROM "Company" WHERE id = ANY($1::uuid[])', [companies]);
    await owner.end();
  }
});

describe('Stage016 R4 HTTP contract and guard', () => {
  it('requires authentication and rejects payload fields outside the frozen contract', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/internal/partner-memberships', payload: { targetUserId: targetUser, targetCompanyId: targetCompany, operationKey: 'no-auth' } })).statusCode).toBe(401);
    const cookie = await login(actor);
    expect((await provision(cookie, { targetUserId: targetUser, targetCompanyId: targetCompany, operationKey: '' })).statusCode).toBe(400);
    expect((await provision(cookie, { targetUserId: targetUser, targetCompanyId: targetCompany, operationKey: `http-actor-field-${id()}`, actorId: actor })).statusCode).toBe(400);
    expect((await provision(cookie, { targetUserId: targetUser, targetCompanyId: targetCompany, operationKey: `http-tenant-field-${id()}`, tenantId: scoCompany })).statusCode).toBe(400);
  });

  it('authenticates the central actor and returns the deterministic typed success contract', async () => {
    const cookie = await login(actor);
    const response = await provision(cookie, { targetUserId: targetUser, targetCompanyId: targetCompany, operationKey: `http-success-${id()}` });
    expect(response.statusCode).toBe(201);
    expect(Object.keys(JSON.parse(response.body)).sort()).toEqual(['companyId', 'membershipId', 'membershipStatus', 'operationId', 'outcome', 'userId'].sort());
    expect(JSON.parse(response.body)).toMatchObject({ userId: targetUser, companyId: targetCompany, membershipStatus: 'ACTIVE', outcome: 'CREATED' });
  });

  it('returns ALREADY_EXISTS, REPLAYED, and a 409 idempotency conflict', async () => {
    const cookie = await login(actor);
    const key = `http-replay-${id()}`;
    const first = await provision(cookie, { targetUserId: targetUser, targetCompanyId: targetCompany, operationKey: key });
    expect(JSON.parse(first.body).outcome).toBe('ALREADY_EXISTS');
    const replay = await provision(cookie, { targetUserId: targetUser, targetCompanyId: targetCompany, operationKey: key });
    expect(JSON.parse(replay.body)).toMatchObject({ operationId: JSON.parse(first.body).operationId, outcome: 'REPLAYED', membershipStatus: 'ACTIVE' });
    const otherUser = await createUser(targetCompany, 'conflict');
    const conflict = await provision(cookie, { targetUserId: otherUser, targetCompanyId: targetCompany, operationKey: key });
    expect(conflict.statusCode).toBe(409);
  });

  it('denies unauthorized actors and invalid user/company targets', async () => {
    const unauthorized = await provision(await login(unauthorizedActor), { targetUserId: targetUser, targetCompanyId: targetCompany, operationKey: `http-unauthorized-${id()}` });
    expect(unauthorized.statusCode).toBe(403);
    const cookie = await login(actor);
    expect((await provision(cookie, { targetUserId: id(), targetCompanyId: targetCompany, operationKey: `http-invalid-user-${id()}` })).statusCode).toBe(403);
    expect((await provision(cookie, { targetUserId: targetUser, targetCompanyId: scoCompany, operationKey: `http-invalid-company-${id()}` })).statusCode).toBe(403);
  });

  it('does not create a MembershipRole side effect', async () => {
    const count = Number((await owner.query('SELECT count(*)::int AS count FROM "MembershipRole" mr JOIN "CompanyMembership" cm ON cm.id=mr.membership_id WHERE cm."userId"=$1 AND cm."companyId"=$2', [targetUser, targetCompany])).rows[0].count);
    expect(count).toBe(0);
  });
});
