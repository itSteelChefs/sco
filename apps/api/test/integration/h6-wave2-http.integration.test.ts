import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client, Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import argon2 from 'argon2';
import { AppModule } from '../../src/app.module.js';
import { ApiValidationPipe } from '../../src/common/http/validation-pipe.js';
import { PartnershipReasonDto } from '../../src/modules/identity/partner-admission.dto.js';
import { QualificationController } from '../../src/modules/identity/qualification.controller.js';

const id = () => randomUUID();
const password = randomBytes(32).toString('base64url');

describe('H6 Wave 2 internal partnership HTTP contract', () => {
  let app: NestFastifyApplication;
  let owner: Client;
  let runtime: Pool;
  let internal: Client;
  let scoCompany: string;
  let partnerCompany: string;
  let supplierCompany: string;
  let manager: string;
  let unauthorized: string;
  let partnerUser: string;
  let partnershipId: string;
  let supplierPartnershipId: string;
  let qualificationId: string;
  let managerRole: string;
  let unauthorizedRole: string;
  let partnerRole: string;
  let managerMembership: string;
  let unauthorizedMembership: string;
  let partnerMembership: string;

  async function grant(roleId: string, companyId: string, code: string) {
    await owner.query(
      `INSERT INTO "RolePermission"(id,company_id,role_id,permission_id)
       SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4 ON CONFLICT DO NOTHING`,
      [id(), companyId, roleId, code],
    );
  }

  async function withRuntime<T>(actor: string, company: string, callback: (client: PoolClient) => Promise<T>) {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.actor_id',$1,true),set_config('app.tenant_id',$2,true)", [actor, company]);
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

  async function login(userId: string) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${userId}@h6-wave2.test`, password } });
    expect(response.statusCode).toBe(201);
    const cookie = response.headers['set-cookie'];
    return Array.isArray(cookie) ? cookie[0] : cookie as string;
  }

  async function call(method: 'GET' | 'POST', url: string, cookie?: string, payload?: unknown) {
    return app.inject({ method, url, headers: cookie ? { cookie } : {}, payload });
  }

  beforeAll(async () => {
    Reflect.defineMetadata('design:paramtypes', [Object, String, PartnershipReasonDto], QualificationController.prototype, 'approve');
    owner = new Client({ connectionString: process.env.DATABASE_URL });
    await owner.connect();
    runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
    internal = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
    await internal.connect();

    scoCompany = id(); partnerCompany = id(); supplierCompany = id();
    manager = id(); unauthorized = id(); partnerUser = id();
    managerRole = id();
    unauthorizedRole = id();
    partnerRole = id();
    qualificationId = id(); partnershipId = id(); supplierPartnershipId = id();
    managerMembership = id(); unauthorizedMembership = id(); partnerMembership = id();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    await owner.query(
      `INSERT INTO "Company"(id,name,type,status) VALUES
       ($1,'H6 Wave 2 SCO','SCO','ACTIVE'),($2,'H6 Wave 2 Partner','PARTNER','ACTIVE'),($3,'H6 Wave 2 Supplier','SUPPLIER','ACTIVE')`,
      [scoCompany, partnerCompany, supplierCompany],
    );
    await owner.query(
      `INSERT INTO "User"(id,email,"passwordHash",status) VALUES
       ($1,$2,$3,'ACTIVE'),($4,$5,$3,'ACTIVE'),($6,$7,$3,'ACTIVE')`,
      [manager, `${manager}@h6-wave2.test`, passwordHash, unauthorized, `${unauthorized}@h6-wave2.test`, partnerUser, `${partnerUser}@h6-wave2.test`],
    );
    await owner.query(
      `INSERT INTO "Role"(id,company_id,code,name) VALUES
       ($1,$2,'h6-wave2-manager','H6 Wave 2 Manager'),($3,$4,'h6-wave2-unauthorized','H6 Wave 2 Unauthorized'),($5,$6,'h6-wave2-partner','H6 Wave 2 Partner')`,
      [managerRole, scoCompany, unauthorizedRole, scoCompany, partnerRole, partnerCompany],
    );
    await owner.query(
      `INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES
       ($1,$2,$3,'ACTIVE'),($4,$5,$3,'ACTIVE'),($6,$7,$8,'ACTIVE')`,
      [managerMembership, manager, scoCompany, unauthorizedMembership, unauthorized, partnerMembership, partnerUser, partnerCompany],
    );
    await owner.query(
      `INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES
       ($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12)`,
      [id(), scoCompany, managerMembership, managerRole, id(), scoCompany, unauthorizedMembership, unauthorizedRole, id(), partnerCompany, partnerMembership, partnerRole],
    );
    for (const code of ['sco.internal.manage', 'partnership.manage', 'agreement.policy.manage']) await grant(managerRole, scoCompany, code);
    await grant(partnerRole, partnerCompany, 'partner.agreement.accept');
    await grant(partnerRole, partnerCompany, 'partner.portal.read');

    await owner.query(
      `INSERT INTO qualification_applications(id,company_id,legal_name,contact_email,status)
       VALUES ($1,$2,'H6 Wave 2 Partner','wave2-private@test.invalid','APPROVED')`,
      [qualificationId, partnerCompany],
    );
    await owner.query(
      `INSERT INTO company_partnerships(id,company_id,type,status,qualification_application_id,created_at,updated_at)
       VALUES ($1,$2,'BUYER_PARTNERSHIP','UNDER_REVIEW',$3,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
              ($4,$5,'SUPPLIER_PARTNERSHIP','UNDER_REVIEW',NULL,'2026-01-02T00:00:00Z','2026-01-02T00:00:00Z')`,
      [partnershipId, partnerCompany, qualificationId, supplierPartnershipId, supplierCompany],
    );
    const policy = await internal.query(
      `SELECT * FROM public.internal_partner_agreement_policy_create(
        $1,'BINDING_CONFIDENTIALITY','wave2-v1','wave2 agreement content',
        '2025-01-01T00:00:00Z','partner.agreement.accept',true,
        'REQUIRE_REACCEPTANCE','BLOCK_OPERATIONAL_ACCESS','H6_WAVE_2',true,$2)`,
      [manager, id()],
    );
    await internal.query('SELECT * FROM public.internal_partner_agreement_policy_publish($1,$2,$3)', [manager, policy.rows[0].id, id()]);
    await withRuntime(partnerUser, partnerCompany, (client) => client.query(
      'SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)',
      ['BINDING_CONFIDENTIALITY', 'wave2-v1', `wave2-${id()}`, id()],
    ));

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ApiValidationPipe());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  async function cleanup() {
    const partnerships = [partnershipId, supplierPartnershipId].filter(Boolean);
    const qualifications = [qualificationId].filter(Boolean);
    const companies = [scoCompany, partnerCompany, supplierCompany].filter(Boolean);
    const users = [manager, unauthorized, partnerUser].filter(Boolean);
    const memberships = [managerMembership, unauthorizedMembership, partnerMembership].filter(Boolean);
    const roles = [managerRole, unauthorizedRole, partnerRole].filter(Boolean);
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
    await app?.close();
    await internal?.end();
    await runtime?.end();
    await cleanup();
    await owner?.end();
  });

  it('denies unauthenticated and unauthorized internal callers', async () => {
    expect((await call('GET', '/api/v1/internal/network/partnerships')).statusCode).toBe(401);
    expect((await call('GET', '/api/v1/internal/network/partnerships', await login(unauthorized))).statusCode).toBe(403);
  });

  it('uses the authenticated actor and exposes only the certified projection', async () => {
    const cookie = await login(manager);
    const queue = await call('GET', '/api/v1/internal/network/partnerships', cookie);
    expect(queue.statusCode).toBe(200);
    const rows = JSON.parse(queue.body) as Array<Record<string, unknown>>;
    const ownRows = rows.filter((row) => row.partnershipId === partnershipId);
    expect(ownRows).toHaveLength(1);
    expect(ownRows[0]).toMatchObject({ partnershipId, partnershipType: 'BUYER_PARTNERSHIP', nextInternalAction: 'APPROVE', actionReady: true });
    expect(JSON.stringify(rows)).not.toMatch(/wave2 agreement content|wave2-private@test.invalid|workspace|entitlement/i);
    const detail = await call('GET', `/api/v1/internal/network/partnerships/${partnershipId}/readiness`, cookie);
    expect(detail.statusCode).toBe(200);
    expect(Object.keys(JSON.parse(detail.body)).sort()).toEqual([
      'actionReady', 'activePortalMembershipReady', 'blockers', 'companyActive', 'companyDisplayName',
      'companyId', 'companyStatus', 'createdAt', 'nextInternalAction', 'partnerPortalReadReady',
      'partnershipId', 'partnershipStatus', 'partnershipType', 'qualificationReady', 'qualificationStatus',
      'requiredAgreementsSatisfied', 'updatedAt',
    ]);
    const supplier = await call('GET', `/api/v1/internal/network/partnerships/${supplierPartnershipId}/readiness`, cookie);
    expect(supplier.statusCode).toBe(404);
  });

  it('rejects caller-supplied authority identity at the HTTP boundary without side effects', async () => {
    const cookie = await login(manager);
    const before = await owner.query(
      `SELECT status, count(*) FILTER (WHERE action='partnership.approved' AND entity_id=$1)::int AS approval_audits
       FROM company_partnerships LEFT JOIN audit_logs ON audit_logs.entity_id=$1 WHERE company_partnerships.id=$1 GROUP BY status`,
      [partnershipId],
    );
    const substituted = await call('POST', `/api/v1/internal/network/partnerships/${partnershipId}/approve`, cookie, { reason: 'actor substitution probe', actorId: unauthorized });
    expect(substituted.statusCode).toBe(400);
    expect(JSON.parse(substituted.body)).toEqual({ error: { code: 'VALIDATION_FAILED' } });
    const after = await owner.query(
      `SELECT status, count(*) FILTER (WHERE action='partnership.approved' AND entity_id=$1)::int AS approval_audits
       FROM company_partnerships LEFT JOIN audit_logs ON audit_logs.entity_id=$1 WHERE company_partnerships.id=$1 GROUP BY status`,
      [partnershipId],
    );
    expect(after.rows).toEqual(before.rows);
    expect((await owner.query('SELECT count(*)::int AS count FROM audit_logs WHERE action=\'partnership.approved\' AND entity_id=$1 AND actor_user_id=$2', [partnershipId, unauthorized])).rows[0].count).toBe(0);
  });

  it('attributes valid approval to the authenticated manager, not caller input', async () => {
    const cookie = await login(manager);
    const approved = await call('POST', `/api/v1/internal/network/partnerships/${partnershipId}/approve`, cookie, { reason: 'authenticated manager approval' });
    expect(approved.statusCode).toBe(201);
    expect(JSON.parse(approved.body)).toMatchObject({ id: partnershipId, status: 'APPROVED' });
    expect((await owner.query('SELECT actor_user_id FROM audit_logs WHERE action=\'partnership.approved\' AND entity_id=$1 ORDER BY created_at DESC LIMIT 1', [partnershipId])).rows[0].actor_user_id).toBe(manager);
    await owner.query(`UPDATE company_partnerships SET status='UNDER_REVIEW', approved_by=NULL, approved_at=NULL, decision_reason=NULL WHERE id=$1`, [partnershipId]);
    expect((await call('POST', `/api/v1/internal/network/partnerships/${partnershipId}/approve`, cookie, {})).statusCode).toBe(400);
  });

  it('approves without automatically activating, then activates explicitly', async () => {
    const cookie = await login(manager);
    const approved = await call('POST', `/api/v1/internal/network/partnerships/${partnershipId}/approve`, cookie, { reason: 'Wave 2 explicit approval' });
    expect(approved.statusCode).toBe(201);
    expect(JSON.parse(approved.body)).toMatchObject({ id: partnershipId, status: 'APPROVED' });
    expect((await owner.query('SELECT status FROM company_partnerships WHERE id=$1', [partnershipId])).rows[0].status).toBe('APPROVED');
    const activated = await call('POST', `/api/v1/internal/network/partnerships/${partnershipId}/activate`, cookie);
    expect(activated.statusCode).toBe(201);
    expect(JSON.parse(activated.body)).toMatchObject({ id: partnershipId, status: 'ACTIVE' });
  });

  it('supports SUSPENDED reactivation through the same ACTIVATE contract', async () => {
    await owner.query(`UPDATE company_partnerships SET status='SUSPENDED' WHERE id=$1`, [partnershipId]);
    const cookie = await login(manager);
    const detail = await call('GET', `/api/v1/internal/network/partnerships/${partnershipId}/readiness`, cookie);
    expect(JSON.parse(detail.body)).toMatchObject({ partnershipStatus: 'SUSPENDED', nextInternalAction: 'ACTIVATE', actionReady: true });
    const response = await call('POST', `/api/v1/internal/network/partnerships/${partnershipId}/activate`, cookie);
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toMatchObject({ id: partnershipId, status: 'ACTIVE' });
  });

  it('does not use stale GET readiness to authorize a later POST', async () => {
    await owner.query(`UPDATE company_partnerships SET status='UNDER_REVIEW' WHERE id=$1`, [partnershipId]);
    await owner.query(`UPDATE qualification_applications SET status='APPROVED' WHERE id=$1`, [qualificationId]);
    const cookie = await login(manager);
    expect((await call('GET', `/api/v1/internal/network/partnerships/${partnershipId}/readiness`, cookie)).statusCode).toBe(200);
    await owner.query(`UPDATE qualification_applications SET status='REJECTED' WHERE id=$1`, [qualificationId]);
    const response = await call('POST', `/api/v1/internal/network/partnerships/${partnershipId}/approve`, cookie, { reason: 'stale state attempt' });
    expect(response.statusCode).toBe(409);
    await owner.query(`UPDATE qualification_applications SET status='APPROVED' WHERE id=$1`, [qualificationId]);
  });
});
