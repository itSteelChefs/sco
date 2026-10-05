import { createHash, randomUUID } from 'node:crypto';
import type { Client, Pool } from 'pg';

export async function establishClassDPartnerEligibility(
  owner: Pool | Client,
  actorUserId: string,
  companyId: string,
): Promise<void> {
  const membership = await owner.query<{ id: string }>(
    `SELECT id FROM "CompanyMembership"
     WHERE "userId" = $1 AND "companyId" = $2 AND status = 'ACTIVE'`,
    [actorUserId, companyId],
  );
  const membershipId = membership.rows[0]?.id;
  if (!membershipId) throw new Error('CLASS_D_FIXTURE_ACTIVE_MEMBERSHIP_REQUIRED');

  const roleId = randomUUID();
  await owner.query(
    `INSERT INTO "Role"(id, company_id, code, name)
     VALUES ($1, $2, $3, 'Class D test portal access')`,
    [roleId, companyId, `class-d-test-${roleId}`],
  );
  await owner.query(
    `INSERT INTO "MembershipRole"(id, company_id, membership_id, role_id)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), companyId, membershipId, roleId],
  );
  await owner.query(
    `INSERT INTO "RolePermission"(id, company_id, role_id, permission_id)
     SELECT $1, $2, $3, id FROM "Permission" WHERE code = 'partner.portal.read'`,
    [randomUUID(), companyId, roleId],
  );
  await owner.query(
    `INSERT INTO company_partnerships(company_id, type, status)
     VALUES ($1, 'BUYER_PARTNERSHIP', 'ACTIVE')
     ON CONFLICT (company_id, type) WHERE status IN ('UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED')
     DO UPDATE SET status = 'ACTIVE', active_from = COALESCE(company_partnerships.active_from, clock_timestamp())`,
    [companyId],
  );

  const policyId = randomUUID();
  const versionCode = `test-${policyId}`;
  const content = `Class D test confidentiality ${policyId}`;
  const contentSha256 = createHash('sha256').update(content, 'utf8').digest('hex');
  await owner.query(
    `INSERT INTO partner_agreement_policy_versions(
       id, agreement_type, version_code, content_text, content_sha256, required, effective_at,
       acceptance_permission_code, reacceptance_required, suspension_effect, termination_effect,
       retention_classification, state, created_by
     ) VALUES (
       $1, 'BINDING_CONFIDENTIALITY', $2, $3, $4, true,
       TIMESTAMPTZ '2000-01-01 00:00:00+00' + (random() * interval '1 day'),
       'partner.agreement.accept', false, 'NO_ACCESS_CHANGE', 'NO_ACCESS_CHANGE',
       'TEST_CLASS_D', 'PUBLISHED', $5
     )`,
    [policyId, versionCode, content, contentSha256, actorUserId],
  );
  const acceptanceId = randomUUID();
  await owner.query(
    `INSERT INTO partner_agreement_acceptances(
       id, company_id, actor_user_id, membership_id, policy_version_id, agreement_type, version_code,
       accepted_content_sha256, authority_permission_code, authority_basis, purpose_code,
       idempotency_key, request_fingerprint, correlation_id
     ) VALUES (
       $1, $2, $3, $4, $5, 'BINDING_CONFIDENTIALITY', $6,
       $7, 'partner.agreement.accept', '{}'::jsonb, 'PUR-02',
       $8, $9, $10
     )`,
    [acceptanceId, companyId, actorUserId, membershipId, policyId, versionCode, contentSha256, `fixture-${acceptanceId}`, createHash('sha256').update(acceptanceId).digest('hex'), randomUUID()],
  );
  await owner.query(
    `INSERT INTO partner_agreement_acceptance_events(acceptance_id, company_id, status, actor_user_id, correlation_id)
     VALUES ($1, $2, 'ACCEPTED', $3, $4)`,
    [acceptanceId, companyId, actorUserId, randomUUID()],
  );
}
