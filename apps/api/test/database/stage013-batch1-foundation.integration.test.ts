import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const id = () => randomUUID();

async function withRuntime<T>(actor: string | null, company: string | null, callback: (client: PoolClient) => Promise<T>) {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    if (actor !== null) await client.query("SELECT set_config('app.actor_id', $1, true)", [actor]);
    if (company !== null) await client.query("SELECT set_config('app.tenant_id', $1, true)", [company]);
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

describe('Stage 013 Batch 1 Collaboration and Participation foundation', () => {
  const companyA = id();
  const companyB = id();
  const sco = id();
  const manager = id();
  const target = id();
  const foreignTarget = id();
  const managerMembership = id();
  const targetMembership = id();
  const foreignMembership = id();
  const managerRole = id();
  const targetRole = id();
  const foreignRole = id();
  const workspaceA = id();
  const workspaceB = id();
  const projectA = id();
  const unlinkedProjectA = id();
  const projectB = id();
  const policy = id();
  const policyVersion = `s13-v1-${policy}`;
  let collaborationId: string;
  let participationId: string;
  let executionId: string;
  let bindingId: string;

  async function cleanupOwnedFixtures() {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      // This is a disposable-test-owner transaction. History immutability is
      // intentionally retained in production; the replica setting only lets
      // this suite remove its exact, in-memory-owned history rows during
      // teardown so a second suite invocation starts without residue.
      await client.query("SET LOCAL session_replication_role = 'replica'");
      await client.query('DELETE FROM partner_participant_execution_binding_events WHERE company_id = ANY($1::uuid[])', [[companyA, companyB, sco]]);
      await client.query('DELETE FROM partner_collaboration_execution_events WHERE company_id = ANY($1::uuid[])', [[companyA, companyB, sco]]);
      await client.query('DELETE FROM partner_participant_execution_bindings WHERE company_id = ANY($1::uuid[])', [[companyA, companyB, sco]]);
      await client.query('DELETE FROM partner_collaboration_executions WHERE company_id = ANY($1::uuid[])', [[companyA, companyB, sco]]);
      await client.query('DELETE FROM partner_collaboration_participation_events WHERE company_id = ANY($1::uuid[])', [[companyA, companyB, sco]]);
      await client.query('DELETE FROM partner_collaboration_events WHERE company_id = ANY($1::uuid[])', [[companyA, companyB, sco]]);
      await client.query('DELETE FROM partner_collaboration_participations WHERE company_id = ANY($1::uuid[])', [[companyA, companyB, sco]]);
      await client.query('DELETE FROM partner_collaborations WHERE company_id = ANY($1::uuid[])', [[companyA, companyB, sco]]);
      await client.query('DELETE FROM partner_workspace_project_links WHERE company_id = ANY($1::uuid[])', [[companyA, companyB, sco]]);
      await client.query('DELETE FROM projects WHERE company_id = ANY($1::uuid[])', [[companyA, companyB, sco]]);
      await client.query('DELETE FROM partner_workspaces WHERE company_id = ANY($1::uuid[])', [[companyA, companyB, sco]]);
      await client.query('DELETE FROM partner_agreement_acceptance_events WHERE acceptance_id IN (SELECT id FROM partner_agreement_acceptances WHERE policy_version_id = $1)', [policy]);
      await client.query('DELETE FROM partner_agreement_acceptances WHERE policy_version_id = $1', [policy]);
      await client.query('DELETE FROM partner_agreement_policy_events WHERE policy_version_id = $1', [policy]);
      await client.query('DELETE FROM partner_agreement_policy_versions WHERE id = $1', [policy]);
      await client.query('DELETE FROM company_partnerships WHERE company_id = ANY($1::uuid[])', [[companyA, companyB, sco]]);
      await client.query('DELETE FROM audit_logs WHERE company_id = ANY($1::uuid[]) OR actor_user_id = ANY($2::uuid[])', [[companyA, companyB, sco], [manager, target, foreignTarget]]);
      await client.query('DELETE FROM "RolePermission" WHERE role_id = ANY($1::uuid[])', [[managerRole, targetRole, foreignRole]]);
      await client.query('DELETE FROM "MembershipRole" WHERE membership_id = ANY($1::uuid[])', [[managerMembership, targetMembership, foreignMembership]]);
      await client.query('DELETE FROM "CompanyMembership" WHERE id = ANY($1::uuid[])', [[managerMembership, targetMembership, foreignMembership]]);
      await client.query('DELETE FROM "Role" WHERE id = ANY($1::uuid[])', [[managerRole, targetRole, foreignRole]]);
      await client.query('DELETE FROM "User" WHERE id = ANY($1::uuid[])', [[manager, target, foreignTarget]]);
      await client.query('DELETE FROM "Company" WHERE id = ANY($1::uuid[])', [[companyA, companyB, sco]]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function grant(roleId: string, companyId: string, permission: string) {
    await owner.query(
      'INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4',
      [id(), companyId, roleId, permission],
    );
  }

  beforeAll(async () => {
    await owner.query(
      `INSERT INTO "Company"(id,name,type,status) VALUES
       ($1,'Stage 013 Partner A','PARTNER','ACTIVE'),
       ($2,'Stage 013 Partner B','PARTNER','ACTIVE'),
       ($3,'Stage 013 SCO','SCO','ACTIVE')`,
      [companyA, companyB, sco],
    );
    await owner.query(
      `INSERT INTO "User"(id,email,"passwordHash",status) VALUES
       ($1,$2,'x','ACTIVE'),($3,$4,'x','ACTIVE'),($5,$6,'x','ACTIVE')`,
      [manager, `${manager}@s13.test`, target, `${target}@s13.test`, foreignTarget, `${foreignTarget}@s13.test`],
    );
    await owner.query(
      `INSERT INTO "Role"(id,company_id,code,name) VALUES
       ($1,$2,'s13-manager','S13 Manager'),($3,$4,'s13-target','S13 Target'),($5,$6,'s13-foreign','S13 Foreign')`,
      [managerRole, companyA, targetRole, companyA, foreignRole, companyB],
    );
    await owner.query(
      `INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES
       ($1,$2,$3,'ACTIVE'),($4,$5,$6,'ACTIVE'),($7,$8,$9,'ACTIVE')`,
      [managerMembership, manager, companyA, targetMembership, target, companyA, foreignMembership, foreignTarget, companyB],
    );
    await owner.query(
      `INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES
       ($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12)`,
      [id(), companyA, managerMembership, managerRole, id(), companyA, targetMembership, targetRole, id(), companyB, foreignMembership, foreignRole],
    );
    for (const permission of ['partner.portal.read', 'partner.collaboration.read', 'partner.collaboration.create', 'partner.collaboration.manage', 'partner.collaboration.participation.manage', 'partner.collaboration.participate']) await grant(managerRole, companyA, permission);
    for (const permission of ['partner.portal.read', 'partner.collaboration.read', 'partner.collaboration.participate']) await grant(targetRole, companyA, permission);
    await grant(foreignRole, companyB, 'partner.collaboration.read');

    await owner.query(
      `INSERT INTO company_partnerships(id,company_id,type,status)
       VALUES ($1,$2,'BUYER_PARTNERSHIP','ACTIVE')`,
      [id(), companyA],
    );
    // Keep this fixture before the H5/H6 effective-policy window. The suite
    // owns a unique UUID namespace, while production policy ordering remains
    // unchanged and later suites can safely create their current policies.
    await owner.query(
      `INSERT INTO partner_agreement_policy_versions
       (id,agreement_type,version_code,content_text,content_sha256,required,effective_at,acceptance_permission_code,reacceptance_required,suspension_effect,termination_effect,retention_classification,state,created_by)
       VALUES ($1,'BINDING_CONFIDENTIALITY',$3,'s13',$4,true,'2000-01-01T00:00:00Z','partner.agreement.accept',false,'NO_ACCESS_CHANGE','NO_ACCESS_CHANGE','S13','PUBLISHED',$2)`,
      [policy, manager, policyVersion, '0'.repeat(64)],
    );
    await owner.query(
      `INSERT INTO partner_agreement_acceptances
       (company_id,actor_user_id,membership_id,policy_version_id,agreement_type,version_code,accepted_content_sha256,authority_permission_code,authority_basis,purpose_code,idempotency_key,request_fingerprint,correlation_id)
       VALUES ($1,$2,$3,$4,'BINDING_CONFIDENTIALITY',$5,$6,'partner.agreement.accept','{}'::jsonb,'PUR-02',$7,$8,$9)`,
      [companyA, manager, managerMembership, policy, policyVersion, '0'.repeat(64), `s13-${id()}`, '1'.repeat(64), id()],
    );
    await owner.query(
      `INSERT INTO partner_agreement_acceptance_events(id,acceptance_id,company_id,status,actor_user_id,correlation_id)
       SELECT $1,id,company_id,'ACCEPTED',$2,$3 FROM partner_agreement_acceptances WHERE company_id=$4`,
      [id(), manager, id(), companyA],
    );

    await owner.query(
      `INSERT INTO partner_workspaces(id,company_id,display_name,created_by) VALUES ($1,$2,'S13 Workspace A',$3),($4,$5,'S13 Workspace B',$6)`,
      [workspaceA, companyA, manager, workspaceB, companyB, foreignTarget],
    );
    await owner.query(
      `INSERT INTO projects(id,company_id,code,name,created_by) VALUES
       ($1,$2,'S13-A','S13 A',$3),($4,$5,'S13-UNLINKED','S13 Unlinked',$3),($6,$7,'S13-B','S13 B',$8)`,
      [projectA, companyA, manager, unlinkedProjectA, companyA, projectB, companyB, foreignTarget],
    );
    await owner.query(
      `INSERT INTO partner_workspace_project_links(id,company_id,workspace_id,project_id,created_by)
       VALUES ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)`,
      [id(), companyA, workspaceA, projectA, manager, id(), companyB, workspaceB, projectB, foreignTarget],
    );
  });

  afterAll(async () => {
    try {
      await cleanupOwnedFixtures();
    } finally {
      await Promise.all([owner.end(), runtime.end()]);
    }
  });

  it('creates, lists and reads only active same-tenant Collaborations', async () => {
    const created = await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_create($1,$2,$3)', [workspaceA, projectA, id()],
    ));
    collaborationId = created.rows[0].id;
    expect(created.rows[0]).toMatchObject({ company_id: companyA, workspace_id: workspaceA, project_id: projectA, state: 'ACTIVE' });
    expect((await withRuntime(manager, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_list()'))).rows).toHaveLength(1);
    expect((await withRuntime(manager, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_read($1)', [collaborationId]))).rows).toHaveLength(1);
    await expect(withRuntime(manager, companyB, (client) => client.query('SELECT * FROM public.partner_collaboration_read($1)', [collaborationId]))).rejects.toThrow(/COLLABORATION_(CONTEXT_|)FORBIDDEN/);
    await expect(withRuntime(manager, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_read($1)', [id()]))).rejects.toThrow('COLLABORATION_FORBIDDEN');
  });

  it('requires an ACTIVE acting User independently of active membership', async () => {
    await owner.query('UPDATE "User" SET status=\'DISABLED\' WHERE id=$1', [manager]);
    await expect(withRuntime(manager, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_list()'))).rejects.toThrow('COLLABORATION_CONTEXT_FORBIDDEN');
    await owner.query('UPDATE "User" SET status=\'ACTIVE\' WHERE id=$1', [manager]);
    await expect(withRuntime(id(), companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_list()'))).rejects.toThrow('COLLABORATION_CONTEXT_FORBIDDEN');
    await expect(withRuntime(foreignTarget, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_list()'))).rejects.toThrow('COLLABORATION_CONTEXT_FORBIDDEN');
  });

  it('requires partner.portal.read in addition to the operation permission', async () => {
    await owner.query(
      `DELETE FROM "RolePermission" rp USING "Permission" p
       WHERE rp.permission_id=p.id AND rp.role_id=$1 AND p.code='partner.portal.read'`,
      [managerRole],
    );
    await expect(withRuntime(manager, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_list()'))).rejects.toThrow('COLLABORATION_PERMISSION_FORBIDDEN');
    await grant(managerRole, companyA, 'partner.portal.read');
    await owner.query(
      `DELETE FROM "RolePermission" rp USING "Permission" p
       WHERE rp.permission_id=p.id AND rp.role_id=$1 AND p.code='partner.collaboration.read'`,
      [managerRole],
    );
    await expect(withRuntime(manager, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_list()'))).rejects.toThrow('COLLABORATION_PERMISSION_FORBIDDEN');
    await grant(managerRole, companyA, 'partner.collaboration.read');
  });

  it('requires an explicit same-workspace project link', async () => {
    await expect(withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_create($1,$2,$3)', [workspaceA, unlinkedProjectA, id()],
    ))).rejects.toThrow('COLLABORATION_PROJECT_FORBIDDEN');
    await expect(withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_create($1,$2,$3)', [workspaceA, projectB, id()],
    ))).rejects.toThrow('COLLABORATION_PROJECT_FORBIDDEN');
  });

  it('grants only to an active same-company membership and join does not create authority', async () => {
    const granted = await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_participation_grant($1,$2,$3,$4)', [collaborationId, targetMembership, `grant-${id()}`, id()],
    ));
    participationId = granted.rows[0].id;
    expect(granted.rows[0]).toMatchObject({ collaboration_id: collaborationId, membership_id: targetMembership, state: 'ACTIVE' });
    const joined = await withRuntime(target, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_participation_join($1)', [participationId]));
    expect(joined.rows[0].id).toBe(participationId);
    await expect(withRuntime(target, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_participation_grant($1,$2,$3,$4)', [collaborationId, targetMembership, `grant-${id()}`, id()]))).rejects.toThrow('COLLABORATION_PERMISSION_FORBIDDEN');
    await expect(withRuntime(manager, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_participation_grant($1,$2,$3,$4)', [collaborationId, foreignMembership, `grant-${id()}`, id()]))).rejects.toThrow('PARTICIPATION_MEMBERSHIP_FORBIDDEN');
  });

  it('replays grants by scoped idempotency and rejects mismatched or concurrent replay', async () => {
    const key = `grant-${id()}`;
    const first = await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_participation_grant($1,$2,$3,$4)', [collaborationId, managerMembership, key, id()],
    ));
    const replay = await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_participation_grant($1,$2,$3,$4)', [collaborationId, managerMembership, key, id()],
    ));
    expect(replay.rows[0].id).toBe(first.rows[0].id);
    await expect(withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_participation_grant($1,$2,$3,$4)', [collaborationId, targetMembership, key, id()],
    ))).rejects.toThrow('PARTICIPATION_GRANT_IDEMPOTENCY_CONFLICT');
    const revoked = await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_participation_revoke($1,$2,$3)', [first.rows[0].id, 'replay test', id()],
    ));
    expect(revoked.rows[0].state).toBe('REVOKED');
    const revokedReplay = await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_participation_grant($1,$2,$3,$4)', [collaborationId, managerMembership, key, id()],
    ));
    expect(revokedReplay.rows[0]).toMatchObject({ id: first.rows[0].id, state: 'REVOKED' });
    const explicitRegrant = await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_participation_grant($1,$2,$3,$4)', [collaborationId, managerMembership, `grant-${id()}`, id()],
    ));
    expect(explicitRegrant.rows[0].id).not.toBe(first.rows[0].id);

    const concurrentCollaboration = (await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_create($1,$2,$3)', [workspaceA, projectA, id()],
    ))).rows[0].id;
    const concurrentKey = `grant-${id()}`;
    const concurrent = await Promise.all([
      withRuntime(manager, companyA, (client) => client.query(
        'SELECT * FROM public.partner_collaboration_participation_grant($1,$2,$3,$4)', [concurrentCollaboration, managerMembership, concurrentKey, id()],
      )),
      withRuntime(manager, companyA, (client) => client.query(
        'SELECT * FROM public.partner_collaboration_participation_grant($1,$2,$3,$4)', [concurrentCollaboration, managerMembership, concurrentKey, id()],
      )),
    ]);
    expect(new Set(concurrent.map((result) => result.rows[0].id)).size).toBe(1);
  });

  it('makes revoke terminal and regrant creates a new Participation ID', async () => {
    await withRuntime(manager, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_participation_revoke($1,$2,$3)', [participationId, 'test revoke', id()]));
    await expect(withRuntime(manager, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_participation_revoke($1,$2,$3)', [participationId, 'again', id()]))).rejects.toThrow('PARTICIPATION_FORBIDDEN');
    await expect(withRuntime(target, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_participation_join($1)', [participationId]))).rejects.toThrow('PARTICIPATION_FORBIDDEN');
    const regranted = await withRuntime(manager, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_participation_grant($1,$2,$3,$4)', [collaborationId, targetMembership, `grant-${id()}`, id()]));
    expect(regranted.rows[0].id).not.toBe(participationId);
  });

  it('ensures one open execution, binds the exact Participation instance, and invalidates on revoke', async () => {
    const executionCollaboration = (await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_create($1,$2,$3)', [workspaceA, projectA, id()],
    ))).rows[0].id;
    const executionParticipation = await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_participation_grant($1,$2,$3,$4)', [executionCollaboration, targetMembership, `grant-${id()}`, id()],
    ));
    const executionParticipationId = executionParticipation.rows[0].id;
    const ensured = await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.s13_collaboration_execution_ensure($1,$2)', [executionCollaboration, id()],
    ));
    executionId = ensured.rows[0].id;
    expect(ensured.rows[0].state).toBe('OPEN');
    const duplicate = await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.s13_collaboration_execution_ensure($1,$2)', [executionCollaboration, id()],
    ));
    expect(duplicate.rows[0].id).toBe(executionId);

    const bound = await withRuntime(target, companyA, (client) => client.query(
      'SELECT * FROM public.s13_participant_execution_binding_bind($1,$2,$3)', [executionId, executionParticipationId, id()],
    ));
    bindingId = bound.rows[0].id;
    const duplicateBinding = await withRuntime(target, companyA, (client) => client.query(
      'SELECT * FROM public.s13_participant_execution_binding_bind($1,$2,$3)', [executionId, executionParticipationId, id()],
    ));
    expect(duplicateBinding.rows[0].id).toBe(bindingId);
    await expect(withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.s13_participant_execution_binding_bind($1,$2,$3)', [executionId, executionParticipationId, id()],
    ))).rejects.toThrow('EXECUTION_BINDING_FORBIDDEN');
    const originalBinding = await withRuntime(target, companyA, (client) => client.query(
      'SELECT * FROM public.s13_participant_execution_binding_use($1)', [bindingId],
    ));
    expect(originalBinding.rows[0]).toMatchObject({ id: bindingId, participation_id: executionParticipationId, state: 'ACTIVE' });
    expect((await owner.query(
      'SELECT count(*)::int AS count FROM partner_participant_execution_bindings WHERE execution_id=$1 AND participation_id=$2',
      [executionId, executionParticipationId],
    )).rows[0].count).toBe(1);
    expect((await withRuntime(target, companyA, (client) => client.query(
      'SELECT * FROM public.s13_participant_execution_binding_use($1)', [bindingId],
    ))).rows[0].state).toBe('ACTIVE');

    await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_participation_revoke($1,$2,$3)', [executionParticipationId, 'execution revoke', id()],
    ));
    await expect(withRuntime(target, companyA, (client) => client.query(
      'SELECT * FROM public.s13_participant_execution_binding_use($1)', [bindingId],
    ))).rejects.toThrow('EXECUTION_BINDING_FORBIDDEN');
    await expect(withRuntime(manager, companyB, (client) => client.query(
      'SELECT * FROM public.s13_participant_execution_binding_use($1)', [bindingId],
    ))).rejects.toThrow('EXECUTION_BINDING_FORBIDDEN');
    const archiveParticipation = (await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_participation_grant($1,$2,$3,$4)', [executionCollaboration, managerMembership, `grant-${id()}`, id()],
    ))).rows[0].id;
    const archiveBinding = (await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.s13_participant_execution_binding_bind($1,$2,$3)', [executionId, archiveParticipation, id()],
    ))).rows[0].id;
    await withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.partner_collaboration_archive($1,$2)', [executionCollaboration, id()],
    ));
    await expect(withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.s13_participant_execution_binding_use($1)', [archiveBinding],
    ))).rejects.toThrow('EXECUTION_COLLABORATION_FORBIDDEN');
    await expect(withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.s13_collaboration_execution_ensure($1,$2)', [id(), id()],
    ))).rejects.toThrow('EXECUTION_COLLABORATION_FORBIDDEN');
    await expect(withRuntime(manager, companyA, (client) => client.query(
      'SELECT * FROM public.s13_collaboration_execution_ensure($1,$2)', [executionCollaboration, id()],
    ))).rejects.toThrow('EXECUTION_COLLABORATION_FORBIDDEN');

    const operationalEvents = await owner.query(
      `SELECT event_type, provenance, company_id, collaboration_id, execution_id
         FROM partner_collaboration_execution_events WHERE execution_id=$1
        UNION ALL
       SELECT event_type, provenance, company_id, collaboration_id, execution_id
         FROM partner_participant_execution_binding_events WHERE execution_id=$1
        ORDER BY event_type`,
      [executionId],
    );
    expect(operationalEvents.rows.some((row) => row.event_type === 'CREATED')).toBe(true);
    expect(operationalEvents.rows.some((row) => row.event_type === 'INVALIDATED')).toBe(true);

    await expect(owner.query(
      `INSERT INTO partner_collaboration_executions(company_id, collaboration_id, created_by)
       VALUES ($1,$2,$3)`,
      [companyB, executionCollaboration, manager],
    )).rejects.toThrow();
    await expect(owner.query(
      `INSERT INTO partner_participant_execution_bindings(company_id, collaboration_id, execution_id, participation_id)
       VALUES ($1,$2,$3,$4)`,
      [companyB, executionCollaboration, executionId, executionParticipationId],
    )).rejects.toThrow();
    await expect(owner.query(
      `INSERT INTO partner_participant_execution_bindings(company_id, collaboration_id, execution_id, participation_id)
       VALUES ($1,$2,$3,$4)`,
      [companyA, id(), executionId, executionParticipationId],
    )).rejects.toThrow();
    await expect(owner.query(
      `INSERT INTO partner_participant_execution_bindings(company_id, collaboration_id, execution_id, participation_id)
       VALUES ($1,$2,$3,$4)`,
      [companyA, executionCollaboration, executionId, id()],
    )).rejects.toThrow();
  });

  it('archives terminally and hides archived or inaccessible references behind generic denial', async () => {
    await withRuntime(manager, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_archive($1,$2)', [collaborationId, id()]));
    await expect(withRuntime(manager, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_read($1)', [collaborationId]))).rejects.toThrow('COLLABORATION_FORBIDDEN');
    await expect(withRuntime(manager, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_archive($1,$2)', [collaborationId, id()]))).rejects.toThrow('COLLABORATION_FORBIDDEN');
    await expect(withRuntime(target, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_participation_join($1)', [participationId]))).rejects.toThrow('PARTICIPATION_FORBIDDEN');
  });

  it('denies direct runtime table access and missing trusted context', async () => {
    await expect(runtime.query('SELECT * FROM partner_collaborations')).rejects.toThrow();
    await expect(runtime.query('SELECT * FROM partner_collaboration_executions')).rejects.toThrow();
    await expect(withRuntime(manager, null, (client) => client.query('SELECT * FROM public.partner_collaboration_list()'))).rejects.toThrow('COLLABORATION_CONTEXT_FORBIDDEN');
    await expect(withRuntime(null, companyA, (client) => client.query('SELECT * FROM public.partner_collaboration_list()'))).rejects.toThrow('COLLABORATION_CONTEXT_FORBIDDEN');
  });

  it('enforces FORCE RLS, least-privilege ownership, and immutable history', async () => {
    const tables = await owner.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='public' AND c.relname IN ('partner_collaborations','partner_collaboration_participations','partner_collaboration_events','partner_collaboration_participation_events','partner_collaboration_executions','partner_participant_execution_bindings','partner_collaboration_execution_events','partner_participant_execution_binding_events')
       ORDER BY c.relname`,
    );
    expect(tables.rows).toHaveLength(8);
    expect(tables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const role = await owner.query<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }>(
      `SELECT rolsuper, rolbypassrls, rolname FROM pg_roles WHERE rolname='sco_collaboration_gateway_owner'`,
    );
    expect(role.rows[0]).toMatchObject({ rolname: 'sco_collaboration_gateway_owner', rolsuper: false, rolbypassrls: false });
    expect(await owner.query(`SELECT has_table_privilege('sco_runtime','public.partner_collaborations','SELECT') AS allowed`)).toMatchObject({ rows: [{ allowed: false }] });
    expect(await owner.query(`SELECT has_function_privilege('public','public.partner_collaboration_list()','EXECUTE') AS allowed`)).toMatchObject({ rows: [{ allowed: false }] });

    await expect(owner.query(
      `UPDATE partner_collaboration_events SET event_type='ARCHIVED' WHERE collaboration_id=$1`,
      [collaborationId],
    )).rejects.toThrow('COLLABORATION_HISTORY_IMMUTABLE');
    await expect(owner.query(
      `UPDATE partner_collaboration_execution_events SET to_state='FAILED' WHERE execution_id=$1`,
      [executionId],
    )).rejects.toThrow('S13_EXECUTION_HISTORY_IMMUTABLE');
  });

  it('enforces event company/collaboration/participation tuple integrity', async () => {
    await expect(owner.query(
      `INSERT INTO partner_collaboration_events(company_id,collaboration_id,event_type,actor_user_id,correlation_id)
       VALUES ($1,$2,'CREATED',$3,$4)`,
      [companyB, collaborationId, manager, id()],
    )).rejects.toThrow('COLLABORATION_EVENT_TUPLE_FORBIDDEN');
    await expect(owner.query(
      `INSERT INTO partner_collaboration_participation_events(company_id,participation_id,collaboration_id,event_type,actor_user_id,correlation_id)
       VALUES ($1,$2,$3,'GRANTED',$4,$5)`,
      [companyA, participationId, id(), manager, id()],
    )).rejects.toThrow('PARTICIPATION_EVENT_TUPLE_FORBIDDEN');
    await expect(owner.query(
      `INSERT INTO partner_collaboration_participation_events(company_id,participation_id,collaboration_id,event_type,actor_user_id,correlation_id)
       VALUES ($1,$2,$3,'GRANTED',$4,$5)`,
      [companyB, participationId, collaborationId, manager, id()],
    )).rejects.toThrow('PARTICIPATION_EVENT_TUPLE_FORBIDDEN');
  });
});
