import { appendFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const owner = new Pool({ connectionString: process.env.DATABASE_URL, max: 40 });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL, max: 60 });
const id = () => randomUUID();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EVIDENCE = '/tmp/sco-cursor1-stage013-remediation';
mkdirSync(`${EVIDENCE}/logs`, { recursive: true });
const log = (file: string, name: string, v: unknown) =>
  appendFileSync(`${EVIDENCE}/logs/${file}.jsonl`, `${JSON.stringify({ name, ...(v as object) })}\n`);

const SQL = {
  CREATE: 'SELECT * FROM public.partner_collaboration_create($1,$2,$3)',
  ARCHIVE: 'SELECT * FROM public.partner_collaboration_archive($1,$2)',
  GRANT: 'SELECT * FROM public.partner_collaboration_participation_grant($1,$2,$3,$4)',
  REVOKE: 'SELECT * FROM public.partner_collaboration_participation_revoke($1,$2,$3)',
  JOIN: 'SELECT * FROM public.partner_collaboration_participation_join($1)',
  LEAVE: 'SELECT * FROM public.partner_collaboration_participation_leave($1)',
  ENSURE: 'SELECT * FROM public.s13_collaboration_execution_ensure($1,$2)',
  BIND: 'SELECT * FROM public.s13_participant_execution_binding_bind($1,$2,$3)',
  USE: 'SELECT * FROM public.s13_participant_execution_binding_use($1)',
  TERM: 'SELECT * FROM public.s13_collaboration_execution_request_termination($1,$2)',
};

async function withRuntime<T>(actor: string | null, company: string | null, cb: (c: PoolClient) => Promise<T>) {
  const c = await runtime.connect();
  try {
    await c.query('BEGIN');
    if (actor !== null) await c.query("SELECT set_config('app.actor_id',$1,true)", [actor]);
    if (company !== null) await c.query("SELECT set_config('app.tenant_id',$1,true)", [company]);
    const r = await cb(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

function errOf(e: any) {
  return {
    code: e.code ?? null,
    message: String(e.message).split('\n')[0],
    constraint: e.constraint ?? null,
    table: e.table ?? null,
    detail: e.detail ? String(e.detail).slice(0, 160) : null,
    where: e.where ? String(e.where).split('\n')[0] : null,
  };
}

class Tx {
  client!: PoolClient;
  pid!: number;
  static async open(who: string, co: string) {
    const t = new Tx();
    t.client = await runtime.connect();
    await t.client.query('BEGIN');
    await t.client.query("SELECT set_config('app.actor_id',$1,true)", [who]);
    await t.client.query("SELECT set_config('app.tenant_id',$1,true)", [co]);
    t.pid = (await t.client.query('SELECT pg_backend_pid() AS p')).rows[0].p;
    return t;
  }
  run(sql: string, p: unknown[]) {
    return this.client.query(sql, p);
  }
  async end(commit: boolean) {
    try {
      await this.client.query(commit ? 'COMMIT' : 'ROLLBACK');
    } finally {
      this.client.release();
    }
  }
}

async function waitBlocked(pid: number, ms = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await owner.query(
      `SELECT wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=$1`,
      [pid],
    );
    if (r.rows[0]?.wait_event_type === 'Lock') {
      return { blocked: true, waited_ms: Date.now() - t0, blockers: r.rows[0].blockers as number[] };
    }
    await sleep(20);
  }
  return { blocked: false, waited_ms: ms, blockers: [] as number[] };
}

async function checkInvariants(cids: string[]) {
  const scope = 'AND c.id = ANY($1::uuid[])';
  const q = async (sql: string) => (await owner.query(sql, [cids])).rows;
  const inv = {
    I1: await q(`SELECT b.id FROM partner_participant_execution_bindings b JOIN partner_collaboration_participations p ON p.id=b.participation_id JOIN partner_collaborations c ON c.id=b.collaboration_id WHERE b.state='ACTIVE' AND p.state<>'ACTIVE' ${scope}`),
    I2: await q(`SELECT b.id FROM partner_participant_execution_bindings b JOIN partner_collaborations c ON c.id=b.collaboration_id WHERE b.state='ACTIVE' AND c.state<>'ACTIVE' ${scope}`),
    I3: await q(`SELECT b.execution_id, b.participation_id, count(*)::int n FROM partner_participant_execution_bindings b JOIN partner_collaborations c ON c.id=b.collaboration_id WHERE true ${scope} GROUP BY 1,2 HAVING count(*)>1`),
    I5: await q(`SELECT b.id FROM partner_participant_execution_bindings b JOIN partner_collaborations c ON c.id=b.collaboration_id JOIN partner_collaboration_participations p ON p.id=b.participation_id JOIN partner_collaboration_executions e ON e.id=b.execution_id WHERE (p.collaboration_id<>b.collaboration_id OR e.collaboration_id<>b.collaboration_id OR p.company_id<>b.company_id OR e.company_id<>b.company_id) ${scope}`),
    I6: await q(`SELECT p.collaboration_id, p.membership_id, count(*)::int n FROM partner_collaboration_participations p JOIN partner_collaborations c ON c.id=p.collaboration_id WHERE p.state='ACTIVE' ${scope} GROUP BY 1,2 HAVING count(*)>1`),
    I8: await q(`SELECT b.id FROM partner_participant_execution_bindings b JOIN partner_collaborations c ON c.id=b.collaboration_id WHERE NOT EXISTS (SELECT 1 FROM partner_participant_execution_binding_events ev WHERE ev.binding_id=b.id) ${scope}`),
  };
  const total = Object.values(inv).reduce((n, rows) => n + rows.length, 0);
  return { total, inv };
}

describe('Stage013 blocking remediation closure T1-T11', () => {
  const companyA = id();
  const companyB = id();
  const sco = id();
  const manager = id();
  const target = id();
  const peer = id();
  const reader = id();
  const fmgr = id();
  const mM = id();
  const mT = id();
  const mP = id();
  const mR = id();
  const mF = id();
  const roles = { mgr: id(), tgt: id(), peer: id(), rdr: id(), fmgr: id() };
  const workspaceA = id();
  const workspaceB = id();
  const projectA = id();
  const projectB = id();
  const policy = id();
  const externalCompany = id();
  const tracked: string[] = [];

  async function grantPerm(roleId: string, companyId: string, permission: string) {
    await owner.query(
      'INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4',
      [id(), companyId, roleId, permission],
    );
  }

  async function q1(who: string, co: string, sql: string, p: unknown[]) {
    return (await withRuntime(who, co, (c) => c.query(sql, p))).rows[0];
  }

  async function domain(who: string, co: string, sql: string, p: unknown[]) {
    try {
      const row = await q1(who, co, sql, p);
      return { ok: true as const, row, err: null };
    } catch (e) {
      return { ok: false as const, row: null, err: errOf(e) };
    }
  }

  async function newCollab() {
    const c = (await q1(manager, companyA, SQL.CREATE, [workspaceA, projectA, id()])).id as string;
    tracked.push(c);
    return c;
  }

  beforeAll(async () => {
    const o = (s: string, p: unknown[]) => owner.query(s, p);
    await o(`INSERT INTO "Company"(id,name,type,status) VALUES ($1,'R Partner A','PARTNER','ACTIVE'),($2,'R Partner B','PARTNER','ACTIVE'),($3,'R SCO','SCO','ACTIVE'),($4,'R External','PARTNER','ACTIVE')`, [companyA, companyB, sco, externalCompany]);
    await o(
      `INSERT INTO "User"(id,email,"passwordHash",status) VALUES ($1,$2,'x','ACTIVE'),($3,$4,'x','ACTIVE'),($5,$6,'x','ACTIVE'),($7,$8,'x','ACTIVE'),($9,$10,'x','ACTIVE')`,
      [manager, `${manager}@r.test`, target, `${target}@r.test`, peer, `${peer}@r.test`, reader, `${reader}@r.test`, fmgr, `${fmgr}@r.test`],
    );
    await o(
      `INSERT INTO "Role"(id,company_id,code,name) VALUES ($1,$2,'r-mgr','m'),($3,$2,'r-tgt','t'),($4,$2,'r-peer','p'),($5,$2,'r-rdr','r'),($6,$7,'r-fmgr','f')`,
      [roles.mgr, companyA, roles.tgt, roles.peer, roles.rdr, roles.fmgr, companyB],
    );
    await o(
      `INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES ($1,$2,$3,'ACTIVE'),($4,$5,$3,'ACTIVE'),($6,$7,$3,'ACTIVE'),($8,$9,$3,'ACTIVE'),($10,$11,$12,'ACTIVE')`,
      [mM, manager, companyA, mT, target, mP, peer, mR, reader, mF, fmgr, companyB],
    );
    for (const [c, m, r] of [
      [companyA, mM, roles.mgr],
      [companyA, mT, roles.tgt],
      [companyA, mP, roles.peer],
      [companyA, mR, roles.rdr],
      [companyB, mF, roles.fmgr],
    ] as const) {
      await o('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES ($1,$2,$3,$4)', [id(), c, m, r]);
    }
    const all = [
      'partner.portal.read',
      'partner.collaboration.read',
      'partner.collaboration.create',
      'partner.collaboration.manage',
      'partner.collaboration.participation.manage',
      'partner.collaboration.participate',
    ];
    for (const p of all) {
      await grantPerm(roles.mgr, companyA, p);
      await grantPerm(roles.fmgr, companyB, p);
    }
    for (const p of ['partner.portal.read', 'partner.collaboration.read', 'partner.collaboration.participate']) {
      await grantPerm(roles.tgt, companyA, p);
      await grantPerm(roles.peer, companyA, p);
    }
    await grantPerm(roles.rdr, companyA, 'partner.portal.read');
    for (const c of [companyA, companyB]) await o(`INSERT INTO company_partnerships(id,company_id,type,status) VALUES ($1,$2,'BUYER_PARTNERSHIP','ACTIVE')`, [id(), c]);
    const version = `r-v1-${policy}`;
    await o(
      `INSERT INTO partner_agreement_policy_versions (id,agreement_type,version_code,content_text,content_sha256,required,effective_at,acceptance_permission_code,reacceptance_required,suspension_effect,termination_effect,retention_classification,state,created_by)
       VALUES ($1,'BINDING_CONFIDENTIALITY',$3,'r',$4,true,$5::timestamptz,'partner.agreement.accept',false,'NO_ACCESS_CHANGE','NO_ACCESS_CHANGE','R','PUBLISHED',$2)`,
      [policy, manager, version, '0'.repeat(64), new Date(Date.UTC(1999, 0, 1) + Math.floor(Math.random() * 3e8) * 1000).toISOString()],
    );
    for (const [c, a, m] of [
      [companyA, manager, mM],
      [companyB, fmgr, mF],
    ] as const) {
      await o(
        `INSERT INTO partner_agreement_acceptances (company_id,actor_user_id,membership_id,policy_version_id,agreement_type,version_code,accepted_content_sha256,authority_permission_code,authority_basis,purpose_code,idempotency_key,request_fingerprint,correlation_id)
        VALUES ($1,$2,$3,$4,'BINDING_CONFIDENTIALITY',$5,$6,'partner.agreement.accept','{}'::jsonb,'PUR-02',$7,$8,$9)`,
        [c, a, m, policy, version, '0'.repeat(64), `r-${id()}`, '1'.repeat(64), id()],
      );
      await o(
        `INSERT INTO partner_agreement_acceptance_events(id,acceptance_id,company_id,status,actor_user_id,correlation_id) SELECT $1,id,company_id,'ACCEPTED',$2,$3 FROM partner_agreement_acceptances WHERE company_id=$4`,
        [id(), a, id(), c],
      );
    }
    await o(`INSERT INTO partner_workspaces(id,company_id,display_name,created_by) VALUES ($1,$2,'R WS A',$3),($4,$5,'R WS B',$6)`, [
      workspaceA,
      companyA,
      manager,
      workspaceB,
      companyB,
      fmgr,
    ]);
    await o(`INSERT INTO projects(id,company_id,code,name,created_by) VALUES ($1,$2,'R-A','A',$3),($4,$5,'R-B','B',$6)`, [
      projectA,
      companyA,
      manager,
      projectB,
      companyB,
      fmgr,
    ]);
    await o(
      `INSERT INTO partner_workspace_project_links(id,company_id,workspace_id,project_id,created_by) VALUES ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)`,
      [id(), companyA, workspaceA, projectA, manager, id(), companyB, workspaceB, projectB, fmgr],
    );
  }, 120_000);

  afterAll(async () => {
    // Terminate any leftover backends from a timed-out race before cleanup.
    try {
      await owner.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND application_name = 'sco-test'
            AND state <> 'idle'`,
      );
    } catch {
      /* */
    }
    const c = await owner.connect();
    const cs = [companyA, companyB, sco];
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL session_replication_role = 'replica'");
      for (const t of [
        'partner_participant_execution_binding_events',
        'partner_collaboration_execution_events',
        'partner_participant_execution_bindings',
        'partner_collaboration_executions',
        'partner_collaboration_participation_events',
        'partner_collaboration_events',
        'partner_collaboration_participations',
        'partner_collaborations',
        'partner_workspace_project_links',
        'projects',
        'partner_workspaces',
      ]) {
        await c.query(`DELETE FROM ${t} WHERE company_id = ANY($1::uuid[])`, [cs]);
      }
      await c.query('DELETE FROM partner_agreement_acceptance_events WHERE acceptance_id IN (SELECT id FROM partner_agreement_acceptances WHERE policy_version_id=$1)', [
        policy,
      ]);
      await c.query('DELETE FROM partner_agreement_acceptances WHERE policy_version_id=$1', [policy]);
      await c.query('DELETE FROM partner_agreement_policy_events WHERE policy_version_id=$1', [policy]);
      await c.query('DELETE FROM partner_agreement_policy_versions WHERE id=$1', [policy]);
      await c.query('DELETE FROM company_partnerships WHERE company_id = ANY($1::uuid[])', [cs]);
      await c.query('DELETE FROM audit_logs WHERE company_id = ANY($1::uuid[]) OR actor_user_id = ANY($2::uuid[])', [
        cs,
        [manager, target, peer, reader, fmgr],
      ]);
      await c.query('DELETE FROM "RolePermission" WHERE role_id = ANY($1::uuid[])', [Object.values(roles)]);
      await c.query('DELETE FROM "MembershipRole" WHERE membership_id = ANY($1::uuid[])', [[mM, mT, mP, mR, mF]]);
      await c.query('DELETE FROM "CompanyMembership" WHERE id = ANY($1::uuid[])', [[mM, mT, mP, mR, mF]]);
      await c.query('DELETE FROM "Role" WHERE id = ANY($1::uuid[])', [Object.values(roles)]);
      await c.query('DELETE FROM "User" WHERE id = ANY($1::uuid[])', [[manager, target, peer, reader, fmgr]]);
      await c.query('DELETE FROM "Company" WHERE id = ANY($1::uuid[])', [[...cs, externalCompany]]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await Promise.all([owner.end(), runtime.end()]);
    }
  }, 300_000);

  it('T1 F2 request_termination parity', async () => {
    const c = await newCollab();
    const E = (await q1(manager, companyA, SQL.ENSURE, [c, id()])).id as string;
    const unknown = id();
    const actors: Array<[string, string]> = [
      [reader, companyA],
      [target, companyA],
      [fmgr, companyB],
    ];
    for (const [who, co] of actors) {
      const known = await domain(who, co, SQL.TERM, [E, id()]);
      const missing = await domain(who, co, SQL.TERM, [unknown, id()]);
      expect(known.ok).toBe(false);
      expect(missing.ok).toBe(false);
      expect(known.err!.message).toBe(missing.err!.message);
      expect(known.err!.code).toBe('P0001');
      expect(known.err!.constraint).toBeNull();
      expect(known.err!.table).toBeNull();
    }
    const before = await owner.query('SELECT state, version FROM partner_collaboration_executions WHERE id=$1', [E]);
    expect(before.rows[0].state).toBe('OPEN');
    const first = await q1(manager, companyA, SQL.TERM, [E, id()]);
    expect(first.state).toBe('TERMINATION_REQUESTED');
    const events1 = await owner.query(
      `SELECT count(*)::int AS n FROM partner_collaboration_execution_events WHERE execution_id=$1 AND event_type='TERMINATION_REQUESTED'`,
      [E],
    );
    expect(events1.rows[0].n).toBe(1);
    const second = await q1(manager, companyA, SQL.TERM, [E, id()]);
    expect(second).toMatchObject({ id: E, state: 'TERMINATION_REQUESTED', version: first.version });
    const events2 = await owner.query(
      `SELECT count(*)::int AS n FROM partner_collaboration_execution_events WHERE execution_id=$1 AND event_type='TERMINATION_REQUESTED'`,
      [E],
    );
    expect(events2.rows[0].n).toBe(1);
  });

  it('T2 F3 bind vs revoke', async () => {
    const c = await newCollab();
    const P = (await q1(manager, companyA, SQL.GRANT, [c, mT, `g-${id()}`, id()])).id as string;
    const E = (await q1(manager, companyA, SQL.ENSURE, [c, id()])).id as string;
    const t1 = await Tx.open(manager, companyA);
    const t2 = await Tx.open(target, companyA);
    try {
      await t1.run(SQL.REVOKE, [P, 't2', id()]);
      let settled = false;
      let t2res: any;
      const p2 = t2.run(SQL.BIND, [E, P, id()]).then(
        (r) => {
          settled = true;
          t2res = { ok: true, id: r.rows[0]?.id };
        },
        (e) => {
          settled = true;
          t2res = errOf(e);
        },
      );
      const block = await waitBlocked(t2.pid);
      expect(block.blocked).toBe(true);
      expect(block.blockers).toContain(t1.pid);
      expect(settled).toBe(false);
      await t1.end(true);
      await p2;
      expect(t2res.ok).toBeFalsy();
      expect(t2res.message).toContain('EXECUTION_BINDING_FORBIDDEN');
      await t2.end(false);
    } catch (e) {
      try {
        await t1.end(false);
      } catch {
        /* */
      }
      try {
        await t2.end(false);
      } catch {
        /* */
      }
      throw e;
    }
    expect((await owner.query(`SELECT count(*)::int n FROM partner_participant_execution_bindings WHERE execution_id=$1`, [E])).rows[0].n).toBe(0);
    expect((await owner.query(`SELECT state FROM partner_collaboration_participations WHERE id=$1`, [P])).rows[0].state).toBe('REVOKED');
    expect((await checkInvariants([c])).total).toBe(0);
  });

  it('T3 F4 bind vs archive', async () => {
    const c = await newCollab();
    const P = (await q1(manager, companyA, SQL.GRANT, [c, mT, `g-${id()}`, id()])).id as string;
    const E = (await q1(manager, companyA, SQL.ENSURE, [c, id()])).id as string;
    const t1 = await Tx.open(manager, companyA);
    const t2 = await Tx.open(target, companyA);
    try {
      await t1.run(SQL.ARCHIVE, [c, id()]);
      let settled = false;
      let t2res: any;
      const p2 = t2.run(SQL.BIND, [E, P, id()]).then(
        (r) => {
          settled = true;
          t2res = { ok: true, id: r.rows[0]?.id };
        },
        (e) => {
          settled = true;
          t2res = errOf(e);
        },
      );
      const block = await waitBlocked(t2.pid);
      expect(block.blocked).toBe(true);
      expect(settled).toBe(false);
      await t1.end(true);
      await p2;
      expect(t2res.ok).toBeFalsy();
      expect(String(t2res.message)).toMatch(/EXECUTION_(BINDING|COLLABORATION)_FORBIDDEN/);
      await t2.end(false);
    } catch (e) {
      try {
        await t1.end(false);
      } catch {
        /* */
      }
      try {
        await t2.end(false);
      } catch {
        /* */
      }
      throw e;
    }
    expect((await owner.query(`SELECT count(*)::int n FROM partner_participant_execution_bindings WHERE execution_id=$1 AND state='ACTIVE'`, [E])).rows[0].n).toBe(0);
    expect((await checkInvariants([c])).total).toBe(0);
  });

  it('T4 F5 concurrent duplicate bind', async () => {
    for (const n of [2, 5, 10, 20]) {
      const c = await newCollab();
      const P = (await q1(manager, companyA, SQL.GRANT, [c, mT, `g-${id()}`, id()])).id as string;
      const E = (await q1(manager, companyA, SQL.ENSURE, [c, id()])).id as string;
      const results = await Promise.all(
        Array.from({ length: n }, () => domain(target, companyA, SQL.BIND, [E, P, id()])),
      );
      const ok = results.filter((r) => r.ok);
      const fail = results.filter((r) => !r.ok);
      expect(fail.filter((r) => r.err?.code === '23505')).toHaveLength(0);
      expect(ok).toHaveLength(n);
      expect(new Set(ok.map((r) => r.row!.id)).size).toBe(1);
      expect((await owner.query(`SELECT count(*)::int n FROM partner_participant_execution_bindings WHERE execution_id=$1 AND participation_id=$2`, [E, P])).rows[0].n).toBe(1);
      expect(
        (await owner.query(`SELECT count(*)::int n FROM partner_participant_execution_binding_events WHERE execution_id=$1 AND event_type='CREATED'`, [E])).rows[0].n,
      ).toBe(1);
    }
  });

  it('T5 F8 active duplicate grant normalization', async () => {
    const c = await newCollab();
    const key = `g-${id()}`;
    const first = await q1(manager, companyA, SQL.GRANT, [c, mT, key, id()]);
    const replay = await q1(manager, companyA, SQL.GRANT, [c, mT, key, id()]);
    expect(replay.id).toBe(first.id);
    const conflict = await domain(manager, companyA, SQL.GRANT, [c, mT, `g-${id()}`, id()]);
    expect(conflict.ok).toBe(false);
    expect(conflict.err!.code).toBe('P0001');
    expect(conflict.err!.message).toContain('PARTICIPATION_ALREADY_ACTIVE');
    expect(conflict.err!.constraint).toBeNull();
    expect(conflict.err!.table).toBeNull();
    expect(String(conflict.err!.message)).not.toMatch(/partner_collaboration_active_participation_unique|INSERT/i);
    expect((await owner.query(`SELECT count(*)::int n FROM partner_collaboration_participations WHERE collaboration_id=$1 AND membership_id=$2 AND state='ACTIVE'`, [c, mT])).rows[0].n).toBe(1);
    await q1(manager, companyA, SQL.REVOKE, [first.id, 't5', id()]);
    const regrant = await q1(manager, companyA, SQL.GRANT, [c, mT, `g-${id()}`, id()]);
    expect(regrant.id).not.toBe(first.id);
  });

  it('T6 F9 revoke vs archive deadlock regression x30', async () => {
    let deadlocks = 0;
    for (let i = 0; i < 30; i++) {
      const c = await newCollab();
      const P = (await q1(manager, companyA, SQL.GRANT, [c, mT, `g-${id()}`, id()])).id as string;
      const E = (await q1(manager, companyA, SQL.ENSURE, [c, id()])).id as string;
      await q1(target, companyA, SQL.BIND, [E, P, id()]);
      // Deterministic conflicting schedule: hold participation_events so revoke
      // parks after taking Collaboration+Participation; then start archive.
      const controller = await owner.connect();
      const tRevoke = await Tx.open(manager, companyA);
      const tArchive = await Tx.open(manager, companyA);
      let revokeRes: any = null;
      let archiveRes: any = null;
      try {
        await controller.query('BEGIN');
        await controller.query('LOCK TABLE partner_collaboration_participation_events IN SHARE ROW EXCLUSIVE MODE');
        const pRevoke = tRevoke.run(SQL.REVOKE, [P, `d-${i}`, id()]).then(
          () => {
            revokeRes = { ok: true };
          },
          (e) => {
            revokeRes = errOf(e);
          },
        );
        const revokeBlocked = await waitBlocked(tRevoke.pid, 5000);
        expect(revokeBlocked.blocked).toBe(true);
        const pArchive = tArchive.run(SQL.ARCHIVE, [c, id()]).then(
          () => {
            archiveRes = { ok: true };
          },
          (e) => {
            archiveRes = errOf(e);
          },
        );
        const archiveBlocked = await waitBlocked(tArchive.pid, 5000);
        expect(archiveBlocked.blocked).toBe(true);
        await controller.query('COMMIT');
        // Revoke must COMMIT before archive's Collaboration FOR UPDATE can finish.
        // Waiting on both queries while revoke stays open recreates a harness hang,
        // not a product 40P01.
        await Promise.race([
          pRevoke,
          sleep(15_000).then(() => {
            throw new Error(`T6_REVOKE_TIMEOUT i=${i}`);
          }),
        ]);
        await tRevoke.end(!(revokeRes && revokeRes.code));
        await Promise.race([
          pArchive,
          sleep(15_000).then(() => {
            throw new Error(`T6_ARCHIVE_TIMEOUT i=${i}`);
          }),
        ]);
        await tArchive.end(!(archiveRes && archiveRes.code));
        if (revokeRes?.code === '40P01' || archiveRes?.code === '40P01') deadlocks += 1;
        expect(revokeRes?.code === '40P01' || archiveRes?.code === '40P01').toBe(false);
        expect(revokeRes?.ok || revokeRes?.message).toBeTruthy();
        expect(archiveRes?.ok || archiveRes?.message).toBeTruthy();
        expect((await checkInvariants([c])).total).toBe(0);
      } catch (e) {
        try {
          await tRevoke.end(false);
        } catch {
          /* */
        }
        try {
          await tArchive.end(false);
        } catch {
          /* */
        }
        throw e;
      } finally {
        try {
          await controller.query('ROLLBACK');
        } catch {
          /* */
        }
        controller.release();
      }
    }
    log('t6_deadlock', 'T6', { deadlocks, runs: 30 });
    expect(deadlocks).toBe(0);
  }, 600_000);

  it('T7 old binding after regrant', async () => {
    const c = await newCollab();
    const P1 = (await q1(manager, companyA, SQL.GRANT, [c, mT, `g-${id()}`, id()])).id as string;
    const E = (await q1(manager, companyA, SQL.ENSURE, [c, id()])).id as string;
    const B1 = (await q1(target, companyA, SQL.BIND, [E, P1, id()])).id as string;
    await q1(manager, companyA, SQL.REVOKE, [P1, 't7', id()]);
    const P2 = (await q1(manager, companyA, SQL.GRANT, [c, mT, `g-${id()}`, id()])).id as string;
    expect(P2).not.toBe(P1);
    const B2 = (await q1(target, companyA, SQL.BIND, [E, P2, id()])).id as string;
    await expect(withRuntime(target, companyA, (client) => client.query(SQL.USE, [B1]))).rejects.toThrow('EXECUTION_BINDING_FORBIDDEN');
    await expect(withRuntime(target, companyA, (client) => client.query(SQL.BIND, [E, P1, id()]))).rejects.toThrow('EXECUTION_BINDING_FORBIDDEN');
    expect((await q1(target, companyA, SQL.USE, [B2])).state).toBe('ACTIVE');
    expect((await owner.query(`SELECT state FROM partner_participant_execution_bindings WHERE id=$1`, [B1])).rows[0].state).toBe('INVALIDATED');
  });

  it('T8 sibling bind and T9 sibling use', async () => {
    const c = await newCollab();
    const PA = (await q1(manager, companyA, SQL.GRANT, [c, mT, `g-${id()}`, id()])).id as string;
    const PB = (await q1(manager, companyA, SQL.GRANT, [c, mP, `g-${id()}`, id()])).id as string;
    const E = (await q1(manager, companyA, SQL.ENSURE, [c, id()])).id as string;
    const BA = (await q1(target, companyA, SQL.BIND, [E, PA, id()])).id as string;
    const before = (await owner.query(`SELECT count(*)::int n FROM partner_participant_execution_bindings WHERE execution_id=$1`, [E])).rows[0].n;
    await expect(withRuntime(peer, companyA, (client) => client.query(SQL.BIND, [E, PA, id()]))).rejects.toThrow('EXECUTION_BINDING_FORBIDDEN');
    expect((await owner.query(`SELECT count(*)::int n FROM partner_participant_execution_bindings WHERE execution_id=$1`, [E])).rows[0].n).toBe(before);
    await expect(withRuntime(peer, companyA, (client) => client.query(SQL.USE, [BA]))).rejects.toThrow('EXECUTION_BINDING_FORBIDDEN');
    expect((await q1(peer, companyA, SQL.BIND, [E, PB, id()])).participation_id).toBe(PB);
  });

  it('T10 archive vs grant', async () => {
    const c = await newCollab();
    const t1 = await Tx.open(manager, companyA);
    const t2 = await Tx.open(manager, companyA);
    try {
      await t1.run(SQL.ARCHIVE, [c, id()]);
      let t2res: any;
      const p2 = t2.run(SQL.GRANT, [c, mT, `g-${id()}`, id()]).then(
        (r) => {
          t2res = { ok: true, id: r.rows[0]?.id };
        },
        (e) => {
          t2res = errOf(e);
        },
      );
      const block = await waitBlocked(t2.pid);
      expect(block.blocked).toBe(true);
      await t1.end(true);
      await p2;
      expect(t2res.ok).toBeFalsy();
      expect(t2res.message).toContain('COLLABORATION_FORBIDDEN');
      await t2.end(false);
    } catch (e) {
      try {
        await t1.end(false);
      } catch {
        /* */
      }
      try {
        await t2.end(false);
      } catch {
        /* */
      }
      throw e;
    }
    expect((await owner.query(`SELECT count(*)::int n FROM partner_collaboration_participations WHERE collaboration_id=$1`, [c])).rows[0].n).toBe(0);
  });

  it('T11 archive vs ensure', async () => {
    const c = await newCollab();
    const t1 = await Tx.open(manager, companyA);
    const t2 = await Tx.open(manager, companyA);
    try {
      await t1.run(SQL.ARCHIVE, [c, id()]);
      let t2res: any;
      const p2 = t2.run(SQL.ENSURE, [c, id()]).then(
        (r) => {
          t2res = { ok: true, id: r.rows[0]?.id };
        },
        (e) => {
          t2res = errOf(e);
        },
      );
      const block = await waitBlocked(t2.pid);
      expect(block.blocked).toBe(true);
      await t1.end(true);
      await p2;
      expect(t2res.ok).toBeFalsy();
      expect(t2res.message).toContain('EXECUTION_COLLABORATION_FORBIDDEN');
      await t2.end(false);
    } catch (e) {
      try {
        await t1.end(false);
      } catch {
        /* */
      }
      try {
        await t2.end(false);
      } catch {
        /* */
      }
      throw e;
    }
    expect((await owner.query(`SELECT count(*)::int n FROM partner_collaboration_executions WHERE collaboration_id=$1`, [c])).rows[0].n).toBe(0);
  });

  it('OD-1 leave remains documented NO-OP', async () => {
    const c = await newCollab();
    const P = (await q1(manager, companyA, SQL.GRANT, [c, mT, `g-${id()}`, id()])).id as string;
    const joined = await q1(target, companyA, SQL.JOIN, [P]);
    const left = await q1(target, companyA, SQL.LEAVE, [P]);
    expect(left).toMatchObject({ id: P, state: 'ACTIVE', collaboration_id: c, membership_id: mT });
    expect(left.id).toBe(joined.id);
    expect((await owner.query(`SELECT state FROM partner_collaboration_participations WHERE id=$1`, [P])).rows[0].state).toBe('ACTIVE');
    expect(
      (await owner.query(`SELECT count(*)::int n FROM partner_collaboration_participation_events WHERE participation_id=$1 AND event_type='REVOKED'`, [P])).rows[0].n,
    ).toBe(0);
  });

  it('mixed concurrency stress 180 then 504', async () => {
    const ops = ['bind', 'revoke', 'archive', 'term', 'use', 'ensure', 'grant'] as const;
    async function runMix(iterations: number) {
      let deadlocks = 0;
      let raw23505 = 0;
      let invariantFailures = 0;
      let unexpected = 0;
      const cids: string[] = [];
      for (let i = 0; i < iterations; i++) {
        const c = await newCollab();
        cids.push(c);
        const P = (await q1(manager, companyA, SQL.GRANT, [c, mT, `g-${id()}`, id()])).id as string;
        const P2 = (await q1(manager, companyA, SQL.GRANT, [c, mP, `g-${id()}`, id()])).id as string;
        const E = (await q1(manager, companyA, SQL.ENSURE, [c, id()])).id as string;
        let B: string | null = null;
        try {
          B = (await q1(target, companyA, SQL.BIND, [E, P, id()])).id as string;
        } catch {
          /* */
        }
        const chosen = Array.from({ length: 3 + (i % 3) }, () => ops[i % ops.length]);
        const results = await Promise.all(
          chosen.map(async (op, idx) => {
            if (op === 'bind') return domain(idx % 2 === 0 ? target : peer, companyA, SQL.BIND, [E, idx % 2 === 0 ? P : P2, id()]);
            if (op === 'revoke') return domain(manager, companyA, SQL.REVOKE, [idx % 2 === 0 ? P : P2, 'stress', id()]);
            if (op === 'archive') return domain(manager, companyA, SQL.ARCHIVE, [c, id()]);
            if (op === 'term') return domain(manager, companyA, SQL.TERM, [E, id()]);
            if (op === 'use') return domain(target, companyA, SQL.USE, [B ?? id()]);
            if (op === 'ensure') return domain(manager, companyA, SQL.ENSURE, [c, id()]);
            return domain(manager, companyA, SQL.GRANT, [c, mM, `g-${id()}`, id()]);
          }),
        );
        for (const r of results) {
          if (!r.ok && r.err?.code === '40P01') deadlocks += 1;
          if (!r.ok && r.err?.code === '23505') raw23505 += 1;
          if (!r.ok && r.err?.code && !['P0001', '40P01', '23505'].includes(r.err.code)) unexpected += 1;
        }
      }
      const inv = await checkInvariants(cids);
      invariantFailures = inv.total;
      return { deadlocks, raw23505, invariantFailures, unexpected, iterations };
    }
    const first = await runMix(180);
    log('stress', 'MIX_180', first);
    expect(first.deadlocks).toBe(0);
    expect(first.raw23505).toBe(0);
    expect(first.invariantFailures).toBe(0);
    const second = await runMix(504);
    log('stress', 'MIX_504', second);
    expect(second.deadlocks).toBe(0);
    expect(second.raw23505).toBe(0);
    expect(second.invariantFailures).toBe(0);
  }, 900_000);
});
