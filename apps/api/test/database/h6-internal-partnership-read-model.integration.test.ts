import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

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

describe('H6 internal partnership read model', () => {
  const scoCompany = id();
  const manager = id();
  const managerRole = id();
  const noCapabilityActor = id();
  const partnerCompany = id();
  const partnerUser = id();
  const partnerMembership = id();
  const partnerRole = id();
  let managerMembership: string;
  let noCapabilityMembership: string;
  const qualificationId = id();
  const partnershipId = id();
  let policyV2: string;
  let service: InternalDatabaseService;
  const terminalIds = new Map<string, string>();
  const terminalCompanies = new Map<string, string>();
  const queueCompanionId = id();
  const queueCompanionCompany = id();
  const supplierPartnershipId = id();
  let companionQualification: string;

  async function grant(roleId: string, companyId: string, code: string) {
    await owner.query(
      `INSERT INTO "RolePermission"(id,company_id,role_id,permission_id)
       SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4 ON CONFLICT DO NOTHING`,
      [id(), companyId, roleId, code],
    );
  }

  async function acceptCurrent(version: string, key: string) {
    await withRuntime(partnerUser, partnerCompany, (client) => client.query(
      'SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)',
      ['BINDING_CONFIDENTIALITY', version, key, id()],
    ));
  }

  async function readiness() {
    return (await internal.query(
      'SELECT * FROM public.internal_partnership_readiness_get($1,$2)',
      [manager, partnershipId],
    )).rows[0];
  }

  beforeAll(async () => {
    service = new InternalDatabaseService();
    await owner.query(
      `INSERT INTO "Company"(id,name,type,status) VALUES
       ($1,'H6 SCO','SCO','ACTIVE'),($2,'H6 Partner','PARTNER','ACTIVE'),
       ($3,'H6 Queue Companion','PARTNER','ACTIVE')`,
      [scoCompany, partnerCompany, queueCompanionCompany],
    );
    await owner.query(
      `INSERT INTO "User"(id,email,"passwordHash",status) VALUES
       ($1,$2,'test','ACTIVE'),($3,$4,'test','ACTIVE'),($5,$6,'test','ACTIVE')`,
      [manager, `${manager}@h6.test`, noCapabilityActor, `${noCapabilityActor}@h6.test`, partnerUser, `${partnerUser}@h6.test`],
    );
    await owner.query(
      `INSERT INTO "Role"(id,company_id,code,name) VALUES
       ($1,$2,'h6-manager','H6 Manager'),($3,$4,'h6-partner','H6 Partner')`,
      [managerRole, scoCompany, partnerRole, partnerCompany],
    );
    managerMembership = id();
    noCapabilityMembership = id();
    await owner.query(
      `INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES
       ($1,$2,$3,'ACTIVE'),($4,$5,$3,'ACTIVE'),($6,$7,$8,'ACTIVE')`,
      [managerMembership, manager, scoCompany, noCapabilityMembership, noCapabilityActor, partnerMembership, partnerUser, partnerCompany],
    );
    await owner.query(
      `INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES
       ($1,$2,$3,$4),($5,$6,$7,$8)`,
      [id(), scoCompany, managerMembership, managerRole, id(), partnerCompany, partnerMembership, partnerRole],
    );
    await grant(managerRole, scoCompany, 'partnership.manage');
    await grant(managerRole, scoCompany, 'agreement.policy.manage');
    await grant(partnerRole, partnerCompany, 'partner.agreement.accept');
    await grant(partnerRole, partnerCompany, 'partner.portal.read');

    await owner.query(
      `INSERT INTO qualification_applications(id,company_id,legal_name,contact_email,status)
       VALUES ($1,$2,'H6 Partner Legal','private@h6.test','APPROVED')`,
      [qualificationId, partnerCompany],
    );
    await owner.query(
      `INSERT INTO company_partnerships(id,company_id,type,status,qualification_application_id,created_at,updated_at)
       VALUES ($1,$2,'BUYER_PARTNERSHIP','UNDER_REVIEW',$3,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
      [partnershipId, partnerCompany, qualificationId],
    );

    const policy = await internal.query(
      `SELECT * FROM public.internal_partner_agreement_policy_create(
        $1,'BINDING_CONFIDENTIALITY','h6-v1','H6 confidential agreement content',
        '2025-01-01T00:00:00Z','partner.agreement.accept',true,
        'REQUIRE_REACCEPTANCE','BLOCK_OPERATIONAL_ACCESS','H6_TEST',true,$2)`,
      [manager, id()],
    );
    await internal.query('SELECT * FROM public.internal_partner_agreement_policy_publish($1,$2,$3)', [manager, policy.rows[0].id, id()]);
    await acceptCurrent('h6-v1', `h6-v1-${id()}`);

    companionQualification = id();
    await owner.query(
      `INSERT INTO qualification_applications(id,company_id,legal_name,contact_email,status)
       VALUES ($1,$2,'Companion Legal','private-companion@h6.test','REJECTED')`,
      [companionQualification, queueCompanionCompany],
    );
    await owner.query(
      `INSERT INTO company_partnerships(id,company_id,type,status,qualification_application_id,created_at,updated_at)
       VALUES ($1,$2,'BUYER_PARTNERSHIP','APPROVED',$3,'2026-01-02T00:00:00Z','2026-01-02T00:00:00Z')`,
      [queueCompanionId, queueCompanionCompany, companionQualification],
    );
    for (const status of ['ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED']) {
      const terminalId = id();
      const terminalCompany = id();
      terminalIds.set(status, terminalId);
      terminalCompanies.set(status, terminalCompany);
      await owner.query(
        `INSERT INTO "Company"(id,name,type,status) VALUES ($1,$2,'PARTNER','ACTIVE')`,
        [terminalCompany, `H6 ${status} Partner`],
      );
      await owner.query(
        `INSERT INTO company_partnerships(id,company_id,type,status,created_at,updated_at)
         VALUES ($1,$2,'BUYER_PARTNERSHIP',$3,'2026-02-01T00:00:00Z','2026-02-01T00:00:00Z')`,
        [terminalId, terminalCompany, status],
      );
    }
    await owner.query(
      `INSERT INTO company_partnerships(id,company_id,type,status,created_at,updated_at)
       VALUES ($1,$2,'SUPPLIER_PARTNERSHIP','UNDER_REVIEW','2026-02-02T00:00:00Z','2026-02-02T00:00:00Z')`,
      [supplierPartnershipId, partnerCompany],
    );
  });

  async function cleanup() {
    const partnerships = [partnershipId, queueCompanionId, supplierPartnershipId, ...terminalIds.values()]
      .filter((value): value is string => Boolean(value));
    const qualifications = [qualificationId, companionQualification]
      .filter((value): value is string => Boolean(value));
    const companies = [scoCompany, partnerCompany, queueCompanionCompany, ...terminalCompanies.values()]
      .filter((value): value is string => Boolean(value));
    const users = [manager, noCapabilityActor, partnerUser]
      .filter((value): value is string => Boolean(value));
    const memberships = [managerMembership, noCapabilityMembership, partnerMembership]
      .filter((value): value is string => Boolean(value));
    const roles = [managerRole, partnerRole]
      .filter((value): value is string => Boolean(value));
    const policyIds = (await owner.query('SELECT id FROM partner_agreement_policy_versions WHERE created_by=$1', [manager])).rows.map((row) => row.id);

    if (policyIds.length > 0) {
      await owner.query('DELETE FROM partner_agreement_acceptance_events WHERE acceptance_id IN (SELECT id FROM partner_agreement_acceptances WHERE policy_version_id = ANY($1::uuid[]))', [policyIds]);
      await owner.query('DELETE FROM partner_agreement_acceptances WHERE policy_version_id = ANY($1::uuid[])', [policyIds]);
      await owner.query('DELETE FROM partner_agreement_policy_events WHERE policy_version_id = ANY($1::uuid[])', [policyIds]);
      await owner.query(
        `UPDATE partner_agreement_policy_versions
         SET supersedes_policy_id=NULL, superseded_by_policy_id=NULL
         WHERE id = ANY($1::uuid[])
            OR supersedes_policy_id = ANY($1::uuid[])
            OR superseded_by_policy_id = ANY($1::uuid[])`,
        [policyIds],
      );
      await owner.query('DELETE FROM partner_agreement_policy_versions WHERE id = ANY($1::uuid[])', [policyIds]);
    }
    await owner.query('DELETE FROM company_partnership_events WHERE partnership_id = ANY($1::uuid[])', [partnerships]);
    await owner.query('DELETE FROM qualification_application_events WHERE qualification_application_id = ANY($1::uuid[])', [qualifications]);
    await owner.query('DELETE FROM audit_logs WHERE company_id = ANY($1::uuid[]) OR actor_user_id = ANY($2::uuid[])', [companies, users]);
    await owner.query('DELETE FROM company_partnerships WHERE id = ANY($1::uuid[])', [partnerships]);
    await owner.query('DELETE FROM qualification_applications WHERE id = ANY($1::uuid[])', [qualifications]);
    await owner.query('DELETE FROM "MembershipRole" WHERE membership_id = ANY($1::uuid[]) OR role_id = ANY($2::uuid[])', [memberships, roles]);
    await owner.query('DELETE FROM "RolePermission" WHERE role_id = ANY($1::uuid[])', [roles]);
    await owner.query('DELETE FROM "Session" WHERE "userId" = ANY($1::uuid[])', [users]);
    await owner.query('DELETE FROM "CompanyMembership" WHERE id = ANY($1::uuid[])', [memberships]);
    await owner.query('DELETE FROM "Role" WHERE id = ANY($1::uuid[])', [roles]);
    await owner.query('DELETE FROM "User" WHERE id = ANY($1::uuid[])', [users]);
    await owner.query('DELETE FROM "Company" WHERE id = ANY($1::uuid[])', [companies]);
  }

  afterAll(async () => {
    await service?.onModuleDestroy();
    await runtime.end();
    await internal.end();
    await cleanup();
    await owner.end();
  });

  it('locks down both gateways and checks partnership.manage before lookup', async () => {
    await expect(internal.query('SELECT * FROM public.internal_partnership_action_queue($1)', [noCapabilityActor]))
      .rejects.toThrow('PARTNERSHIP_MANAGE_FORBIDDEN');
    await expect(internal.query('SELECT * FROM public.internal_partnership_readiness_get($1,$2)', [noCapabilityActor, partnershipId]))
      .rejects.toThrow('PARTNERSHIP_MANAGE_FORBIDDEN');
    await expect(internal.query('SELECT * FROM public.internal_partnership_readiness_get($1,$2)', [id(), partnershipId]))
      .rejects.toThrow('PARTNERSHIP_MANAGE_FORBIDDEN');
    await expect(runtime.query('SELECT * FROM public.internal_partnership_action_queue($1)', [partnerUser]))
      .rejects.toMatchObject({ code: '42501' });

    for (const signature of ['internal_partnership_action_queue(uuid)', 'internal_partnership_readiness_get(uuid,uuid)']) {
      const routine = await owner.query('SELECT prosecdef, proconfig, pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure', [signature]);
      expect(routine.rows[0]).toMatchObject({ prosecdef: true, owner: 'sco_partner_admission_gateway_owner' });
      expect(routine.rows[0].proconfig).toContain('search_path=pg_catalog, public');
      expect(await owner.query(`SELECT has_function_privilege('sco_internal_executor',$1,'EXECUTE') AS allowed`, [signature]).then((r) => r.rows[0].allowed)).toBe(true);
      expect(await owner.query(`SELECT has_function_privilege('sco_runtime',$1,'EXECUTE') AS allowed`, [signature]).then((r) => r.rows[0].allowed)).toBe(false);
    }
    for (const table of ['company_partnerships', 'qualification_applications', 'partner_agreement_acceptances']) {
      expect(await owner.query(`SELECT has_table_privilege('sco_internal_executor',$1,'SELECT') AS allowed`, [table]).then((r) => r.rows[0].allowed)).toBe(false);
    }
  });

  it('returns only actionable Buyer rows in deterministic creation/id order', async () => {
    const rows = (await internal.query('SELECT * FROM public.internal_partnership_action_queue($1)', [manager])).rows;
    expect(rows.map((row) => row.partnership_id)).toEqual([partnershipId, queueCompanionId, terminalIds.get('SUSPENDED')]);
    expect(rows.map((row) => row.partnership_status)).toEqual(['UNDER_REVIEW', 'APPROVED', 'SUSPENDED']);
    expect(rows.some((row) => row.partnership_id === supplierPartnershipId)).toBe(false);
    for (const [status, terminalId] of terminalIds) {
      if (status !== 'SUSPENDED') expect(rows.some((row) => row.partnership_id === terminalId)).toBe(false);
    }
  });

  it('maps the trusted server integration to the typed minimum projection', async () => {
    const queue = await service.partnershipActionQueue(manager);
    expect(queue.map((row) => row.partnershipId)).toEqual([partnershipId, queueCompanionId, terminalIds.get('SUSPENDED')]);
    const detail = await service.partnershipReadinessGet(manager, partnershipId);
    expect(detail).toMatchObject({
      partnershipId,
      companyId: partnerCompany,
      companyDisplayName: 'H6 Partner',
      nextInternalAction: 'APPROVE',
      actionReady: true,
      blockers: [],
    });
  });

  it('returns the minimum projection, safe no-row lookup, and ready approval facts', async () => {
    const row = await readiness();
    expect(Object.keys(row).sort()).toEqual([
      'action_ready', 'active_portal_membership_ready', 'blockers', 'company_active', 'company_display_name',
      'company_id', 'company_status', 'created_at', 'next_internal_action', 'partner_portal_read_ready',
      'partnership_id', 'partnership_status', 'partnership_type', 'qualification_ready', 'qualification_status',
      'required_agreements_satisfied', 'updated_at',
    ]);
    expect(row).toMatchObject({
      partnership_id: partnershipId, company_id: partnerCompany, company_display_name: 'H6 Partner',
      partnership_type: 'BUYER_PARTNERSHIP', partnership_status: 'UNDER_REVIEW', qualification_status: 'APPROVED',
      qualification_ready: true, required_agreements_satisfied: true, company_status: 'ACTIVE', company_active: true,
      next_internal_action: 'APPROVE', action_ready: true, blockers: [],
    });
    expect(JSON.stringify(row)).not.toContain('H6 confidential agreement content');
    expect(JSON.stringify(row)).not.toContain('private@h6.test');
    expect((await internal.query('SELECT * FROM public.internal_partnership_readiness_get($1,$2)', [manager, id()])).rows).toEqual([]);
    expect((await internal.query('SELECT * FROM public.internal_partnership_readiness_get($1,$2)', [manager, supplierPartnershipId])).rows).toEqual([]);
  });

  it('derives deterministic approval blockers from current authoritative facts', async () => {
    await owner.query(`UPDATE qualification_applications SET status='REJECTED' WHERE id=$1`, [qualificationId]);
    await owner.query(`UPDATE "Company" SET status='SUSPENDED' WHERE id=$1`, [partnerCompany]);
    const policy = await internal.query(
      `SELECT * FROM public.internal_partner_agreement_policy_create(
        $1,'BINDING_CONFIDENTIALITY','h6-v2','Replacement confidential content',
        '2025-02-01T00:00:00Z','partner.agreement.accept',true,
        'REQUIRE_REACCEPTANCE','BLOCK_OPERATIONAL_ACCESS','H6_TEST',true,$2)`,
      [manager, id()],
    );
    policyV2 = policy.rows[0].id;
    await internal.query('SELECT * FROM public.internal_partner_agreement_policy_publish($1,$2,$3)', [manager, policyV2, id()]);
    const blocked = await readiness();
    expect(blocked.action_ready).toBe(false);
    expect(blocked.blockers).toEqual(['QUALIFICATION_NOT_APPROVED', 'REQUIRED_AGREEMENTS_NOT_SATISFIED']);
    expect(new Set(blocked.blockers).size).toBe(blocked.blockers.length);
    await owner.query(`UPDATE qualification_applications SET status='APPROVED' WHERE id=$1`, [qualificationId]);
    await owner.query(`UPDATE "Company" SET status='ACTIVE' WHERE id=$1`, [partnerCompany]);
    await acceptCurrent('h6-v2', `h6-v2-${id()}`);
    expect(await readiness()).toMatchObject({ action_ready: true, blockers: [] });
  });

  it('derives activation readiness from current membership, user, and permission composition', async () => {
    await owner.query(`UPDATE company_partnerships SET status='APPROVED' WHERE id=$1`, [partnershipId]);
    expect(await readiness()).toMatchObject({ next_internal_action: 'ACTIVATE', active_portal_membership_ready: true, partner_portal_read_ready: true, action_ready: true, blockers: [] });
    await owner.query(`UPDATE "CompanyMembership" SET status='SUSPENDED' WHERE id=$1`, [partnerMembership]);
    expect(await readiness()).toMatchObject({ active_portal_membership_ready: false, partner_portal_read_ready: false, action_ready: false, blockers: ['NO_ACTIVE_PORTAL_MEMBER', 'PARTNER_PORTAL_READ_NOT_READY'] });
    await owner.query(`UPDATE "CompanyMembership" SET status='ACTIVE' WHERE id=$1`, [partnerMembership]);
    await owner.query(`UPDATE "User" SET status='DISABLED' WHERE id=$1`, [partnerUser]);
    expect(await readiness()).toMatchObject({ active_portal_membership_ready: false, partner_portal_read_ready: false, action_ready: false });
    await owner.query(`UPDATE "User" SET status='ACTIVE' WHERE id=$1`, [partnerUser]);
    await owner.query(`DELETE FROM "RolePermission" WHERE role_id=$1 AND permission_id=(SELECT id FROM "Permission" WHERE code='partner.portal.read')`, [partnerRole]);
    expect(await readiness()).toMatchObject({ active_portal_membership_ready: true, partner_portal_read_ready: false, action_ready: false, blockers: ['PARTNER_PORTAL_READ_NOT_READY'] });
    await grant(partnerRole, partnerCompany, 'partner.portal.read');
    expect(await readiness()).toMatchObject({ partner_portal_read_ready: true, action_ready: true, blockers: [] });
  });

  it('mirrors approval authority when the company is not active', async () => {
    await owner.query(`UPDATE company_partnerships SET status='UNDER_REVIEW', approved_by=NULL, approved_at=NULL, decision_reason=NULL WHERE id=$1`, [partnershipId]);
    await owner.query(`UPDATE "Company" SET status='SUSPENDED' WHERE id=$1`, [partnerCompany]);
    const projected = await readiness();
    expect(projected).toMatchObject({
      partnership_status: 'UNDER_REVIEW',
      next_internal_action: 'APPROVE',
      action_ready: true,
      blockers: [],
    });
    const approved = await internal.query(
      'SELECT * FROM public.internal_partnership_approve($1,$2,$3,$4)',
      [manager, partnershipId, 'approve while company is suspended', id()],
    );
    expect(approved.rows[0]).toMatchObject({ id: partnershipId, status: 'APPROVED' });
    await owner.query(`UPDATE company_partnerships SET status='UNDER_REVIEW', approved_by=NULL, approved_at=NULL, decision_reason=NULL WHERE id=$1`, [partnershipId]);
    await owner.query(`UPDATE "Company" SET status='ACTIVE' WHERE id=$1`, [partnerCompany]);
  });

  it('projects supported suspended reactivation without inventing a new lifecycle action', async () => {
    await owner.query(`UPDATE company_partnerships SET status='SUSPENDED' WHERE id=$1`, [partnershipId]);
    const projected = await readiness();
    expect(projected).toMatchObject({
      partnership_status: 'SUSPENDED',
      next_internal_action: 'ACTIVATE',
      action_ready: true,
      blockers: [],
    });
    const queue = await internal.query('SELECT * FROM public.internal_partnership_action_queue($1)', [manager]);
    expect(queue.rows.find((row) => row.partnership_id === partnershipId)).toMatchObject({
      partnership_status: 'SUSPENDED',
      next_internal_action: 'ACTIVATE',
      action_ready: true,
    });
    const activated = await internal.query('SELECT * FROM public.internal_partnership_activate($1,$2)', [manager, partnershipId]);
    expect(activated.rows[0]).toMatchObject({ id: partnershipId, status: 'ACTIVE' });
    await owner.query(`UPDATE company_partnerships SET status='APPROVED', active_from=NULL, suspended_at=NULL, suspended_by=NULL WHERE id=$1`, [partnershipId]);
  });

  it('represents every terminal Buyer lifecycle state as non-actionable', async () => {
    for (const [status, terminalId] of terminalIds) {
      if (status === 'SUSPENDED') continue;
      const row = (await internal.query('SELECT * FROM public.internal_partnership_readiness_get($1,$2)', [manager, terminalId])).rows[0];
      expect(row).toMatchObject({ partnership_status: status, next_internal_action: 'NONE', action_ready: false, blockers: ['LIFECYCLE_NOT_ACTIONABLE'] });
    }
  });

  it('does not mutate durable state while reading queue and detail', async () => {
    const snapshot = async () => (await owner.query(
      `SELECT (SELECT count(*)::int FROM company_partnerships) AS partnerships,
        (SELECT count(*)::int FROM qualification_applications) AS qualifications,
        (SELECT count(*)::int FROM partner_agreement_acceptances) AS acceptances,
        (SELECT count(*)::int FROM partner_agreement_acceptance_events) AS acceptance_events,
        (SELECT count(*)::int FROM "CompanyMembership") AS memberships,
        (SELECT count(*)::int FROM "MembershipRole") AS membership_roles,
        (SELECT count(*)::int FROM "RolePermission") AS role_permissions,
        (SELECT count(*)::int FROM service_entitlements) AS entitlements,
        (SELECT count(*)::int FROM partner_workspaces) AS workspaces,
        (SELECT count(*)::int FROM audit_logs) AS audits`,
    )).rows[0];
    const before = await snapshot();
    await internal.query('SELECT * FROM public.internal_partnership_action_queue($1)', [manager]);
    await internal.query('SELECT * FROM public.internal_partnership_readiness_get($1,$2)', [manager, partnershipId]);
    expect(await snapshot()).toEqual(before);
  });
});
