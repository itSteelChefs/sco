import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
const runtime = () => new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
let internal: InternalDatabaseService;
let internalCompany: string;
let approver: string;
let nonApprover: string;
let selfApprover: string;
let nonSelfApprover: string;
let partner: string;
let supplier: string;

async function grant(userId: string, permissionCode: string) {
  const membershipId = id();
  const roleId = id();
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [membershipId, userId, internalCompany]);
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [roleId, internalCompany, `${permissionCode}-${roleId}`, permissionCode]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), internalCompany, membershipId, roleId]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), internalCompany, roleId, permissionCode]);
}

async function addUser(userId: string, type: 'PARTNER' | 'SUPPLIER') {
  const companyId = id();
  await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\')', [userId, `${userId}@security.test`]);
  await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,$2,$3)', [companyId, `${type} security`, type]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
}

describe('Purchase cost authorization security edges', () => {
  beforeAll(async () => {
    internalCompany = id();
    approver = id(); nonApprover = id(); selfApprover = id(); nonSelfApprover = id(); partner = id(); supplier = id();
    await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,\'SCO security\',\'SCO\')', [internalCompany]);
    for (const userId of [approver, nonApprover, selfApprover, nonSelfApprover]) await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\')', [userId, `${userId}@sco.test`]);
    await grant(approver, 'purchase_cost.approve');
    await grant(selfApprover, 'purchase_cost.self_approve');
    await addUser(partner, 'PARTNER');
    await addUser(supplier, 'SUPPLIER');
    internal = new InternalDatabaseService();
  });

  afterAll(async () => { await internal.onModuleDestroy(); await owner.end(); });

  it.each([
    ['direct execute', null],
    ['spoofed SCO internal setting', "SELECT set_config('app.sco_internal','true',true)"],
    ['spoofed actor setting', "SELECT set_config('app.actor_id',$1,true)"],
    ['both spoofed settings', "SELECT set_config('app.sco_internal','true',true),set_config('app.actor_id',$1,true)"],
  ])('can_approve_purchase_cost denies runtime %s', async (_name, setting) => {
    const client = runtime();
    await client.connect();
    await client.query('BEGIN');
    try {
      if (setting) await client.query(setting, setting.includes('$1') ? [approver] : []);
      await expect(client.query('SELECT public.can_approve_purchase_cost($1)', [approver])).rejects.toThrow(/permission denied/i);
    } finally { await client.query('ROLLBACK'); await client.end(); }
  });

  it.each([
    ['direct execute', null],
    ['spoofed SCO internal setting', "SELECT set_config('app.sco_internal','true',true)"],
    ['spoofed actor setting', "SELECT set_config('app.actor_id',$1,true)"],
    ['both spoofed settings', "SELECT set_config('app.sco_internal','true',true),set_config('app.actor_id',$1,true)"],
  ])('can_self_approve_purchase_cost denies runtime %s', async (_name, setting) => {
    const client = runtime();
    await client.connect();
    await client.query('BEGIN');
    try {
      if (setting) await client.query(setting, setting.includes('$1') ? [selfApprover] : []);
      await expect(client.query('SELECT public.can_self_approve_purchase_cost($1)', [selfApprover])).rejects.toThrow(/permission denied/i);
    } finally { await client.query('ROLLBACK'); await client.end(); }
  });

  it.each([
    ['SCO Internal with purchase_cost.approve', () => approver, true],
    ['SCO Internal without purchase_cost.approve', () => nonApprover, false],
    ['Partner', () => partner, false],
    ['Supplier', () => supplier, false],
  ])('trusted can_approve_purchase_cost returns %s', async (_name, actor, expected) => {
    await expect(internal.canApprovePurchaseCost(actor())).resolves.toBe(expected);
  });

  it.each([
    ['SCO Internal with purchase_cost.self_approve', () => selfApprover, true],
    ['SCO Internal without purchase_cost.self_approve', () => nonSelfApprover, false],
    ['Partner', () => partner, false],
    ['Supplier', () => supplier, false],
  ])('trusted can_self_approve_purchase_cost returns %s', async (_name, actor, expected) => {
    await expect(internal.canSelfApprovePurchaseCost(actor())).resolves.toBe(expected);
  });

  it('sco_internal_executor cannot enumerate RBAC or unrelated procurement needs', async () => {
    const client = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
    await client.connect();
    try {
      for (const table of ['"CompanyMembership"', '"MembershipRole"', '"RolePermission"', '"Permission"', 'procurement_needs']) {
        await expect(client.query(`SELECT * FROM ${table} LIMIT 1`)).rejects.toThrow(/permission denied/i);
      }
    } finally { await client.end(); }
  });
});
