import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';
import { RuntimeDatabaseService } from '../../src/database/runtime-database.service.js';
import { DisclosureAliasService } from '../../src/modules/disclosure/disclosure-alias.service.js';
import { DisclosureDatabaseService } from '../../src/modules/disclosure/disclosure-database.service.js';
import { PurposeDecisionAuthorityService } from '../../src/modules/rbac/purpose-decision-authority.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService;
let runtime: RuntimeDatabaseService;
let aliases: DisclosureAliasService;
let purposes: PurposeDecisionAuthorityService;
let internalCompany: string;
let secondInternalCompany: string;
let partnerCompany: string;
let otherPartnerCompany: string;
let internalActor: string;
let secondInternalActor: string;
let partnerActor: string;
let otherPartnerActor: string;
let resourceId: string;
let subjectReference: string;
let aliasId: string;
let alias: string;

async function principal(companyId: string, permission: string | null, prefix: string) {
  const user = id(); const membership = id(); const role = id();
  await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,$3)', [user, `${prefix}-${user}@disclosure.test`, 'x']);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,$4)', [membership, user, companyId, 'ACTIVE']);
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, companyId, `${prefix}-${role}`, prefix]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), companyId, membership, role]);
  if (permission) await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), companyId, role, permission]);
  return user;
}

describe('Stage 008-A controlled disclosure alias foundation', () => {
  beforeAll(async () => {
    internalCompany = id(); secondInternalCompany = id(); partnerCompany = id(); otherPartnerCompany = id();
    await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,$2,$3),($4,$5,$6),($7,$8,$9),($10,$11,$12)', [
      internalCompany, 'Disclosure SCO A', 'SCO', secondInternalCompany, 'Disclosure SCO B', 'SCO', partnerCompany, 'Disclosure Partner', 'PARTNER', otherPartnerCompany, 'Disclosure Other Partner', 'PARTNER',
    ]);
    internalActor = await principal(internalCompany, 'disclosure.alias.manage', 'internal');
    secondInternalActor = await principal(secondInternalCompany, 'disclosure.alias.manage', 'internal-b');
    partnerActor = await principal(partnerCompany, 'disclosure.projection.read', 'partner');
    otherPartnerActor = await principal(otherPartnerCompany, 'disclosure.projection.read', 'other');
    resourceId = id(); subjectReference = id();
    internal = new InternalDatabaseService();
    runtime = new RuntimeDatabaseService();
    purposes = new PurposeDecisionAuthorityService();
    aliases = new DisclosureAliasService(new DisclosureDatabaseService(runtime, internal, purposes));
  });

  afterAll(async () => {
    await internal.onModuleDestroy();
    await runtime.onModuleDestroy();
    await purposes.onModuleDestroy();
    await owner.end();
  });

  it('creates a cryptographically opaque, context-bound alias and presents it only through the scoped runtime gateway', async () => {
    alias = await aliases.createTrustedAlias(internalActor, {
      ownerCompanyId: internalCompany,
      recipientCompanyId: partnerCompany,
      recipientContext: 'PARTNER',
      resourceType: 'DISCLOSURE_FIXTURE',
      resourceId,
      identityClass: 'PROJECT_SITE',
      subjectReference,
    });
    expect(alias).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(alias).not.toContain(subjectReference.replaceAll('-', ''));
    aliasId = (await owner.query<{ id: string }>('SELECT id FROM disclosure_aliases WHERE alias=$1', [alias])).rows[0].id;

    const presented = await new DisclosureDatabaseService(runtime, internal, purposes).withAuthorizedAlias(partnerActor, partnerCompany, {
      resourceType: 'DISCLOSURE_FIXTURE', resourceId, identityClass: 'PROJECT_SITE', subjectReference,
    }, async (_client, value) => value);
    expect(presented).toBe(alias);
  });

  it('rejects wrong company, context, resource, and alias-only authority attempts', async () => {
    const database = new DisclosureDatabaseService(runtime, internal, purposes);
    await expect(database.withAuthorizedAlias(otherPartnerActor, otherPartnerCompany, {
      resourceType: 'DISCLOSURE_FIXTURE', resourceId, identityClass: 'PROJECT_SITE', subjectReference,
    }, async (_client, value) => value)).resolves.toBeNull();
    await expect(database.withAuthorizedAlias(partnerActor, partnerCompany, {
      resourceType: 'DISCLOSURE_FIXTURE', resourceId: id(), identityClass: 'PROJECT_SITE', subjectReference,
    }, async (_client, value) => value)).resolves.toBeNull();
  });

  it('retries a collision, rejects direct runtime mutation, and never reuses a retired alias', async () => {
    const resource = id();
    const first = alias;
    const replacement = 'A'.repeat(32);
    await expect(aliases.createTrustedAlias(internalActor, {
      ownerCompanyId: internalCompany, recipientCompanyId: partnerCompany, recipientContext: 'PARTNER',
      resourceType: 'DISCLOSURE_FIXTURE', resourceId: resource, identityClass: 'PROJECT_SITE', subjectReference: id(),
    }, (() => { const values = [first, replacement]; return () => values.shift()!; })())).resolves.toBe(replacement);

    const direct = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
    await direct.connect();
    try {
      await expect(direct.query('INSERT INTO disclosure_aliases(alias,owner_company_id,recipient_company_id,recipient_context,resource_type,resource_id,identity_class,subject_reference,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [replacement, internalCompany, partnerCompany, 'PARTNER', 'DISCLOSURE_FIXTURE', id(), 'PROJECT_SITE', id(), internalActor])).rejects.toBeTruthy();
    } finally { await direct.end(); }

    await aliases.retireTrustedAlias(internalActor, aliasId);
    await expect(new DisclosureDatabaseService(runtime, internal, purposes).withAuthorizedAlias(partnerActor, partnerCompany, {
      resourceType: 'DISCLOSURE_FIXTURE', resourceId, identityClass: 'PROJECT_SITE', subjectReference,
    }, async (_client, value) => value)).resolves.toBeNull();
    await expect(aliases.createTrustedAlias(internalActor, {
      ownerCompanyId: internalCompany, recipientCompanyId: partnerCompany, recipientContext: 'PARTNER',
      resourceType: 'DISCLOSURE_FIXTURE', resourceId: id(), identityClass: 'PROJECT_SITE', subjectReference: id(),
    }, () => alias)).rejects.toMatchObject({ code: '23505' });
  });

  it('binds create and retire authority to the persisted owner company despite ambient tenant manipulation', async () => {
    const fixture = {
      ownerCompanyId: secondInternalCompany, recipientCompanyId: partnerCompany, recipientContext: 'PARTNER' as const,
      resourceType: 'DISCLOSURE_FIXTURE' as const, resourceId: id(), identityClass: 'PROJECT_SITE' as const, subjectReference: id(),
    };
    const noCapabilityActor = await principal(secondInternalCompany, null, 'internal-b-no-capability');
    const suspendedActor = await principal(secondInternalCompany, 'disclosure.alias.manage', 'internal-b-suspended');
    await owner.query('UPDATE "CompanyMembership" SET status=$1 WHERE "userId"=$2 AND "companyId"=$3', ['SUSPENDED', suspendedActor, secondInternalCompany]);
    await expect(aliases.createTrustedAlias(noCapabilityActor, fixture)).rejects.toThrow('DISCLOSURE_ALIAS_CREATE_FORBIDDEN');
    await expect(aliases.createTrustedAlias(suspendedActor, fixture)).rejects.toThrow('DISCLOSURE_ALIAS_CREATE_FORBIDDEN');
    await expect(aliases.createTrustedAlias(internalActor, fixture)).rejects.toThrow('DISCLOSURE_ALIAS_CREATE_FORBIDDEN');
    const companyBAlias = await aliases.createTrustedAlias(secondInternalActor, fixture);
    const companyBAliasId = (await owner.query<{ id: string }>('SELECT id FROM disclosure_aliases WHERE alias=$1', [companyBAlias])).rows[0].id;
    await expect(aliases.retireTrustedAlias(internalActor, companyBAliasId)).rejects.toThrow('DISCLOSURE_ALIAS_RETIRE_FORBIDDEN');

    const direct = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
    await direct.connect();
    try {
      await direct.query('BEGIN');
      await direct.query("SELECT set_config('app.tenant_id',$1,true)", [secondInternalCompany]);
      await expect(direct.query('SELECT public.internal_disclosure_alias_retire($1,$2)', [internalActor, companyBAliasId])).rejects.toThrow('DISCLOSURE_ALIAS_RETIRE_FORBIDDEN');
      await direct.query('ROLLBACK');
    } finally { await direct.end(); }

    await expect(aliases.retireTrustedAlias(secondInternalActor, companyBAliasId)).resolves.toBeUndefined();
  });

  it('keeps gateway access least-privileged with forced RLS and a safe search path', async () => {
    const security = await owner.query(`
      SELECT c.relrowsecurity, c.relforcerowsecurity,
        has_table_privilege('sco_runtime', 'public.disclosure_aliases', 'INSERT') AS runtime_insert,
        has_function_privilege('public', 'public.disclosure_alias_present(uuid,uuid,text,uuid,"DisclosureIdentityClass",uuid)', 'EXECUTE') AS public_execute,
        has_function_privilege('sco_runtime', 'public.disclosure_alias_present(uuid,uuid,text,uuid,"DisclosureIdentityClass",uuid)', 'EXECUTE') AS runtime_execute,
        p.proconfig
      FROM pg_class c
      JOIN pg_proc p ON p.proname = 'disclosure_alias_present'
      WHERE c.oid = 'public.disclosure_aliases'::regclass
    `);
    expect(security.rows[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, runtime_insert: false, public_execute: false, runtime_execute: true });
    expect(security.rows[0].proconfig).toContain('search_path=pg_catalog, public');
  });
});
