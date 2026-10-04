import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const authority = new Pool({ connectionString: process.env.PURPOSE_AUTHORITY_DATABASE_URL });
const id = () => randomUUID();
const service = 'PARTNER_CONTEXT_SUPPORT';
const resource = 'partner-workspace:foundation';

let sco: string;
let secondSco: string;
let partnerA: string;
let partnerB: string;
let manager: string;
let foreignManager: string;
let actor: string;
let otherActor: string;
let grantId: string;

async function addMembership(userId: string, companyId: string, permission: 'service_access.manage' | 'service_access.use') {
  const membership = id();
  const role = id();
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membership, userId, companyId]);
  await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)`, [role, companyId, `service-access-${role}`, permission]);
  await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(), companyId, membership, role]);
  await owner.query(
    `INSERT INTO "RolePermission"(id,company_id,role_id,permission_id)
     SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`,
    [id(), companyId, role, permission],
  );
  return membership;
}

async function issue(actorUserId = actor, targetCompanyId = partnerA, serviceCode = service, resourceContext = resource) {
  return (await authority.query<{ id: string }>(
    'SELECT public.issue_service_access_decision($1,$2,$3,$4) AS id',
    [actorUserId, targetCompanyId, serviceCode, resourceContext],
  )).rows[0]?.id;
}

async function consumeAndAuthorize(
  actorUserId = actor,
  targetCompanyId = partnerA,
  serviceCode = service,
  resourceContext = resource,
  beforeAuthorize?: (client: PoolClient, decisionId: string) => Promise<void>,
) {
  const client = await internal.connect();
  try {
    await client.query('BEGIN');
    const binding = (await client.query<{ backend_pid: number; transaction_id: string }>(
      'SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id',
    )).rows[0];
    const decisionId = await issue(actorUserId, targetCompanyId, serviceCode, resourceContext);
    if (!decisionId) throw new Error('expected service access decision');
    await authority.query(
      'SELECT public.consume_service_access_decision($1,$2,$3,$4,$5,$6,$7::bigint)',
      [decisionId, actorUserId, targetCompanyId, serviceCode, resourceContext, binding.backend_pid, binding.transaction_id],
    );
    await beforeAuthorize?.(client, decisionId);
    const result = await client.query<{ id: string }>(
      'SELECT public.internal_service_access_authorize($1,$2,$3,$4,$5,$6) AS id',
      [actorUserId, targetCompanyId, serviceCode, resourceContext, decisionId, id()],
    );
    await client.query('COMMIT');
    return { decisionId, authorizationId: result.rows[0]?.id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe('Stage 011 identity, entitlement, and service access foundation', () => {
  beforeAll(async () => {
    sco = id();
    secondSco = id();
    partnerA = id();
    partnerB = id();
    manager = id();
    foreignManager = id();
    actor = id();
    otherActor = id();
    await owner.query(
      `INSERT INTO "Company"(id,name,type) VALUES
       ($1,'Service access SCO','SCO'),($2,'Service access second SCO','SCO'),
       ($3,'Service access Partner A','PARTNER'),($4,'Service access Partner B','PARTNER')`,
      [sco, secondSco, partnerA, partnerB],
    );
    await owner.query(
      `INSERT INTO "User"(id,email,"passwordHash") VALUES
       ($1,$2,'x'),($3,$4,'x'),($5,$6,'x'),($7,$8,'x')`,
      [
        manager, `${manager}@service-access.test`,
        foreignManager, `${foreignManager}@service-access.test`,
        actor, `${actor}@service-access.test`,
        otherActor, `${otherActor}@service-access.test`,
      ],
    );
    await addMembership(manager, sco, 'service_access.manage');
    await addMembership(foreignManager, secondSco, 'service_access.manage');
    await addMembership(actor, sco, 'service_access.use');
    await internal.query(
      'SELECT public.internal_service_entitlement_set($1,$2,$3,$4::"ServiceEntitlementState")',
      [manager, partnerA, service, 'ACTIVE'],
    );
    grantId = (await internal.query<{ id: string }>(
      'SELECT public.internal_service_access_grant_create($1,$2,$3,$4,$5::timestamptz,$6,$7) AS id',
      [manager, actor, partnerA, service, new Date(Date.now() + 60 * 60_000).toISOString(), 'initial-grant', id()],
    )).rows[0]?.id ?? '';
  });

  afterAll(async () => {
    await Promise.all([owner.end(), internal.end(), runtime.end(), authority.end()]);
  });

  it('requires an active entitlement and an explicit, purpose-bound Service Access grant', async () => {
    expect(grantId).toMatch(/^[0-9a-f-]{36}$/i);
    const result = await consumeAndAuthorize();
    expect(result.authorizationId).toEqual(result.decisionId);
    const audit = await owner.query(
      `SELECT action,purpose_code,authorization_decision,metadata
       FROM audit_logs WHERE entity_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [result.decisionId],
    );
    expect(audit.rows[0]).toMatchObject({
      action: 'service_access.authorized',
      purpose_code: 'PUR-02',
      authorization_decision: 'ALLOWED',
    });
    expect(JSON.stringify(audit.rows[0]?.metadata)).not.toMatch(/storage.?key|password|token|secret/i);
  });

  it('denies absent grants, wrong actors, targets, services, and resource contexts', async () => {
    await expect(issue(otherActor)).rejects.toThrow(/SERVICE_ACCESS_(DECISION_ISSUE_FORBIDDEN|TRUSTED_CONTEXT_REQUIRED)/);
    await expect(issue(actor, partnerB)).rejects.toThrow('SERVICE_ACCESS_DECISION_ISSUE_FORBIDDEN');
    await expect(issue(actor, partnerA, 'OTHER_SERVICE')).rejects.toThrow('SERVICE_ACCESS_DECISION_ISSUE_FORBIDDEN');
    const client = await internal.connect();
    try {
      await client.query('BEGIN');
      const binding = (await client.query<{ backend_pid: number; transaction_id: string }>(
        'SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id',
      )).rows[0];
      const decisionId = await issue();
      await expect(authority.query(
        'SELECT public.consume_service_access_decision($1,$2,$3,$4,$5,$6,$7::bigint)',
        [decisionId, actor, partnerA, service, 'other-resource', binding.backend_pid, binding.transaction_id],
      )).rejects.toThrow('SERVICE_ACCESS_DECISION_CONSUME_FORBIDDEN');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('keeps entitlement, permission, grant, and decision requirements composed', async () => {
    await internal.query(
      'SELECT public.internal_service_entitlement_set($1,$2,$3,$4::"ServiceEntitlementState")',
      [manager, partnerA, service, 'DISABLED'],
    );
    await expect(issue()).rejects.toThrow('SERVICE_ACCESS_DECISION_ISSUE_FORBIDDEN');
    await internal.query(
      'SELECT public.internal_service_entitlement_set($1,$2,$3,$4::"ServiceEntitlementState")',
      [manager, partnerA, service, 'ACTIVE'],
    );
    await expect(consumeAndAuthorize()).resolves.toMatchObject({ authorizationId: expect.any(String) });
  });

  it('denies replay and direct runtime table or gateway access', async () => {
    const client = await internal.connect();
    try {
      await client.query('BEGIN');
      const binding = (await client.query<{ backend_pid: number; transaction_id: string }>(
        'SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id',
      )).rows[0];
      const decisionId = await issue();
      await authority.query(
        'SELECT public.consume_service_access_decision($1,$2,$3,$4,$5,$6,$7::bigint)',
        [decisionId, actor, partnerA, service, resource, binding.backend_pid, binding.transaction_id],
      );
      await client.query(
        'SELECT public.internal_service_access_authorize($1,$2,$3,$4,$5,$6)',
        [actor, partnerA, service, resource, decisionId, id()],
      );
      await expect(client.query(
        'SELECT public.internal_service_access_authorize($1,$2,$3,$4,$5,$6)',
        [actor, partnerA, service, resource, decisionId, id()],
      )).rejects.toThrow('SERVICE_ACCESS_AUTHORIZE_FORBIDDEN');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await expect(runtime.query('SELECT * FROM service_access_grants')).rejects.toThrow(/permission denied/i);
    await expect(runtime.query(
      'SELECT public.internal_service_access_authorize($1,$2,$3,$4,$5,$6)',
      [actor, partnerA, service, resource, id(), id()],
    )).rejects.toThrow(/permission denied/i);
  });

  it('keeps the Service Access gateway owner least-privileged with FORCE RLS and no PUBLIC execution', async () => {
    const role = await owner.query(
      `SELECT rolcanlogin,rolinherit,rolbypassrls,rolsuper,rolcreatedb,rolcreaterole
       FROM pg_roles WHERE rolname='sco_service_access_gateway_owner'`,
    );
    expect(role.rows).toEqual([{
      rolcanlogin: false,
      rolinherit: false,
      rolbypassrls: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
    }]);
    const tables = await owner.query(
      `SELECT relname,relrowsecurity,relforcerowsecurity
       FROM pg_class
       WHERE relname IN ('service_entitlements','service_access_grants','service_access_decisions')
       ORDER BY relname`,
    );
    expect(tables.rows).toHaveLength(3);
    expect(tables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const privileges = await owner.query(
      `SELECT
        has_table_privilege('sco_runtime', 'public.service_access_grants', 'SELECT') AS runtime_table_read,
        has_function_privilege('public', 'public.internal_service_access_authorize(uuid,uuid,text,text,uuid,uuid)', 'EXECUTE') AS public_gateway_execute,
        has_function_privilege('sco_runtime', 'public.internal_service_access_authorize(uuid,uuid,text,text,uuid,uuid)', 'EXECUTE') AS runtime_gateway_execute,
        has_function_privilege('sco_internal_executor', 'public.internal_service_access_authorize(uuid,uuid,text,text,uuid,uuid)', 'EXECUTE') AS internal_gateway_execute`,
    );
    expect(privileges.rows).toEqual([{
      runtime_table_read: false,
      public_gateway_execute: false,
      runtime_gateway_execute: false,
      internal_gateway_execute: true,
    }]);
  });

  it('denies cross-SCO revocation without mutation while preserving the issuing SCO manager authority', async () => {
    const crossActor = id();
    await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [crossActor, `${crossActor}@service-access.test`]);
    await addMembership(crossActor, sco, 'service_access.use');
    const crossGrantId = (await internal.query<{ id: string }>(
      'SELECT public.internal_service_access_grant_create($1,$2,$3,$4,$5::timestamptz,$6,$7) AS id',
      [manager, crossActor, partnerA, service, new Date(Date.now() + 60 * 60_000).toISOString(), 'cross-sco-grant', id()],
    )).rows[0]?.id;
    expect(crossGrantId).toMatch(/^[0-9a-f-]{36}$/i);

    await expect(internal.query(
      'SELECT public.internal_service_access_grant_revoke($1,$2,$3,$4)',
      [foreignManager, crossGrantId, 'foreign attempt', id()],
    )).rejects.toThrow('SERVICE_ACCESS_REVOKE_FORBIDDEN');
    const afterForeignAttempt = await owner.query<{ revoked_at: Date | null; granting_sco_company_id: string }>(
      'SELECT revoked_at,granting_sco_company_id FROM service_access_grants WHERE id=$1',
      [crossGrantId],
    );
    expect(afterForeignAttempt.rows).toEqual([{
      revoked_at: null,
      granting_sco_company_id: sco,
    }]);

    await expect(internal.query(
      'SELECT public.internal_service_access_grant_revoke($1,$2,$3,$4)',
      [manager, crossGrantId, 'issuer revocation', id()],
    )).resolves.toBeTruthy();
    const afterIssuerRevoke = await owner.query<{ revoked_at: Date | null; revoked_by: string | null }>(
      'SELECT revoked_at,revoked_by FROM service_access_grants WHERE id=$1',
      [crossGrantId],
    );
    expect(afterIssuerRevoke.rows[0]?.revoked_at).toBeInstanceOf(Date);
    expect(afterIssuerRevoke.rows[0]?.revoked_by).toBe(manager);
  });

  it('is idempotent for concurrent identical grants and rejects conflicting duplicates', async () => {
    const actorTwo = id();
    await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [actorTwo, `${actorTwo}@service-access.test`]);
    await addMembership(actorTwo, sco, 'service_access.use');
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const create = () => internal.query<{ id: string }>(
      'SELECT public.internal_service_access_grant_create($1,$2,$3,$4,$5::timestamptz,$6,$7) AS id',
      [manager, actorTwo, partnerA, service, expiresAt, 'concurrent-grant', id()],
    );
    const [left, right] = await Promise.all([create(), create()]);
    expect(left.rows[0]?.id).toBe(right.rows[0]?.id);
    await expect(internal.query(
      'SELECT public.internal_service_access_grant_create($1,$2,$3,$4,$5::timestamptz,$6,$7)',
      [manager, actorTwo, partnerB, service, expiresAt, 'concurrent-grant', id()],
    )).rejects.toThrow('SERVICE_ACCESS_GRANT_IDEMPOTENCY_CONFLICT');
  });

  it('fails closed on ambiguous trusted SCO contexts and never fabricates Partner membership', async () => {
    const membership = await addMembership(actor, secondSco, 'service_access.use');
    await expect(issue()).rejects.toThrow('SERVICE_ACCESS_TRUSTED_CONTEXT_REQUIRED');
    await owner.query(`UPDATE "CompanyMembership" SET status='REVOKED' WHERE id=$1`, [membership]);
    await expect(issue()).resolves.toMatch(/^[0-9a-f-]{36}$/i);
    const fabricated = await owner.query(
      `SELECT 1 FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2`,
      [actor, partnerA],
    );
    expect(fabricated.rows).toEqual([]);
  });

  it('fails closed when a grant is revoked after a decision is consumed', async () => {
    await expect(consumeAndAuthorize(actor, partnerA, service, resource, async () => {
      await internal.query(
        'SELECT public.internal_service_access_grant_revoke($1,$2,$3,$4)',
        [manager, grantId, 'support ended', id()],
      );
    })).rejects.toThrow('SERVICE_ACCESS_AUTHORIZE_FORBIDDEN');
  });
});
