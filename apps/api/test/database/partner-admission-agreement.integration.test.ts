import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
const id = () => randomUUID();

async function withRuntime<T>(actor: string, company: string, callback: (client: PoolClient) => Promise<T>) {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.actor_id', $1, true)", [actor]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [company]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe('Partner Admission and Agreement Evidence', () => {
  const scoCompany = id();
  const scoUser = id();
  const scoRole = id();
  const partnerCompany = id();
  const otherCompany = id();
  const partnerUser = id();
  const partnerRole = id();
  const initialContent = 'Binding confidentiality terms version one.';
  let policyV1: string;
  let policyV2: string;
  let partnershipId: string;
  let originalAcceptedAt: Date;

  async function grant(roleId: string, companyId: string, code: string) {
    await owner.query(
      'INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4 ON CONFLICT DO NOTHING',
      [id(), companyId, roleId, code],
    );
  }

  async function createPolicy(version: string, content: string, effectiveAt: Date) {
    const created = (await internal.query(
      `SELECT * FROM public.internal_partner_agreement_policy_create(
        $1,'BINDING_CONFIDENTIALITY',$2,$3,$4,'partner.agreement.accept',
        true,'REQUIRE_REACCEPTANCE','BLOCK_OPERATIONAL_ACCESS','TEST_RETENTION_CLASSIFICATION',true,$5
      )`,
      [scoUser, version, content, effectiveAt.toISOString(), id()],
    )).rows[0];
    await internal.query('SELECT * FROM public.internal_partner_agreement_policy_publish($1,$2,$3)', [scoUser, created.id, id()]);
    return created;
  }

  beforeAll(async () => {
    await owner.query('INSERT INTO "Company"(id,name,type,status) VALUES ($1,$2,\'SCO\',\'ACTIVE\'),($3,$4,\'PARTNER\',\'ACTIVE\'),($5,$6,\'PARTNER\',\'ACTIVE\')',
      [scoCompany, 'Admission Test SCO', partnerCompany, 'Admission Test Partner', otherCompany, 'Other Admission Partner']);
    await owner.query('INSERT INTO "User"(id,email,"passwordHash",status) VALUES ($1,$2,\'test\',\'ACTIVE\'),($3,$4,\'test\',\'ACTIVE\')',
      [scoUser, `${scoUser}@sco.test`, partnerUser, `${partnerUser}@partner.test`]);
    await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES ($1,$2,\'admission-test-manager\',\'Admission Test Manager\'),($3,$4,\'admission-test-partner\',\'Admission Test Partner\')',
      [scoRole, scoCompany, partnerRole, partnerCompany]);
    const scoMembership = id();
    const partnerMembership = id();
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES ($1,$2,$3,\'ACTIVE\'),($4,$5,$6,\'ACTIVE\')',
      [scoMembership, scoUser, scoCompany, partnerMembership, partnerUser, partnerCompany]);
    await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',
      [id(), scoCompany, scoMembership, scoRole, id(), partnerCompany, partnerMembership, partnerRole]);
    for (const code of ['qualification.manage', 'partnership.manage', 'agreement.policy.manage']) await grant(scoRole, scoCompany, code);
    for (const code of ['partner.admission.read', 'partner.agreement.accept']) await grant(partnerRole, partnerCompany, code);

    const now = Date.now();
    const created = await createPolicy('v1', initialContent, new Date(now - 120_000));
    policyV1 = created.id;
    expect(created.content_sha256).toBe(createHash('sha256').update(initialContent, 'utf8').digest('hex'));

    const qualification = (await internal.query(
      'SELECT * FROM public.internal_qualification_create_for_company($1,$2,$3,$4)',
      [scoUser, partnerCompany, 'Admission Test Partner Ltd', 'admission@example.test'],
    )).rows[0];
    await internal.query('SELECT * FROM public.internal_qualification_decide($1,$2,$3,$4)', [scoUser, qualification.id, 'APPROVED', 'Qualification evidence checked']);
    const partnership = (await internal.query('SELECT * FROM public.internal_partnership_create($1,$2,$3)', [scoUser, partnerCompany, 'BUYER_PARTNERSHIP'])).rows[0];
    partnershipId = partnership.id;
  });

  afterAll(async () => {
    await owner.query('DELETE FROM procurement_needs WHERE company_id IN ($1,$2)', [partnerCompany, otherCompany]);
    await owner.query('DELETE FROM partner_agreement_acceptance_events WHERE company_id IN ($1,$2)', [partnerCompany, otherCompany]);
    await owner.query('DELETE FROM partner_agreement_acceptances WHERE company_id IN ($1,$2)', [partnerCompany, otherCompany]);
    await owner.query('DELETE FROM partner_agreement_policy_events WHERE policy_version_id IN (SELECT id FROM partner_agreement_policy_versions WHERE created_by=$1)', [scoUser]);
    await owner.query(
      `UPDATE partner_agreement_policy_versions
         SET supersedes_policy_id = CASE WHEN supersedes_policy_id IN (SELECT id FROM partner_agreement_policy_versions WHERE created_by=$1) THEN NULL ELSE supersedes_policy_id END,
             superseded_by_policy_id = CASE WHEN superseded_by_policy_id IN (SELECT id FROM partner_agreement_policy_versions WHERE created_by=$1) THEN NULL ELSE superseded_by_policy_id END
       WHERE created_by=$1
          OR supersedes_policy_id IN (SELECT id FROM partner_agreement_policy_versions WHERE created_by=$1)
          OR superseded_by_policy_id IN (SELECT id FROM partner_agreement_policy_versions WHERE created_by=$1)`,
      [scoUser],
    );
    await owner.query('DELETE FROM partner_agreement_policy_versions WHERE created_by=$1', [scoUser]);
    await owner.query('DELETE FROM company_partnership_events WHERE company_id IN ($1,$2)', [partnerCompany, otherCompany]);
    await owner.query('DELETE FROM company_partnerships WHERE company_id IN ($1,$2)', [partnerCompany, otherCompany]);
    await owner.query('DELETE FROM qualification_application_events WHERE company_id IN ($1,$2)', [partnerCompany, otherCompany]);
    await owner.query('DELETE FROM qualification_applications WHERE company_id IN ($1,$2)', [partnerCompany, otherCompany]);
    await owner.query('DELETE FROM audit_logs WHERE actor_user_id IN ($1,$2) OR company_id IN ($3,$4)', [scoUser, partnerUser, partnerCompany, otherCompany]);
    await owner.query('DELETE FROM "MembershipRole" WHERE company_id IN ($1,$2)', [scoCompany, partnerCompany]);
    await owner.query('DELETE FROM "RolePermission" WHERE role_id IN ($1,$2)', [scoRole, partnerRole]);
    await owner.query('DELETE FROM "CompanyMembership" WHERE "userId" IN ($1,$2)', [scoUser, partnerUser]);
    await owner.query('DELETE FROM "Role" WHERE id IN ($1,$2)', [scoRole, partnerRole]);
    await owner.query('DELETE FROM "User" WHERE id IN ($1,$2)', [scoUser, partnerUser]);
    await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2,$3)', [scoCompany, partnerCompany, otherCompany]);
    await owner.end();
    await runtime.end();
    await internal.end();
  });

  it('requires binding confidentiality before approval and denies procurement before Active Partner', async () => {
    await expect(internal.query('SELECT * FROM public.internal_partnership_activate($1,$2)', [scoUser, partnershipId]))
      .rejects.toThrow('PARTNERSHIP_APPROVAL_REQUIRED');
    await expect(internal.query('SELECT * FROM public.internal_partnership_approve($1,$2,$3,$4)', [scoUser, partnershipId, 'Approved', id()]))
      .rejects.toThrow('PARTNERSHIP_AGREEMENT_REQUIRED');
    await expect(internal.query(
      'SELECT * FROM public.internal_procurement_need_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [partnerUser, partnerCompany, 'Blocked demand', 1, null, new Date().toISOString().slice(0, 10), null, null, null, id()],
    )).rejects.toThrow('PROCUREMENT_NEED_INTAKE_FORBIDDEN');
  });

  it('denies Supplier activation from UNDER_REVIEW and permits the existing approved-state activation contract', async () => {
    const supplierPartnership = (await internal.query(
      'SELECT * FROM public.internal_partnership_create($1,$2,$3)',
      [scoUser, partnerCompany, 'SUPPLIER_PARTNERSHIP'],
    )).rows[0];

    expect(supplierPartnership.status).toBe('UNDER_REVIEW');
    await expect(internal.query('SELECT * FROM public.internal_partnership_activate($1,$2)', [scoUser, supplierPartnership.id]))
      .rejects.toThrow('PARTNERSHIP_STATE_INVALID');

    await owner.query(`UPDATE company_partnerships SET status='APPROVED' WHERE id=$1`, [supplierPartnership.id]);
    const activated = await internal.query('SELECT * FROM public.internal_partnership_activate($1,$2)', [scoUser, supplierPartnership.id]);
    expect(activated.rows[0]).toMatchObject({ id: supplierPartnership.id, type: 'SUPPLIER_PARTNERSHIP', status: 'ACTIVE' });
  });

  it('exposes the current immutable content only to the bound company and records idempotent acceptance', async () => {
    const agreements = await withRuntime(partnerUser, partnerCompany, (client) => client.query('SELECT * FROM public.partner_agreement_current()'));
    expect(agreements.rows).toHaveLength(1);
    expect(agreements.rows[0].agreement_type).toBe('BINDING_CONFIDENTIALITY');
    expect(agreements.rows[0].version_code).toBe('v1');
    expect(agreements.rows[0].content_text).toBe(initialContent);
    expect(agreements.rows[0]).not.toHaveProperty('content_sha256');

    await owner.query(
      'DELETE FROM "RolePermission" WHERE role_id=$1 AND permission_id=(SELECT id FROM "Permission" WHERE code=$2)',
      [partnerRole, 'partner.agreement.accept'],
    );
    try {
      await expect(withRuntime(partnerUser, partnerCompany, (client) =>
        client.query('SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)', ['BINDING_CONFIDENTIALITY', 'v1', `unauthorized-${id()}`, id()])))
        .rejects.toThrow('AGREEMENT_ACCEPTANCE_AUTHORITY_FORBIDDEN');
    } finally {
      await grant(partnerRole, partnerCompany, 'partner.agreement.accept');
    }

    const accepted = await withRuntime(partnerUser, partnerCompany, (client) =>
      client.query('SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)', ['BINDING_CONFIDENTIALITY', 'v1', 'acceptance-retry-key-0001', id()]));
    originalAcceptedAt = accepted.rows[0].accepted_at;
    const retry = await withRuntime(partnerUser, partnerCompany, (client) =>
      client.query('SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)', ['BINDING_CONFIDENTIALITY', 'v1', 'acceptance-retry-key-0001', id()]));
    expect(retry.rows[0].accepted_at).toEqual(originalAcceptedAt);
    const beforeReconciliation = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM partner_agreement_acceptances WHERE company_id=$1) AS acceptances,
         (SELECT count(*)::int FROM partner_agreement_acceptance_events WHERE company_id=$1) AS events,
         (SELECT count(*)::int FROM audit_logs WHERE company_id=$1 AND action='agreement.accepted') AS audits`,
      [partnerCompany],
    );
    const reconciled = await withRuntime(partnerUser, partnerCompany, (client) =>
      client.query('SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)', ['BINDING_CONFIDENTIALITY', 'v1', 'fresh-reconciliation-key-0001', id()]));
    expect(reconciled.rows[0]).toMatchObject({ agreement_type: 'BINDING_CONFIDENTIALITY', version_code: 'v1', acceptance_status: 'ACCEPTED' });
    const afterReconciliation = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM partner_agreement_acceptances WHERE company_id=$1) AS acceptances,
         (SELECT count(*)::int FROM partner_agreement_acceptance_events WHERE company_id=$1) AS events,
         (SELECT count(*)::int FROM audit_logs WHERE company_id=$1 AND action='agreement.accepted') AS audits`,
      [partnerCompany],
    );
    expect(afterReconciliation.rows[0]).toEqual(beforeReconciliation.rows[0]);
    expect(await owner.query('SELECT count(*)::int AS count FROM partner_agreement_acceptances WHERE company_id=$1', [partnerCompany]).then((r) => r.rows[0].count)).toBe(1);
    expect(await owner.query('SELECT authority_basis FROM partner_agreement_acceptances WHERE company_id=$1', [partnerCompany]).then((r) => r.rows[0].authority_basis.requiredPermissions)).toContain('partner.agreement.accept');
  });

  it('requires configured Partner capability for activation, then activates and permits procurement', async () => {
    await internal.query('SELECT * FROM public.internal_partnership_approve($1,$2,$3,$4)', [scoUser, partnershipId, 'Agreement evidence complete', id()]);
    await expect(internal.query('SELECT * FROM public.internal_partnership_activate($1,$2)', [scoUser, partnershipId]))
      .rejects.toThrow('PARTNERSHIP_ONBOARDING_INCOMPLETE');
    await grant(partnerRole, partnerCompany, 'partner.portal.read');
    const active = await internal.query('SELECT * FROM public.internal_partnership_activate($1,$2)', [scoUser, partnershipId]);
    expect(active.rows[0].status).toBe('ACTIVE');
    const admission = await withRuntime(partnerUser, partnerCompany, (client) => client.query('SELECT * FROM public.partner_admission_status()'));
    expect(admission.rows[0]).toMatchObject({ partnership_type: 'BUYER_PARTNERSHIP', partnership_status: 'ACTIVE' });
    const created = await internal.query(
      'SELECT * FROM public.internal_procurement_need_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [partnerUser, partnerCompany, 'Authorized demand', 1, null, new Date().toISOString().slice(0, 10), null, null, null, id()],
    );
    expect(created.rows[0].description).toBe('Authorized demand');
  });

  it('requires the newly effective version when policy demands re-acceptance and preserves the old evidence', async () => {
    const versionTwoContent = 'Binding confidentiality terms version two.';
    const policy = await createPolicy('v2', versionTwoContent, new Date(Date.now() - 60_000));
    policyV2 = policy.id;
    expect(policy.id).not.toBe(policyV1);
    const current = await withRuntime(partnerUser, partnerCompany, (client) => client.query('SELECT * FROM public.partner_agreement_current()'));
    expect(current.rows[0].version_code).toBe('v2');
    expect(current.rows[0].acceptance_status).toBe('REACCEPTANCE_REQUIRED');
    await expect(withRuntime(partnerUser, partnerCompany, (client) =>
      client.query('SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)', ['BINDING_CONFIDENTIALITY', 'v2', 'acceptance-retry-key-0001', id()])))
      .rejects.toThrow('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    await expect(internal.query(
      'SELECT * FROM public.internal_procurement_need_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [partnerUser, partnerCompany, 'Stale agreement demand', 1, null, new Date().toISOString().slice(0, 10), null, null, null, id()],
    )).rejects.toThrow('PROCUREMENT_NEED_INTAKE_FORBIDDEN');
    await withRuntime(partnerUser, partnerCompany, (client) =>
      client.query('SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)', ['BINDING_CONFIDENTIALITY', 'v2', 'acceptance-retry-key-0002', id()]));
    expect(await owner.query('SELECT count(*)::int AS count FROM partner_agreement_acceptances WHERE company_id=$1', [partnerCompany]).then((r) => r.rows[0].count)).toBe(2);
    expect(await owner.query('SELECT accepted_at FROM partner_agreement_acceptances WHERE company_id=$1 AND version_code=\'v1\'', [partnerCompany]).then((r) => r.rows[0].accepted_at)).toEqual(originalAcceptedAt);
  });

  it('denies foreign-company reads and direct evidence access, and applies policy suspension immediately', async () => {
    await expect(withRuntime(partnerUser, otherCompany, (client) => client.query('SELECT * FROM public.partner_agreement_current()')))
      .rejects.toThrow('PARTNER_ADMISSION_READ_FORBIDDEN');
    await expect(runtime.query('SELECT * FROM public.partner_agreement_acceptances')).rejects.toMatchObject({ code: '42501' });

    await internal.query('SELECT * FROM public.internal_partner_agreement_policy_transition($1,$2,$3,$4,$5)',
      [scoUser, policyV2, 'SUSPENDED', 'Policy suspended for test', id()]);
    const allowed = await withRuntime(partnerUser, partnerCompany, async (client) => {
      const result = await client.query('SELECT public.partner_procurement_access_allowed_for_current_actor() AS allowed');
      return result.rows[0].allowed;
    });
    expect(allowed).toBe(false);
    await expect(owner.query('UPDATE partner_agreement_acceptance_events SET reason=\'rewritten\' WHERE company_id=$1', [partnerCompany]))
      .rejects.toThrow('ADMISSION_HISTORY_IMMUTABLE');
  });

  it('rejects optional agreements and refuses acceptance outside the permitted partnership lifecycle', async () => {
    const optional = await internal.query(
      `SELECT * FROM public.internal_partner_agreement_policy_create(
        $1,'OPTIONAL_NOTICE',$2,$3,$4,'partner.agreement.accept',false,'NO_ACCESS_CHANGE','NO_ACCESS_CHANGE','TEST_OPTIONAL',false,$5
      )`,
      [scoUser, `optional-${id()}`, 'Optional notice', new Date(Date.now() - 60_000).toISOString(), id()],
    );
    await internal.query('SELECT * FROM public.internal_partner_agreement_policy_publish($1,$2,$3)', [scoUser, optional.rows[0].id, id()]);
    await expect(withRuntime(partnerUser, partnerCompany, (client) =>
      client.query('SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)', ['OPTIONAL_NOTICE', optional.rows[0].version_code, `optional-${id()}`, id()])))
      .rejects.toThrow('AGREEMENT_VERSION_NOT_CURRENT');

    const concurrent = await internal.query(
      `SELECT * FROM public.internal_partner_agreement_policy_create(
        $1,'CONCURRENT_NOTICE',$2,$3,$4,'partner.agreement.accept',false,'NO_ACCESS_CHANGE','NO_ACCESS_CHANGE','TEST_CONCURRENT',true,$5
      )`,
      [scoUser, `concurrent-${id()}`, 'Concurrent acceptance notice', new Date(Date.now() - 60_000).toISOString(), id()],
    );
    await internal.query('SELECT * FROM public.internal_partner_agreement_policy_publish($1,$2,$3)', [scoUser, concurrent.rows[0].id, id()]);
    const concurrentResults = await Promise.all([
      withRuntime(partnerUser, partnerCompany, (client) => client.query('SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)', ['CONCURRENT_NOTICE', concurrent.rows[0].version_code, `concurrent-a-${id()}`, id()])),
      withRuntime(partnerUser, partnerCompany, (client) => client.query('SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)', ['CONCURRENT_NOTICE', concurrent.rows[0].version_code, `concurrent-b-${id()}`, id()])),
    ]);
    expect(concurrentResults.every((result) => result.rows[0].acceptance_status === 'ACCEPTED')).toBe(true);
    expect(await owner.query(`SELECT count(*)::int AS count FROM partner_agreement_acceptances WHERE company_id=$1 AND policy_version_id=$2`, [partnerCompany, concurrent.rows[0].id]).then((r) => r.rows[0].count)).toBe(1);

    await owner.query(`UPDATE company_partnerships SET status='REVOKED' WHERE id=$1`, [partnershipId]);
    await expect(withRuntime(partnerUser, partnerCompany, (client) =>
      client.query('SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)', ['BINDING_CONFIDENTIALITY', 'v1', `revoked-${id()}`, id()])))
      .rejects.toThrow('AGREEMENT_ACCEPTANCE_AUTHORITY_FORBIDDEN');

    await owner.query(`UPDATE company_partnerships SET status='SUSPENDED' WHERE id=$1`, [partnershipId]);
    const suspendedBefore = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM partner_agreement_acceptances WHERE company_id=$1) AS acceptances,
         (SELECT count(*)::int FROM partner_agreement_acceptance_events WHERE company_id=$1) AS events,
         (SELECT count(*)::int FROM audit_logs WHERE company_id=$1 AND action='agreement.accepted') AS audits`,
      [partnerCompany],
    );
    const suspendedKey = `suspended-${id()}`;
    await expect(withRuntime(partnerUser, partnerCompany, (client) =>
      client.query('SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)', ['CONCURRENT_NOTICE', concurrent.rows[0].version_code, suspendedKey, id()])))
      .rejects.toThrow('AGREEMENT_ACCEPTANCE_AUTHORITY_FORBIDDEN');
    await expect(withRuntime(partnerUser, partnerCompany, (client) =>
      client.query('SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)', ['CONCURRENT_NOTICE', concurrent.rows[0].version_code, suspendedKey, id()])))
      .rejects.toThrow('AGREEMENT_ACCEPTANCE_AUTHORITY_FORBIDDEN');
    const suspendedAfter = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM partner_agreement_acceptances WHERE company_id=$1) AS acceptances,
         (SELECT count(*)::int FROM partner_agreement_acceptance_events WHERE company_id=$1) AS events,
         (SELECT count(*)::int FROM audit_logs WHERE company_id=$1 AND action='agreement.accepted') AS audits`,
      [partnerCompany],
    );
    expect(suspendedAfter.rows[0]).toEqual(suspendedBefore.rows[0]);
  });

  it('uses a locked-down gateway role, FORCE RLS, fixed search_path, and no PUBLIC execute', async () => {
    const role = await owner.query(`SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname='sco_partner_admission_gateway_owner'`);
    expect(role.rows[0]).toEqual({ rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false });
    const table = await owner.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='partner_agreement_acceptances'::regclass`);
    expect(table.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const routine = await owner.query(`SELECT proconfig, proacl FROM pg_proc WHERE oid='partner_agreement_accept(text,text,text,uuid)'::regprocedure`);
    expect(routine.rows[0].proconfig).toContain('search_path=pg_catalog, public');
    expect(await owner.query(`SELECT has_function_privilege('sco_runtime','partner_agreement_accept(text,text,text,uuid)','EXECUTE') AS runtime_execute`).then((r) => r.rows[0].runtime_execute)).toBe(true);
    expect(await owner.query(`SELECT has_function_privilege('sco_runtime','internal_partner_agreement_policy_create(uuid,text,text,text,timestamptz,text,boolean,text,text,text,boolean,uuid)','EXECUTE') AS internal_execute`).then((r) => r.rows[0].internal_execute)).toBe(false);
  });
});
