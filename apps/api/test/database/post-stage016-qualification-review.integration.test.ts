import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
const id = () => randomUUID();

describe('Post-Stage016 qualification internal review', () => {
  const scoCompany = id();
  const partnerCompany = id();
  const otherCompany = id();
  const scoUser = id();
  const partnerUser = id();
  const otherUser = id();
  const scoRole = id();
  const partnerRole = id();
  let qualificationId: string;

  async function grant(roleId: string, companyId: string, permission: string) {
    await owner.query(
      'INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4 ON CONFLICT DO NOTHING',
      [id(), companyId, roleId, permission],
    );
  }

  async function tenantCall<T>(actor: string, company: string, sql: string, values: unknown[] = []) {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.actor_id',$1,true),set_config('app.tenant_id',$2,true)", [actor, company]);
      const result = await client.query<T>(sql, values);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  beforeAll(async () => {
    await owner.query('INSERT INTO "Company"(id,name,type,status) VALUES ($1,\'Review SCO\',\'SCO\',\'ACTIVE\'),($2,\'Review Partner\',\'PARTNER\',\'ACTIVE\'),($3,\'Other Partner\',\'PARTNER\',\'ACTIVE\')', [scoCompany, partnerCompany, otherCompany]);
    await owner.query('INSERT INTO "User"(id,email,"passwordHash",status) VALUES ($1,$2,\'test\',\'ACTIVE\'),($3,$4,\'test\',\'ACTIVE\'),($5,$6,\'test\',\'ACTIVE\')', [scoUser, `${scoUser}@review.test`, partnerUser, `${partnerUser}@review.test`, otherUser, `${otherUser}@review.test`]);
    await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES ($1,$2,\'review-manager\',\'Review Manager\'),($3,$4,\'review-partner\',\'Review Partner\')', [scoRole, scoCompany, partnerRole, partnerCompany]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES ($1,$2,$3,\'ACTIVE\'),($4,$5,$6,\'ACTIVE\'),($7,$8,$9,\'ACTIVE\')', [id(), scoUser, scoCompany, id(), partnerUser, partnerCompany, id(), otherUser, otherCompany]);
    await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) SELECT $1,$2,id,$3 FROM "CompanyMembership" WHERE "userId"=$4 AND "companyId"=$2', [id(), scoCompany, scoRole, scoUser]);
    await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) SELECT $1,$2,id,$3 FROM "CompanyMembership" WHERE "userId"=$4 AND "companyId"=$2', [id(), partnerCompany, partnerRole, partnerUser]);
    await grant(scoRole, scoCompany, 'qualification.manage');
    await grant(scoRole, scoCompany, 'sco.internal.manage');
    await grant(partnerRole, partnerCompany, 'partner.admission.read');
    await grant(partnerRole, partnerCompany, 'partner.qualification.write');

    const created = await internal.query<{ id: string }>('SELECT id FROM public.internal_qualification_create_for_company($1,$2,$3,$4)', [scoUser, partnerCompany, 'Review Partner Ltd', 'review@partner.test']);
    qualificationId = created.rows[0].id;
    await tenantCall(partnerUser, partnerCompany, 'SELECT public.partner_qualification_draft_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [partnerUser, partnerCompany, 'Review Partner Ltd', 'CR-1', 'Owner', 'review@partner.test', 'Riyadh', 'HVAC_REFRIGERATION', 'VERIFY_QUOTE_CHECK', 'SMALL', 'MONTHLY', id()]);
    await tenantCall(partnerUser, partnerCompany, 'SELECT public.partner_qualification_submit($1,$2,$3)', [partnerUser, partnerCompany, id()]);
  });

  afterAll(async () => {
    await owner.query('DELETE FROM audit_logs WHERE actor_user_id IN ($1,$2,$3) OR company_id IN ($4,$5,$6)', [scoUser, partnerUser, otherUser, scoCompany, partnerCompany, otherCompany]);
    await owner.query('DELETE FROM qualification_application_events WHERE qualification_application_id=$1', [qualificationId]);
    await owner.query('DELETE FROM qualification_applications WHERE id=$1', [qualificationId]);
    await owner.query('DELETE FROM "MembershipRole" WHERE company_id IN ($1,$2)', [scoCompany, partnerCompany]);
    await owner.query('DELETE FROM "RolePermission" WHERE role_id IN ($1,$2)', [scoRole, partnerRole]);
    await owner.query('DELETE FROM "CompanyMembership" WHERE "userId" IN ($1,$2,$3)', [scoUser, partnerUser, otherUser]);
    await owner.query('DELETE FROM "Role" WHERE id IN ($1,$2)', [scoRole, partnerRole]);
    await owner.query('DELETE FROM "User" WHERE id IN ($1,$2,$3)', [scoUser, partnerUser, otherUser]);
    await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2,$3)', [scoCompany, partnerCompany, otherCompany]);
    await owner.end(); await runtime.end(); await internal.end();
  });

  it('moves submitted qualification through review and exposes only the action-required reason to the partner', async () => {
    await expect(internal.query('SELECT * FROM public.internal_qualification_decide($1,$2,$3,$4)', [scoUser, qualificationId, 'UNDER_REVIEW', 'Review started'])).rejects.toThrow();
    const started = await internal.query('SELECT * FROM public.internal_qualification_transition($1,$2,$3,$4,$5)', [scoUser, qualificationId, 'UNDER_REVIEW', 'Review started', id()]);
    expect(started.rows[0]).toMatchObject({ id: qualificationId, status: 'UNDER_REVIEW' });
    const requested = await internal.query('SELECT * FROM public.internal_qualification_transition($1,$2,$3,$4,$5)', [scoUser, qualificationId, 'ACTION_REQUIRED', 'Please confirm project frequency', id()]);
    expect(requested.rows[0]).toMatchObject({ id: qualificationId, status: 'ACTION_REQUIRED' });
    const current = await tenantCall<{ status: string; review_state: string; action_required: boolean; action_required_reason: string | null }>(partnerUser, partnerCompany, 'SELECT * FROM public.partner_qualification_current($1,$2)', [partnerUser, partnerCompany]);
    expect(current.rows[0]).toMatchObject({ status: 'ACTION_REQUIRED', review_state: 'ACTION_REQUIRED', action_required: true, action_required_reason: 'Please confirm project frequency' });
    expect(current.rows[0]).not.toHaveProperty('reviewed_by');
  });

  it('allows correction/resubmit, idempotent approval, and blocks a foreign tenant', async () => {
    await tenantCall(partnerUser, partnerCompany, 'SELECT public.partner_qualification_draft_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [partnerUser, partnerCompany, 'Review Partner Ltd', 'CR-1', 'Owner', 'review@partner.test', 'Riyadh', 'HVAC_REFRIGERATION', 'BOTH', 'SMALL', 'MONTHLY', id()]);
    await tenantCall(partnerUser, partnerCompany, 'SELECT public.partner_qualification_submit($1,$2,$3)', [partnerUser, partnerCompany, id()]);
    const approved = await internal.query('SELECT * FROM public.internal_qualification_transition($1,$2,$3,$4,$5)', [scoUser, qualificationId, 'APPROVED', 'Evidence checked', id()]);
    expect(approved.rows[0]).toMatchObject({ id: qualificationId, status: 'APPROVED' });
    const retry = await internal.query('SELECT * FROM public.internal_qualification_transition($1,$2,$3,$4,$5)', [scoUser, qualificationId, 'APPROVED', 'Evidence checked', id()]);
    expect(retry.rows[0]).toMatchObject({ id: qualificationId, status: 'APPROVED' });
    await expect(tenantCall(otherUser, otherCompany, 'SELECT * FROM public.partner_qualification_current($1,$2)', [otherUser, partnerCompany])).rejects.toThrow();
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_logs WHERE entity_type='QualificationApplication' AND entity_id=$1 AND action IN ('qualification.review_started','qualification.action_required','qualification.approved')", [qualificationId]);
    expect(audit.rows[0].count).toBeGreaterThanOrEqual(3);
  });
});
