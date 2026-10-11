import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import argon2 from 'argon2';
import { AppModule } from '../../src/app.module.js';
import { ApiValidationPipe } from '../../src/common/http/validation-pipe.js';

const id = () => randomUUID();
const password = randomBytes(32).toString('base64url');

let app: NestFastifyApplication;
let owner: Client;
let scoCompany: string;
let partnerCompany: string;
let scoActor: string;
let scoAssignee: string;
let partnerUser: string;

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

async function createUser(companyId: string, permissions: string[]) {
  const userId = id();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,'ACTIVE')`, [userId, `${userId}@h-core.test`, passwordHash]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
  for (const permission of permissions) await grant(userId, companyId, permission);
  return userId;
}

async function login(userId: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: `${userId}@h-core.test`, password },
  });
  expect(response.statusCode).toBe(201);
  return response.headers['set-cookie'] as string;
}

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  scoCompany = id();
  partnerCompany = id();
  await owner.query(
    `INSERT INTO "Company"(id,name,type,status) VALUES ($1,'H SCO','SCO','ACTIVE'),($2,'H Partner','PARTNER','ACTIVE')`,
    [scoCompany, partnerCompany],
  );
  scoActor = await createUser(scoCompany, [
    'sco.internal.manage',
    'operations.read',
    'operations.assign',
    'operations.retry',
    'operations.cycle.manage',
    'operations.health.read',
    'operations.config.manage',
    'procurement.intelligence.refresh',
    'procurement.intelligence.read',
  ]);
  scoAssignee = await createUser(scoCompany, ['sco.internal.manage', 'operations.read']);
  partnerUser = await createUser(partnerCompany, ['partner.portal.read']);

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

describe('H operational platform', () => {
  it('H-WQ/EX/CYCLE/NOTIF/JOB/AUDIT/HEALTH/CONFIG', async () => {
    const cookie = await login(scoActor);
    const partnerCookie = await login(partnerUser);
    const sourceId = id();

    // Partner denied
    const partnerHealth = await app.inject({
      method: 'GET',
      url: '/api/v1/internal/h-operations/health',
      headers: { cookie: partnerCookie, 'x-sco-company-id': partnerCompany },
    });
    expect(partnerHealth.statusCode).toBe(403);

    // H-WQ create + dedupe
    const created = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/h-operations/work-items',
          headers: { cookie },
          payload: {
            domain: 'D',
            sourceEntityType: 'ProcurementRequirement',
            sourceEntityId: sourceId,
            workType: 'REVIEW',
            priority: 10,
            actionRequired: true,
            nextAction: 'Review requirement',
            partnerCompanyId: partnerCompany,
          },
        })
      ).body,
    );
    expect(created.id).toBeTruthy();
    const replay = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/h-operations/work-items',
          headers: { cookie },
          payload: {
            domain: 'D',
            sourceEntityType: 'ProcurementRequirement',
            sourceEntityId: sourceId,
            workType: 'REVIEW',
            priority: 20,
          },
        })
      ).body,
    );
    expect(replay.id).toBe(created.id);

    // assignment + reassignment
    const assigned = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/h-operations/work-items/${created.id}/assign`,
          headers: { cookie },
          payload: { assigneeUserId: scoAssignee },
        })
      ).body,
    );
    expect(assigned.assignedUserId).toBe(scoAssignee);

    await app.inject({
      method: 'POST',
      url: `/api/v1/internal/h-operations/work-items/${created.id}/assign`,
      headers: { cookie },
      payload: { assigneeUserId: scoActor },
    });

    // blocked
    await app.inject({
      method: 'POST',
      url: `/api/v1/internal/h-operations/work-items/${created.id}/transition`,
      headers: { cookie },
      payload: { status: 'BLOCKED', blockedReason: 'Waiting on Partner docs' },
    });
    const blocked = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/internal/h-operations/work-items?view=blocked', headers: { cookie } })).body,
    );
    expect(blocked.items.some((i: { id: string }) => i.id === created.id)).toBe(true);

    // unassigned view
    const other = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/h-operations/work-items',
          headers: { cookie },
          payload: { domain: 'F', sourceEntityType: 'EngineeringRequest', sourceEntityId: id(), workType: 'ASSIGN_ENGINEER', priority: 30 },
        })
      ).body,
    );
    const unassigned = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/internal/h-operations/work-items?view=unassigned', headers: { cookie } })).body,
    );
    expect(unassigned.items.some((i: { id: string }) => i.id === other.id)).toBe(true);

    // H-EX
    const ex = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/h-operations/exceptions',
          headers: { cookie },
          payload: {
            domain: 'G',
            sourceEntityType: 'GIntelligenceRun',
            sourceEntityId: id(),
            exceptionType: 'REFRESH_FAILED',
            retryable: true,
            safeErrorCode: 'G_REFRESH_FAILED',
            safeErrorMessage: 'Controlled operational failure',
            workItemId: created.id,
          },
        })
      ).body,
    );
    expect(ex.status).toBe('OPEN');
    expect(JSON.stringify(ex)).not.toMatch(/stack|Traceback|at Object\./);

    const ack = JSON.parse(
      (await app.inject({ method: 'POST', url: `/api/v1/internal/h-operations/exceptions/${ex.id}/ack`, headers: { cookie }, payload: {} })).body,
    );
    expect(ack.status).toBe('ACKNOWLEDGED');

    const retried = JSON.parse(
      (await app.inject({ method: 'POST', url: `/api/v1/internal/h-operations/exceptions/${ex.id}/retry`, headers: { cookie }, payload: {} })).body,
    );
    expect(retried.attempt).toBe(1);

    const nonRetry = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/h-operations/exceptions',
          headers: { cookie },
          payload: {
            domain: 'H',
            sourceEntityType: 'HJob',
            sourceEntityId: id(),
            exceptionType: 'FATAL',
            retryable: false,
            safeErrorCode: 'NOT_RETRYABLE',
            safeErrorMessage: 'Permanent failure',
          },
        })
      ).body,
    );
    const badRetry = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/h-operations/exceptions/${nonRetry.id}/retry`,
      headers: { cookie },
      payload: {},
    });
    expect(badRetry.statusCode).toBe(400);

    const resolved = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/h-operations/exceptions/${ex.id}/resolve`,
          headers: { cookie },
          payload: { note: 'Recovered' },
        })
      ).body,
    );
    expect(resolved.status).toBe('RESOLVED');

    // H-CYCLE
    const starts = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    const cutoff = new Date(Date.now() + 1 * 3600 * 1000).toISOString();
    const ends = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    const cycle = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/h-operations/cycles',
          headers: { cookie },
          payload: { startsAt: starts, cutoffAt: cutoff, endsAt: ends },
        })
      ).body,
    );
    expect(cycle.status).toBe('OPEN');

    // attach open work into cycle window by updating created_at via owner for membership
    await owner.query(`UPDATE h_work_items SET created_at = $1 WHERE id = ANY($2::uuid[])`, [
      new Date(Date.now() - 3600 * 1000).toISOString(),
      [created.id, other.id],
    ]);

    const locked = JSON.parse(
      (await app.inject({ method: 'POST', url: `/api/v1/internal/h-operations/cycles/${cycle.id}/lock`, headers: { cookie }, payload: {} })).body,
    );
    expect(locked.status).toBe('LOCKED');
    expect(locked.membershipCount).toBeGreaterThanOrEqual(1);

    const lockedAgain = JSON.parse(
      (await app.inject({ method: 'POST', url: `/api/v1/internal/h-operations/cycles/${cycle.id}/lock`, headers: { cookie }, payload: {} })).body,
    );
    expect(lockedAgain.idempotent).toBe(true);

    // post-cutoff new work should not auto-join locked cycle
    const post = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/h-operations/work-items',
          headers: { cookie },
          payload: { domain: 'E', sourceEntityType: 'CommercialSupplierOrder', sourceEntityId: id(), workType: 'CONFIRM', priority: 40 },
        })
      ).body,
    );
    const cycleAfter = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/internal/h-operations/cycles/${cycle.id}`, headers: { cookie } })).body,
    );
    expect(cycleAfter.memberships.some((m: { workItemId: string }) => m.workItemId === post.id)).toBe(false);

    // privileged override
    const overridden = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/internal/h-operations/cycles/${cycle.id}/override-include`,
          headers: { cookie },
          payload: { workItemId: post.id, reason: 'Urgent Saturday supply exception' },
        })
      ).body,
    );
    expect(overridden.memberships.some((m: { workItemId: string }) => m.workItemId === post.id)).toBe(true);

    const completed = JSON.parse(
      (await app.inject({ method: 'POST', url: `/api/v1/internal/h-operations/cycles/${cycle.id}/complete`, headers: { cookie }, payload: {} })).body,
    );
    expect(completed.status).toBe('COMPLETED');

    // H-NOTIF
    const notif = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/internal/h-operations/notifications?unreadOnly=true', headers: { cookie } })).body,
    );
    expect(notif.unreadCount).toBeGreaterThan(0);
    const first = notif.items[0];
    await app.inject({ method: 'POST', url: `/api/v1/internal/h-operations/notifications/${first.id}/read`, headers: { cookie }, payload: {} });
    await app.inject({ method: 'POST', url: '/api/v1/internal/h-operations/notifications/read-all', headers: { cookie }, payload: {} });

    // H-JOB reconcile + idempotent enqueue
    const job = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/h-operations/jobs',
          headers: { cookie },
          payload: { jobType: 'OPERATIONAL_RECONCILE', idempotencyKey: 'reconcile-1' },
        })
      ).body,
    );
    const jobDup = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/h-operations/jobs',
          headers: { cookie },
          payload: { jobType: 'OPERATIONAL_RECONCILE', idempotencyKey: 'reconcile-1' },
        })
      ).body,
    );
    expect(jobDup.id).toBe(job.id);

    const ran = JSON.parse(
      (await app.inject({ method: 'POST', url: `/api/v1/internal/h-operations/jobs/${job.id}/run`, headers: { cookie }, payload: {} })).body,
    );
    expect(ran.status).toBe('SUCCEEDED');
    const ranAgain = JSON.parse(
      (await app.inject({ method: 'POST', url: `/api/v1/internal/h-operations/jobs/${job.id}/run`, headers: { cookie }, payload: {} })).body,
    );
    expect(ranAgain.idempotent).toBe(true);

    // H-HEALTH
    const health = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/internal/h-operations/health', headers: { cookie } })).body,
    );
    expect(health.api).toBe('ok');
    expect(health.database).toBe('ok');
    expect(health.jobs).toBeTruthy();

    // H-CONFIG
    const cfgResponse = await app.inject({ method: 'GET', url: '/api/v1/internal/h-operations/config', headers: { cookie } });
    expect(cfgResponse.statusCode).toBe(200);
    const cfg = JSON.parse(cfgResponse.body);
    expect(cfg.retry_limits?.value ?? cfg.retry_limits).toBeTruthy();
    const cfgSet = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/h-operations/config',
          headers: { cookie },
          payload: { key: 'retry_limits', value: { defaultMaxAttempts: 4, minBackoffSeconds: 15 } },
        })
      ).body,
    );
    expect(cfgSet.version).toBeGreaterThanOrEqual(2);

    const partnerCfg = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/h-operations/config',
      headers: { cookie: partnerCookie, 'x-sco-company-id': partnerCompany },
      payload: { key: 'retry_limits', value: { defaultMaxAttempts: 99 } },
    });
    expect(partnerCfg.statusCode).toBe(403);

    // H-AUDIT evidence
    const evidence = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/internal/h-operations/audit-evidence?limit=20', headers: { cookie } })).body,
    );
    expect(evidence.items.length).toBeGreaterThan(0);
    expect(evidence.items.some((e: { action: string }) => e.action.startsWith('h.'))).toBe(true);
  });
});
