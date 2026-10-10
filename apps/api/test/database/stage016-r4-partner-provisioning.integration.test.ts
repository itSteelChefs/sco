import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const id = () => randomUUID();
let owner: Client;
let internal: Client;
let runtime: Client;
let actor: string;
let unauthorizedActor: string;
let scoCompany: string;
let targetCompany: string;
let targetUser: string;
let roleIds: string[] = [];
const createdUsers: string[] = [];
const createdCompanies: string[] = [];

async function createCompany(type: 'SCO' | 'PARTNER') {
  const company = id();
  await owner.query('INSERT INTO "Company"(id,name,type,status) VALUES($1,$2,$3,\'ACTIVE\')', [company, `Stage016 ${type} ${company}`, type]);
  createdCompanies.push(company);
  return company;
}

async function createUser(company: string, label: string, member = true) {
  const user = id();
  await owner.query('INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,\'ACTIVE\')', [user, `${label}-${user}@stage016.test`, 'TEST_ONLY_NO_LOGIN']);
  if (member) await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), user, company]);
  createdUsers.push(user);
  return user;
}

async function grant(user: string, company: string, permission: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [user, company])).rows[0].id;
  const role = id();
  roleIds.push(role);
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, company, `${permission}-${role}`, permission]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), company, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), company, role, permission]);
}

async function callProvision(user: string, company: string, key: string, userTarget = targetUser, companyTarget = targetCompany, tenant = company) {
  await internal.query('BEGIN');
  await internal.query("SELECT set_config('app.actor_id',$1,true), set_config('app.tenant_id',$2,true)", [user, tenant]);
  try {
    const result = await internal.query('SELECT * FROM public.internal_partner_membership_provision($1,$2,$3)', [userTarget, companyTarget, key]);
    await internal.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await internal.query('ROLLBACK');
    throw error;
  }
}

async function callWithoutActor(tenant: string) {
  await internal.query('BEGIN');
  await internal.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
  try {
    await internal.query('SELECT * FROM public.internal_partner_membership_provision($1,$2,$3)', [targetUser, targetCompany, `db-no-actor-${id()}`]);
    await internal.query('COMMIT');
  } catch (error) { await internal.query('ROLLBACK'); throw error; }
}

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  internal = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
  runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
  await owner.connect();
  await internal.connect();
  await runtime.connect();
  scoCompany = await createCompany('SCO');
  targetCompany = await createCompany('PARTNER');
  actor = await createUser(scoCompany, 'actor');
  unauthorizedActor = await createUser(scoCompany, 'unauthorized');
  targetUser = await createUser(targetCompany, 'target', false);
  await grant(actor, scoCompany, 'partner.provision.manage');
});

afterAll(async () => {
  await internal?.end();
  await runtime?.end();
  if (owner) {
    await owner.query('DELETE FROM audit_logs WHERE action=\'partner.membership.provisioned\' AND actor_user_id = ANY($1::uuid[])', [createdUsers]);
    await owner.query('DELETE FROM partner_membership_provision_operations WHERE actor_user_id = ANY($1::uuid[])', [createdUsers]);
    if (roleIds.length) {
      await owner.query('DELETE FROM "RolePermission" WHERE role_id = ANY($1::uuid[])', [roleIds]);
      await owner.query('DELETE FROM "MembershipRole" WHERE role_id = ANY($1::uuid[])', [roleIds]);
      await owner.query('DELETE FROM "Role" WHERE id = ANY($1::uuid[])', [roleIds]);
    }
    await owner.query('DELETE FROM "CompanyMembership" WHERE "userId" = ANY($1::uuid[]) OR "companyId" = ANY($2::uuid[])', [createdUsers, createdCompanies]);
    await owner.query('DELETE FROM "User" WHERE id = ANY($1::uuid[])', [createdUsers]);
    await owner.query('DELETE FROM "Company" WHERE id = ANY($1::uuid[])', [createdCompanies]);
    await owner.end();
  }
});

describe('Stage016 R4 database gateway', () => {
  it('creates only CompanyMembership and leaves MembershipRole untouched', async () => {
    const serviceCount = Number((await owner.query('SELECT count(*)::int AS count FROM service_entitlements')).rows[0].count);
    const workspaceCount = Number((await owner.query('SELECT count(*)::int AS count FROM partner_workspaces')).rows[0].count);
    const before = Number((await owner.query('SELECT count(*)::int AS count FROM "MembershipRole" mr JOIN "CompanyMembership" cm ON cm.id=mr.membership_id WHERE cm."userId"=$1 AND cm."companyId"=$2', [targetUser, targetCompany])).rows[0].count);
    const result = await callProvision(actor, scoCompany, `db-success-${id()}`);
    const after = Number((await owner.query('SELECT count(*)::int AS count FROM "MembershipRole" mr JOIN "CompanyMembership" cm ON cm.id=mr.membership_id WHERE cm."userId"=$1 AND cm."companyId"=$2', [targetUser, targetCompany])).rows[0].count);
    expect(result).toMatchObject({ user_id: targetUser, company_id: targetCompany, membership_status: 'ACTIVE', outcome: 'CREATED' });
    expect(after).toBe(before);
    expect(Number((await owner.query('SELECT count(*)::int AS count FROM service_entitlements')).rows[0].count)).toBe(serviceCount);
    expect(Number((await owner.query('SELECT count(*)::int AS count FROM partner_workspaces')).rows[0].count)).toBe(workspaceCount);
  });

  it('writes the deterministic Stage016 audit event for a created membership', async () => {
    const operationKey = `db-audit-${id()}`;
    const auditTargetUser = await createUser(targetCompany, 'audit', false);
    const result = await callProvision(actor, scoCompany, operationKey, auditTargetUser);
    const audit = (await owner.query(`
      SELECT actor_user_id, scope, action, entity_type, entity_id, metadata
      FROM audit_logs
      WHERE actor_user_id = $1 AND action = 'partner.membership.provisioned'
        AND metadata->>'operationKey' = $2
    `, [actor, operationKey])).rows[0];

    expect(audit).toMatchObject({
      actor_user_id: actor,
      scope: 'SCO_INTERNAL',
      action: 'partner.membership.provisioned',
      entity_type: 'CompanyMembership',
      entity_id: result.membership_id,
      metadata: {
        authorityCompanyId: scoCompany,
        targetUserId: auditTargetUser,
        targetCompanyId: targetCompany,
        operationKey,
        outcome: 'CREATED',
      },
    });
  });

  it('returns ALREADY_EXISTS for an existing active membership', async () => {
    const existingUser = await createUser(targetCompany, 'existing');
    const result = await callProvision(actor, scoCompany, `db-existing-${id()}`, existingUser);
    expect(result.outcome).toBe('ALREADY_EXISTS');
    expect(result.membership_status).toBe('ACTIVE');
  });

  it('does not reactivate or report success for a suspended membership', async () => {
    const suspendedUser = await createUser(targetCompany, 'suspended');
    await owner.query('UPDATE "CompanyMembership" SET status=\'SUSPENDED\' WHERE "userId"=$1 AND "companyId"=$2', [suspendedUser, targetCompany]);
    await expect(callProvision(actor, scoCompany, `db-suspended-${id()}`, suspendedUser)).rejects.toThrow('PARTNER_PROVISION_MEMBERSHIP_INACTIVE');
    expect((await owner.query('SELECT status FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [suspendedUser, targetCompany])).rows[0].status).toBe('SUSPENDED');
    const revokedUser = await createUser(targetCompany, 'revoked');
    await owner.query('UPDATE "CompanyMembership" SET status=\'REVOKED\' WHERE "userId"=$1 AND "companyId"=$2', [revokedUser, targetCompany]);
    await expect(callProvision(actor, scoCompany, `db-revoked-${id()}`, revokedUser)).rejects.toThrow('PARTNER_PROVISION_MEMBERSHIP_INACTIVE');
  });

  it('returns REPLAYED for the same tuple and rejects a payload conflict', async () => {
    const key = `db-replay-${id()}`;
    const first = await callProvision(actor, scoCompany, key);
    const replay = await callProvision(actor, scoCompany, key);
    expect(replay).toMatchObject({ operation_id: first.operation_id, outcome: 'REPLAYED', membership_status: 'ACTIVE' });
    const otherUser = await createUser(targetCompany, 'conflict');
    await expect(callProvision(actor, scoCompany, key, otherUser)).rejects.toThrow('PARTNER_PROVISION_IDEMPOTENCY_CONFLICT');
    const otherCompany = await createCompany('PARTNER');
    await expect(callProvision(actor, scoCompany, key, targetUser, otherCompany)).rejects.toThrow('PARTNER_PROVISION_IDEMPOTENCY_CONFLICT');
  });

  it('fails closed for an unauthorized actor, invalid user, and invalid company', async () => {
    await expect(callProvision(unauthorizedActor, scoCompany, `db-unauthorized-${id()}`)).rejects.toThrow('PARTNER_PROVISION_AUTHORITY_FORBIDDEN');
    await expect(callProvision(actor, scoCompany, `db-invalid-user-${id()}`, id())).rejects.toThrow('PARTNER_PROVISION_TARGET_USER_INVALID');
    await expect(callProvision(actor, scoCompany, `db-invalid-company-${id()}`, targetUser, scoCompany)).rejects.toThrow('PARTNER_PROVISION_TARGET_COMPANY_INVALID');
    const disabledUser = await createUser(targetCompany, 'disabled', false);
    await owner.query('UPDATE "User" SET status=\'DISABLED\' WHERE id=$1', [disabledUser]);
    await expect(callProvision(actor, scoCompany, `db-disabled-user-${id()}`, disabledUser)).rejects.toThrow('PARTNER_PROVISION_TARGET_USER_INVALID');
    const suspendedCompany = await createCompany('PARTNER');
    await owner.query('UPDATE "Company" SET status=\'SUSPENDED\' WHERE id=$1', [suspendedCompany]);
    await expect(callProvision(actor, scoCompany, `db-suspended-company-${id()}`, targetUser, suspendedCompany)).rejects.toThrow('PARTNER_PROVISION_TARGET_COMPANY_INVALID');
    await expect(callWithoutActor(scoCompany)).rejects.toThrow('PARTNER_PROVISION_FORBIDDEN');
  });

  it('rejects a wrong tenant binding and serializes concurrent replay', async () => {
    await expect(callProvision(actor, scoCompany, `db-wrong-tenant-${id()}`, targetUser, targetCompany, id())).rejects.toThrow('PARTNER_PROVISION_FORBIDDEN');
    const concurrentUser = await createUser(targetCompany, 'concurrent', false);
    const key = `db-concurrent-${id()}`;
    const firstClient = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
    const secondClient = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
    await firstClient.connect(); await secondClient.connect();
    const run = async (client: Client) => {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.actor_id',$1,true), set_config('app.tenant_id',$2,true)", [actor, scoCompany]);
      try {
        const result = await client.query('SELECT * FROM public.internal_partner_membership_provision($1,$2,$3)', [concurrentUser, targetCompany, key]);
        await client.query('COMMIT');
        return result.rows[0];
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    };
    const results = await Promise.all([run(firstClient), run(secondClient)]);
    await firstClient.end(); await secondClient.end();
    expect(results.map((entry) => entry.outcome).sort()).toEqual(['CREATED', 'REPLAYED']);
    expect(Number((await owner.query('SELECT count(*)::int AS count FROM partner_membership_provision_operations WHERE actor_user_id=$1 AND operation_key=$2', [actor, key])).rows[0].count)).toBe(1);

    const differentKeyClientA = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
    const differentKeyClientB = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
    await differentKeyClientA.connect(); await differentKeyClientB.connect();
    const runExisting = async (client: Client, operationKey: string) => {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.actor_id',$1,true), set_config('app.tenant_id',$2,true)", [actor, scoCompany]);
      try {
        const result = await client.query('SELECT * FROM public.internal_partner_membership_provision($1,$2,$3)', [targetUser, targetCompany, operationKey]);
        await client.query('COMMIT');
        return result.rows[0];
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    };
    const differentKeyResults = await Promise.all([runExisting(differentKeyClientA, `db-different-key-a-${id()}`), runExisting(differentKeyClientB, `db-different-key-b-${id()}`)]);
    await differentKeyClientA.end(); await differentKeyClientB.end();
    expect(differentKeyResults.map((entry) => entry.outcome).sort()).toEqual(['ALREADY_EXISTS', 'ALREADY_EXISTS']);
  });

  it('proves the narrow RLS and privilege boundary', async () => {
    await expect(runtime.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), targetUser, targetCompany])).rejects.toThrow();
    const policies = (await owner.query(`SELECT policyname FROM pg_policies WHERE schemaname='public' AND roles @> ARRAY['sco_partner_provisioning_gateway_owner']::name[] AND tablename IN ('CompanyMembership','MembershipRole','RolePermission')`)).rows;
    expect(policies.map((row) => row.policyname).sort()).toEqual([
      'partner_provision_membership_owner_insert',
      'partner_provision_membership_owner_read',
      'partner_provision_membership_role_owner_read',
      'partner_provision_role_permission_owner_read',
    ].sort());
    const attrs = (await owner.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='sco_partner_provisioning_gateway_owner'`)).rows[0];
    expect(attrs).toEqual({ rolsuper: false, rolbypassrls: false });
    const forceRls = (await owner.query(`SELECT relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('CompanyMembership','MembershipRole','RolePermission')`)).rows;
    expect(forceRls.every((row) => row.relforcerowsecurity)).toBe(true);
    expect((await owner.query(`SELECT has_table_privilege('sco_partner_provisioning_gateway_owner','public."CompanyMembership"','UPDATE') AS can_update`)).rows[0].can_update).toBe(false);
  });

  it('revokes PUBLIC EXECUTE from every Stage016 SECURITY DEFINER function', async () => {
    const rows = (await owner.query(`
      SELECT n.nspname || '.' || p.oid::regprocedure::text AS signature,
             p.prosecdef AS security_definer,
             COALESCE((
               SELECT bool_or(grantee = 0 AND privilege_type = 'EXECUTE')
               FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))
             ), false) AS public_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.oid IN (
        'public.internal_partner_provision_authority(uuid)'::regprocedure,
        'public.internal_partner_membership_provision(uuid,uuid,text)'::regprocedure,
        'public.partner_membership_provision_audit()'::regprocedure
      )
      ORDER BY signature
    `)).rows;

    expect(rows.map((row) => row.signature)).toEqual([
      'public.internal_partner_membership_provision(uuid,uuid,text)',
      'public.internal_partner_provision_authority(uuid)',
      'public.partner_membership_provision_audit()',
    ]);
    expect(rows.every((row) => row.security_definer === true)).toBe(true);
    expect(rows.every((row) => row.public_execute === false)).toBe(true);
  });
});
