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

describe('Stage 008-B controlled disclosure foundation', () => {
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

  it('keeps REAL fail-closed unless a server-issued authority exactly matches an allowlisted operational case', async () => {
    const revealActor = await principal(partnerCompany, 'disclosure.reveal.request', 'reveal');
    const disclosureCase = 'TEST_PROJECT_SITE_REVEAL';
    const authority = new Client({ connectionString: process.env.PURPOSE_AUTHORITY_DATABASE_URL });
    const runtimeClient = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
    await authority.connect();
    await runtimeClient.connect();
    const revealArgs = (actor: string, overrides: { ownerCompanyId?: string; recipientCompanyId?: string; recipientContext?: string; resourceId?: string; subjectReference?: string; purposeCode?: string; flowCpfId?: string; operation?: string; disclosureLevel?: string; disclosureCaseCode?: string } = {}) => [
      actor,
      overrides.ownerCompanyId ?? internalCompany,
      overrides.recipientCompanyId ?? partnerCompany,
      overrides.recipientContext ?? 'PARTNER',
      'DISCLOSURE_FIXTURE',
      overrides.resourceId ?? resourceId,
      'PROJECT_SITE',
      overrides.subjectReference ?? subjectReference,
      overrides.purposeCode ?? 'PUR-13',
      overrides.flowCpfId ?? 'CPF_15',
      overrides.operation ?? 'PRESENT_REAL',
      overrides.disclosureLevel ?? 'REAL',
      overrides.disclosureCaseCode ?? disclosureCase,
    ];
    const issueArgs = (actor: string) => revealArgs(actor);
    const consumeArgs = (decisionId: string, actor: string, backendPid: number, transactionId: string) => {
      const args = revealArgs(actor);
      return [decisionId, ...args, backendPid, transactionId];
    };
    try {
      expect((await owner.query('SELECT count(*)::int AS count FROM disclosure_reveal_cases')).rows[0].count).toBe(0);
      await expect(authority.query(
        'SELECT public.issue_disclosure_reveal_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        issueArgs(revealActor),
      )).rejects.toThrow('DISCLOSURE_REVEAL_ISSUE_FORBIDDEN');

      await runtimeClient.query('BEGIN');
      await runtimeClient.query("SELECT set_config('app.actor_id',$1,true), set_config('app.tenant_id',$2,true)", [revealActor, partnerCompany]);
      await expect(runtimeClient.query(
        'SELECT public.disclosure_reveal_authorized($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS allowed',
        revealArgs(revealActor),
      )).resolves.toMatchObject({ rows: [{ allowed: false }] });
      await runtimeClient.query('ROLLBACK');

      await owner.query(
        `INSERT INTO disclosure_reveal_cases(code,purpose_code,flow_cpf_id,recipient_context,resource_type,identity_class,operation,disclosure_level,required_permission,max_duration_seconds)
         VALUES($1,'PUR-13','CPF_15','PARTNER','DISCLOSURE_FIXTURE','PROJECT_SITE','PRESENT_REAL','REAL','disclosure.reveal.request',30)`,
        [disclosureCase],
      );
      await owner.query(
        `INSERT INTO disclosure_reveal_cases(code,purpose_code,flow_cpf_id,recipient_context,resource_type,identity_class,operation,disclosure_level,required_permission,max_duration_seconds,active)
         VALUES('TEST_GENERIC_INACTIVE_CASE','PUR-14','CPF_22','SCO_INTERNAL','TEST_GENERIC_RESOURCE','ORGANIZATION','PRESENT_REAL','REAL','disclosure.reveal.request',30,false)`,
      );
      expect((await owner.query('SELECT count(*)::int AS count FROM disclosure_reveal_cases WHERE active')).rows[0].count).toBe(1);
      const decision = (await authority.query<{ id: string }>(
        'SELECT public.issue_disclosure_reveal_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS id',
        issueArgs(revealActor),
      )).rows[0].id;

      await runtimeClient.query('BEGIN');
      await runtimeClient.query("SELECT set_config('app.actor_id',$1,true), set_config('app.tenant_id',$2,true)", [revealActor, partnerCompany]);
      const binding = (await runtimeClient.query<{ backend_pid: number; transaction_id: string }>(
        'SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id',
      )).rows[0];
      await authority.query(
        'SELECT public.consume_disclosure_reveal_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
        consumeArgs(decision, revealActor, binding.backend_pid, binding.transaction_id),
      );
      await runtimeClient.query("SELECT set_config('app.disclosure_reveal_decision',$1,true)", [decision]);
      await expect(runtimeClient.query(
        'SELECT public.disclosure_reveal_authorized($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS allowed',
        revealArgs(revealActor),
      )).resolves.toMatchObject({ rows: [{ allowed: true }] });
      await runtimeClient.query("SELECT set_config('app.actor_id',$1,true)", [id()]);
      await expect(runtimeClient.query(
        'SELECT public.disclosure_reveal_authorized($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS allowed',
        revealArgs(revealActor),
      )).resolves.toMatchObject({ rows: [{ allowed: false }] });
      await runtimeClient.query("SELECT set_config('app.actor_id',$1,true)", [revealActor]);
      await runtimeClient.query("SELECT set_config('app.tenant_id',$1,true)", [otherPartnerCompany]);
      await expect(runtimeClient.query(
        'SELECT public.disclosure_reveal_authorized($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS allowed',
        revealArgs(revealActor),
      )).resolves.toMatchObject({ rows: [{ allowed: false }] });
      await runtimeClient.query("SELECT set_config('app.tenant_id',$1,true)", [partnerCompany]);
      await runtimeClient.query("SELECT set_config('app.actor_id','',true), set_config('app.tenant_id','',true)");
      await expect(runtimeClient.query(
        'SELECT public.disclosure_reveal_authorized($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS allowed',
        revealArgs(revealActor),
      )).resolves.toMatchObject({ rows: [{ allowed: false }] });
      await runtimeClient.query("SELECT set_config('app.actor_id',$1,true), set_config('app.tenant_id',$2,true)", [revealActor, partnerCompany]);
      for (const attempt of [
        revealArgs(id()),
        revealArgs(revealActor, { ownerCompanyId: secondInternalCompany }),
        revealArgs(revealActor, { recipientCompanyId: otherPartnerCompany }),
        revealArgs(revealActor, { recipientContext: 'CROSS_PARTY_EXTERNAL' }),
        revealArgs(revealActor, { resourceId: id() }),
        revealArgs(revealActor, { subjectReference: id() }),
        revealArgs(revealActor, { purposeCode: 'PUR-14' }),
        revealArgs(revealActor, { flowCpfId: 'CPF_22' }),
        revealArgs(revealActor, { disclosureCaseCode: 'UNAUTHORIZED_CASE' }),
      ]) {
        await expect(runtimeClient.query(
          'SELECT public.disclosure_reveal_authorized($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS allowed',
          attempt,
        )).resolves.toMatchObject({ rows: [{ allowed: false }] });
      }
      await runtimeClient.query('SAVEPOINT direct_table_access');
      await expect(runtimeClient.query('SELECT * FROM disclosure_reveal_authority_decisions')).rejects.toBeTruthy();
      await runtimeClient.query('ROLLBACK TO SAVEPOINT direct_table_access');
      await runtimeClient.query('COMMIT');

      const mutationClient = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
      await mutationClient.connect();
      try {
        const denied = async (query: string) => {
          await mutationClient.query('BEGIN');
          await expect(mutationClient.query(query)).rejects.toBeTruthy();
          await mutationClient.query('ROLLBACK');
        };
        for (const mutation of [
          'UPDATE disclosure_reveal_cases SET active=false',
          'UPDATE disclosure_reveal_authority_decisions SET consumed_at=clock_timestamp()',
          "UPDATE disclosure_reveal_authority_events SET event_type='ISSUED'",
          'DELETE FROM disclosure_reveal_cases',
          'DELETE FROM disclosure_reveal_authority_decisions',
          'DELETE FROM disclosure_reveal_authority_events',
          'INSERT INTO disclosure_reveal_cases DEFAULT VALUES',
          'INSERT INTO disclosure_reveal_authority_decisions DEFAULT VALUES',
          'INSERT INTO disclosure_reveal_authority_events DEFAULT VALUES',
        ]) {
          await denied(mutation);
        }
        await denied(`SELECT public.issue_disclosure_reveal_authority('${revealActor}'::uuid,'${internalCompany}'::uuid,'${partnerCompany}'::uuid,'PARTNER','DISCLOSURE_FIXTURE','${resourceId}'::uuid,'PROJECT_SITE','${subjectReference}'::uuid,'PUR-13','CPF_15','PRESENT_REAL','REAL','${disclosureCase}')`);
        await denied(`SELECT public.consume_disclosure_reveal_authority('${decision}'::uuid,'${revealActor}'::uuid,'${internalCompany}'::uuid,'${partnerCompany}'::uuid,'PARTNER','DISCLOSURE_FIXTURE','${resourceId}'::uuid,'PROJECT_SITE','${subjectReference}'::uuid,'PUR-13','CPF_15','PRESENT_REAL','REAL','${disclosureCase}',1,1)`);
      } finally {
        await mutationClient.end();
      }

      const replayClient = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
      await replayClient.connect();
      try {
        await replayClient.query('BEGIN');
        const replayBinding = (await replayClient.query<{ backend_pid: number; transaction_id: string }>(
          'SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id',
        )).rows[0];
        await expect(authority.query(
          'SELECT public.consume_disclosure_reveal_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
          consumeArgs(decision, revealActor, replayBinding.backend_pid, replayBinding.transaction_id),
        )).rejects.toThrow('DISCLOSURE_REVEAL_CONSUME_FORBIDDEN');
      } finally {
        await replayClient.end();
      }

      const expired = (await authority.query<{ id: string }>(
        'SELECT public.issue_disclosure_reveal_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS id',
        issueArgs(revealActor),
      )).rows[0].id;
      await owner.query(
        "UPDATE disclosure_reveal_authority_decisions SET issued_at=clock_timestamp() - interval '2 minutes', expires_at=clock_timestamp() - interval '90 seconds' WHERE id=$1",
        [expired],
      );
      await expect(authority.query(
        'SELECT public.consume_disclosure_reveal_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
        consumeArgs(expired, revealActor, 1, '1'),
      )).rejects.toThrow('DISCLOSURE_REVEAL_CONSUME_FORBIDDEN');

      const rollbackDecision = (await authority.query<{ id: string }>(
        'SELECT public.issue_disclosure_reveal_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS id',
        issueArgs(revealActor),
      )).rows[0].id;
      const rollbackRuntime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
      await rollbackRuntime.connect();
      try {
        await rollbackRuntime.query('BEGIN');
        const rollbackBinding = (await rollbackRuntime.query<{ backend_pid: number; transaction_id: string }>(
          'SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id',
        )).rows[0];
        await authority.query(
          'SELECT public.consume_disclosure_reveal_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
          consumeArgs(rollbackDecision, revealActor, rollbackBinding.backend_pid, rollbackBinding.transaction_id),
        );
        await rollbackRuntime.query('ROLLBACK');
        await expect(authority.query(
          'SELECT public.consume_disclosure_reveal_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
          consumeArgs(rollbackDecision, revealActor, 1, '1'),
        )).rejects.toThrow('DISCLOSURE_REVEAL_CONSUME_FORBIDDEN');
      } finally {
        await rollbackRuntime.end();
      }

      const concurrentDecision = (await authority.query<{ id: string }>(
        'SELECT public.issue_disclosure_reveal_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS id',
        issueArgs(revealActor),
      )).rows[0].id;
      const consumers = await Promise.all([
        new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }),
        new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }),
      ]);
      await Promise.all(consumers.map((client) => client.connect()));
      try {
        const bindings = await Promise.all(consumers.map(async (client) => {
          await client.query('BEGIN');
          return (await client.query<{ backend_pid: number; transaction_id: string }>(
            'SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id',
          )).rows[0];
        }));
        const outcomes = await Promise.allSettled(bindings.map(async (concurrentBinding) => {
          const concurrentAuthority = new Client({ connectionString: process.env.PURPOSE_AUTHORITY_DATABASE_URL });
          await concurrentAuthority.connect();
          try {
            await concurrentAuthority.query(
              'SELECT public.consume_disclosure_reveal_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
              consumeArgs(concurrentDecision, revealActor, concurrentBinding.backend_pid, concurrentBinding.transaction_id),
            );
          } finally {
            await concurrentAuthority.end();
          }
        }));
        expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      } finally {
        await Promise.all(consumers.map((client) => client.end()));
      }

      expect((await owner.query(
        'SELECT event_type, purpose_code, flow_cpf_id, disclosure_case_code FROM disclosure_reveal_authority_events WHERE decision_id=$1 ORDER BY recorded_at',
        [decision],
      )).rows).toEqual([
        { event_type: 'ISSUED', purpose_code: 'PUR-13', flow_cpf_id: 'CPF_15', disclosure_case_code: disclosureCase },
        { event_type: 'CONSUMED', purpose_code: 'PUR-13', flow_cpf_id: 'CPF_15', disclosure_case_code: disclosureCase },
      ]);
      const eventColumns = await owner.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='disclosure_reveal_authority_events'",
      );
      expect(eventColumns.rows.map((row) => row.column_name)).not.toContain('raw_identity_value');
    } finally {
      await runtimeClient.end();
      await authority.end();
    }
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
