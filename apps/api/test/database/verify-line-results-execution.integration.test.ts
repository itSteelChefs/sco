import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SYSTEM_ACTOR_ID = '00000000-0000-4000-9000-000000005357';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let companyA: string; let companyB: string; let internalCompany: string; let unitId: string;
let writer: string; let analyst: string; let approver: string;

async function grant(userId: string, companyId: string, code: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, companyId])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, companyId, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), companyId, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), companyId, role, code]);
}

async function client(actor: string, tenant: string) {
  const connection = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
  await connection.connect();
  await connection.query(`SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false)`, [actor, tenant]);
  return connection;
}

async function internalClient(actor: string, tenant: string) {
  const connection = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
  await connection.connect();
  await connection.query(`SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false)`, [actor, tenant]);
  return connection;
}

async function systemClient() {
  const connection = new Client({ connectionString: process.env.VERIFY_SYSTEM_DATABASE_URL });
  await connection.connect();
  return connection;
}

function settled(pending: Promise<unknown>) {
  return pending.then(() => null, (error: Error) => error);
}

// Deterministic barrier: wait until a backend is genuinely blocked by another transaction's row lock.
async function waitUntilLockBlocked() {
  for (let attempt = 0; attempt < 4000; attempt += 1) {
    const blocked = await owner.query(`SELECT count(*)::int count FROM pg_stat_activity WHERE state='active' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid)) > 0 AND (query ILIKE '%verify_%')`);
    if (blocked.rows[0].count > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

async function createRequest(connection: Client, actor: string, company: string) {
  return (await connection.query('SELECT partner_verify_request_create($1,$2,$3) request_id', [actor, company, id()])).rows[0].request_id as string;
}

async function createRevision(connection: Client, actor: string, company: string, request: string, predecessor: string | null, key: string, lines: Array<Record<string, unknown>>) {
  const result = await connection.query(`SELECT partner_verify_revision_create($1,$2,$3,$4,$5::text[],$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12) revision_id`,
    [actor, company, request, predecessor, ['SAR'], JSON.stringify({}), null, null, `input-${key}`, JSON.stringify(lines), key, id()]);
  return result.rows[0].revision_id as string;
}

async function lineIds(revision: string) {
  const rows = (await owner.query('SELECT line_number,id FROM verify_quote_lines WHERE verify_quote_revision_id=$1 ORDER BY line_number', [revision])).rows;
  return new Map<number, string>(rows.map((row) => [row.line_number as number, row.id as string]));
}

async function submitFullyReady(connection: Client, actor: string, company: string, request: string, revision: string, lineNumbers: number[]) {
  const lines = await lineIds(revision);
  for (const lineNumber of lineNumbers) {
    await connection.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [actor, company, lines.get(lineNumber), 'READY_FOR_VERIFICATION', null, id()]);
  }
  await connection.query('SELECT partner_verify_request_submit($1,$2,$3,$4,$5)', [actor, company, request, revision, id()]);
}

// SYSTEM gateway wrappers: none of these accept an actor parameter (P1 remediation) — attribution is always the fixed system identity.
async function runCreate(system: Client, revision: string, methodology = 'verify-v0.1', fingerprint = `ev-${id()}`, retryOf: string | null = null) {
  return (await system.query('SELECT internal_verify_system_run_create($1,$2,$3,$4,$5) run_id', [revision, methodology, fingerprint, retryOf, id()])).rows[0].run_id as string;
}
async function runStart(system: Client, run: string) {
  await system.query('SELECT internal_verify_system_run_start($1,$2)', [run, id()]);
}
async function runComplete(system: Client, run: string) {
  await system.query('SELECT internal_verify_system_run_complete($1,$2)', [run, id()]);
}
async function runFail(system: Client, run: string, reason = 'failure') {
  await system.query('SELECT internal_verify_system_run_fail($1,$2,$3)', [run, reason, id()]);
}
async function evidenceBind(system: Client, run: string, integrityRef = `sha256:${id()}`) {
  const result = await system.query(
    `SELECT internal_verify_system_evidence_bind($1,'REFERENCE','source','v1',NULL,NULL,NULL,NULL,'{}'::jsonb,'APPROVED','{}'::jsonb,'INTERNAL',$2,$3) evidence_id`,
    [run, integrityRef, id()],
  );
  return result.rows[0].evidence_id as string;
}
async function lineResultRecord(system: Client, run: string, line: string, outcome: string, reason: string | null = null, evidenceIds: string[] | null = null) {
  const result = await system.query('SELECT internal_verify_system_line_result_record($1,$2,$3,$4,$5,$6) result_id', [run, line, outcome, reason, evidenceIds, id()]);
  return result.rows[0].result_id as string;
}
async function prepareComputed(internal: Client, actor: string, run: string, supersedes: string | null = null) {
  const result = await internal.query('SELECT internal_verify_result_prepare_computed($1,$2,$3,$4) result_id', [actor, run, supersedes, id()]);
  return result.rows[0].result_id as string;
}

async function readyRun(system: Client, revision: string, lineNumbers: number[]) {
  const run = await runCreate(system, revision);
  await runStart(system, run);
  const lines = await lineIds(revision);
  for (const lineNumber of lineNumbers) {
    await lineResultRecord(system, run, lines.get(lineNumber)!, 'VERIFIED');
  }
  await runComplete(system, run);
  return run;
}

describe('Verify V0.1 Batch 1-D line-result execution and aggregate results (remediation pass 1)', () => {
  beforeAll(async () => {
    companyA = id(); companyB = id(); internalCompany = id(); unitId = id();
    writer = id(); analyst = id(); approver = id();
    await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,\'Batch1D Partner A\',\'PARTNER\'),($2,\'Batch1D Partner B\',\'PARTNER\'),($3,\'Batch1D Internal\',\'SCO\')', [companyA, companyB, internalCompany]);
    await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,\'Each\',\'count\')', [unitId, `batch1d-unit-${unitId}`]);
    await owner.query(`INSERT INTO "User"(id,email,"passwordHash") SELECT value::uuid, value || '@batch1d.test', 'x' FROM unnest($1::text[]) value`, [[writer, analyst, approver]]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\'),($4,$5,$6,\'ACTIVE\'),($7,$8,$6,\'ACTIVE\')', [id(), writer, companyA, id(), analyst, internalCompany, id(), approver]);
    await grant(writer, companyA, 'partner_verify.write');
    await grant(analyst, internalCompany, 'verify.analyst');
    await grant(approver, internalCompany, 'verify.approver');
  });

  afterAll(async () => {
    await owner.query(`TRUNCATE verify_line_result_evidence,verify_line_results,verify_run_line_scope,verify_raw_content_access_events,verify_raw_review_grants,verify_results,verify_evidence_bindings,verify_runs,verify_quote_level_adjustments,verify_quote_line_adjustments,verify_quote_lines,verify_quote_revisions,verify_requests`);
    await owner.end();
  });

  it('captures immutable run scope, defers pre-run exclusions to run start, and produces no result for informational lines', async () => {
    const partner = await client(writer, companyA);
    let request: string; let revision: string;
    try {
      request = await createRequest(partner, writer, companyA);
      revision = await createRevision(partner, writer, companyA, request, null, 'scope-capture', [
        { lineNumber: 1, itemDescription: 'Ready line', quantity: 2, unitId, currencyCode: 'SAR', unitPrice: 100, isPriceBearing: true },
        { lineNumber: 2, itemDescription: 'Informational note', isPriceBearing: false, isInformational: true },
        { lineNumber: 3, itemDescription: 'Will become not verifiable', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 50, isPriceBearing: true },
      ]);
      await submitFullyReady(partner, writer, companyA, request, revision, [1, 3]);
      const lines = await lineIds(revision);
      const analystConn = await internalClient(analyst, internalCompany);
      try {
        await analystConn.query('SELECT internal_verify_quote_line_transition($1,$2,$3,$4,$5)', [analyst, lines.get(3), 'NOT_VERIFIABLE', 'insufficient identity', id()]);
      } finally { await analystConn.end(); }

      const system = await systemClient();
      let run: string;
      try {
        run = await runCreate(system, revision);
        // P1 remediation: no line result exists yet at QUEUED creation time (only once RUNNING).
        expect((await owner.query('SELECT count(*)::int count FROM verify_line_results WHERE verify_run_id=$1', [run])).rows[0].count).toBe(0);
        await runStart(system, run);
      } finally { await system.end(); }

      const scope = (await owner.query('SELECT verify_quote_line_id,is_applicable,captured_readiness_state FROM verify_run_line_scope WHERE verify_run_id=$1 ORDER BY captured_readiness_state', [run!])).rows;
      expect(scope.length).toBe(3);
      const byLine = new Map(scope.map((row) => [row.verify_quote_line_id, row]));
      expect(byLine.get(lines.get(1)!)).toEqual({ verify_quote_line_id: lines.get(1), is_applicable: true, captured_readiness_state: 'READY_FOR_VERIFICATION' });
      expect(byLine.get(lines.get(2)!)).toEqual({ verify_quote_line_id: lines.get(2), is_applicable: false, captured_readiness_state: 'NEEDS_COMPLETION' });
      expect(byLine.get(lines.get(3)!)).toEqual({ verify_quote_line_id: lines.get(3), is_applicable: true, captured_readiness_state: 'NOT_VERIFIABLE' });

      const results = (await owner.query('SELECT verify_quote_line_id,outcome,exclusion_reason,created_by FROM verify_line_results WHERE verify_run_id=$1', [run!])).rows;
      expect(results.length).toBe(1);
      expect(results[0]).toEqual({ verify_quote_line_id: lines.get(3), outcome: 'EXCLUDED', exclusion_reason: 'insufficient identity', created_by: SYSTEM_ACTOR_ID });
    } finally { await partner.end(); }
  });

  it('P1: cannot attribute SYSTEM actions to an arbitrary user — attribution is always the fixed system identity regardless of session actor spoofing', async () => {
    const partner = await client(writer, companyA);
    let request: string; let revision: string;
    try {
      request = await createRequest(partner, writer, companyA);
      revision = await createRevision(partner, writer, companyA, request, null, 'forged-actor', [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 1, isPriceBearing: true }]);
      await submitFullyReady(partner, writer, companyA, request, revision, [1]);
    } finally { await partner.end(); }
    const line = (await lineIds(revision!)).get(1)!;

    const system = await systemClient();
    let run: string;
    try {
      // Spoof the session actor GUC to an unrelated, capability-holding human before every SYSTEM call.
      await system.query(`SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false)`, [analyst, companyA]);
      run = await runCreate(system, revision!);
      await runStart(system, run);
      const evidence = await evidenceBind(system, run);
      const resultId = await lineResultRecord(system, run, line, 'VERIFIED', null, [evidence]);
      await runComplete(system, run);

      const runRow = (await owner.query('SELECT created_by FROM verify_runs WHERE id=$1', [run])).rows[0];
      const lineResultRow = (await owner.query('SELECT created_by FROM verify_line_results WHERE id=$1', [resultId])).rows[0];
      const evidenceRow = (await owner.query('SELECT created_by FROM verify_evidence_bindings WHERE id=$1', [evidence])).rows[0];
      expect(runRow.created_by).toBe(SYSTEM_ACTOR_ID);
      expect(lineResultRow.created_by).toBe(SYSTEM_ACTOR_ID);
      expect(evidenceRow.created_by).toBe(SYSTEM_ACTOR_ID);

      const audits = await owner.query(`SELECT DISTINCT actor_user_id FROM audit_logs WHERE entity_id = ANY($1::uuid[])`, [[run, resultId, evidence]]);
      expect(audits.rows).toEqual([{ actor_user_id: SYSTEM_ACTOR_ID }]);
      expect(audits.rows.every((row) => row.actor_user_id !== analyst)).toBe(true);
    } finally { await system.end(); }
  });

  it('P1: evidence binding is rejected outside RUNNING (QUEUED, COMPLETED, FAILED, CANCELLED) and permitted only while RUNNING', async () => {
    async function freshSubmittedRevision(key: string) {
      const partnerConn = await client(writer, companyA);
      try {
        const request = await createRequest(partnerConn, writer, companyA);
        const revision = await createRevision(partnerConn, writer, companyA, request, null, key, [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 1, isPriceBearing: true }]);
        await submitFullyReady(partnerConn, writer, companyA, request, revision, [1]);
        return { request, revision };
      } finally { await partnerConn.end(); }
    }

    const system = await systemClient();
    try {
      const { revision: queuedRevision } = await freshSubmittedRevision('evidence-queued');
      const queuedRun = await runCreate(system, queuedRevision);
      await expect(evidenceBind(system, queuedRun)).rejects.toThrow('VERIFY_EVIDENCE_BIND_NOT_ALLOWED');

      const { revision: completedRevision } = await freshSubmittedRevision('evidence-completed');
      const completedRun = await readyRun(system, completedRevision, [1]);
      await expect(evidenceBind(system, completedRun)).rejects.toThrow('VERIFY_EVIDENCE_BIND_NOT_ALLOWED');

      const { revision: failedRevision } = await freshSubmittedRevision('evidence-failed');
      const failedRun = await runCreate(system, failedRevision);
      await runStart(system, failedRun);
      await runFail(system, failedRun);
      await expect(evidenceBind(system, failedRun)).rejects.toThrow('VERIFY_EVIDENCE_BIND_NOT_ALLOWED');

      const { request: cancelledRequest, revision: cancelledRevision } = await freshSubmittedRevision('evidence-cancelled');
      const cancelledRun = await runCreate(system, cancelledRevision);
      const canceller = await client(writer, companyA);
      try { await canceller.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, cancelledRequest, id()]); } finally { await canceller.end(); }
      expect((await owner.query('SELECT status FROM verify_runs WHERE id=$1', [cancelledRun])).rows[0].status).toBe('CANCELLED');
      await expect(evidenceBind(system, cancelledRun)).rejects.toThrow('VERIFY_EVIDENCE_BIND_NOT_ALLOWED');

      const { revision: runningRevision } = await freshSubmittedRevision('evidence-running');
      const runningRun = await runCreate(system, runningRevision);
      await runStart(system, runningRun);
      const evidence = await evidenceBind(system, runningRun);
      expect((await owner.query('SELECT verify_run_id FROM verify_evidence_bindings WHERE id=$1', [evidence])).rows[0].verify_run_id).toBe(runningRun);
    } finally { await system.end(); }
  });

  it('P1: line-result recording is rejected outside RUNNING (QUEUED, COMPLETED, FAILED, CANCELLED)', async () => {
    async function freshSubmittedRevision(key: string) {
      const partnerConn = await client(writer, companyA);
      try {
        const request = await createRequest(partnerConn, writer, companyA);
        const revision = await createRevision(partnerConn, writer, companyA, request, null, key, [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 1, isPriceBearing: true }]);
        await submitFullyReady(partnerConn, writer, companyA, request, revision, [1]);
        return { request, revision };
      } finally { await partnerConn.end(); }
    }
    const { revision: queuedRevision } = await freshSubmittedRevision('line-queued');
    const { revision: completedRevision } = await freshSubmittedRevision('line-completed');
    const { revision: failedRevision } = await freshSubmittedRevision('line-failed');
    const { request: cancelledRequest, revision: cancelledRevision } = await freshSubmittedRevision('line-cancelled');

    const system = await systemClient();
    try {
      const queuedRun = await runCreate(system, queuedRevision);
      const queuedLine = (await lineIds(queuedRevision)).get(1)!;
      await expect(lineResultRecord(system, queuedRun, queuedLine, 'VERIFIED')).rejects.toThrow('VERIFY_LINE_RESULT_RUN_NOT_RUNNING');

      const completedLine = (await lineIds(completedRevision)).get(1)!;
      const completedRun = await readyRun(system, completedRevision, [1]);
      await expect(lineResultRecord(system, completedRun, completedLine, 'INSUFFICIENT_EVIDENCE')).rejects.toThrow('VERIFY_LINE_RESULT_RUN_NOT_RUNNING');

      const failedLine = (await lineIds(failedRevision)).get(1)!;
      const failedRun = await runCreate(system, failedRevision);
      await runStart(system, failedRun);
      await runFail(system, failedRun);
      await expect(lineResultRecord(system, failedRun, failedLine, 'VERIFIED')).rejects.toThrow('VERIFY_LINE_RESULT_RUN_NOT_RUNNING');

      const cancelledLine = (await lineIds(cancelledRevision)).get(1)!;
      const cancelledRun = await runCreate(system, cancelledRevision);
      const canceller = await client(writer, companyA);
      try { await canceller.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, cancelledRequest, id()]); } finally { await canceller.end(); }
      await expect(lineResultRecord(system, cancelledRun, cancelledLine, 'VERIFIED')).rejects.toThrow('VERIFY_LINE_RESULT_RUN_NOT_RUNNING');
    } finally { await system.end(); }
  });

  it('enforces one active QUEUED/RUNNING run per revision, including under concurrency, and retry-chain contention', async () => {
    const partner = await client(writer, companyA);
    let request: string; let revision: string;
    try {
      request = await createRequest(partner, writer, companyA);
      revision = await createRevision(partner, writer, companyA, request, null, 'one-active-run', [
        { lineNumber: 1, itemDescription: 'Line', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 10, isPriceBearing: true },
      ]);
      await submitFullyReady(partner, writer, companyA, request, revision, [1]);
    } finally { await partner.end(); }

    const systemA = await systemClient();
    const systemB = await systemClient();
    let firstRun: string;
    try {
      firstRun = await runCreate(systemA, revision!);
      await expect(runCreate(systemB, revision!)).rejects.toThrow(/VERIFY_RUN_ALREADY_ACTIVE|verify_runs_one_active_per_revision/);
    } finally { await systemA.end(); await systemB.end(); }

    // Retry-chain contention: fail the run, then two concurrent retries against the same revision — only one wins.
    const systemC = await systemClient();
    try {
      await runStart(systemC, firstRun!);
      await runFail(systemC, firstRun!);
    } finally { await systemC.end(); }

    const retryA = await systemClient();
    const retryB = await systemClient();
    try {
      const results = await Promise.allSettled([
        runCreate(retryA, revision!, 'verify-v0.1', 'retry-a', firstRun!),
        runCreate(retryB, revision!, 'verify-v0.1', 'retry-b', firstRun!),
      ]);
      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/VERIFY_RUN_ALREADY_ACTIVE|verify_runs_one_active_per_revision/);
    } finally { await retryA.end(); await retryB.end(); }
  });

  it('rejects VERIFIED/INSUFFICIENT_EVIDENCE on non-ready lines and EXCLUDED on ready lines, and enforces exactly one result per line', async () => {
    const partner = await client(writer, companyA);
    let request: string; let revision: string;
    try {
      request = await createRequest(partner, writer, companyA);
      revision = await createRevision(partner, writer, companyA, request, null, 'outcome-guard', [
        { lineNumber: 1, itemDescription: 'Ready', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 20, isPriceBearing: true },
        { lineNumber: 2, itemDescription: 'Will be marked not verifiable', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 20, isPriceBearing: true },
      ]);
      await submitFullyReady(partner, writer, companyA, request, revision, [1, 2]);
    } finally { await partner.end(); }
    const lines = await lineIds(revision!);
    const analystSetup = await internalClient(analyst, internalCompany);
    try {
      await analystSetup.query('SELECT internal_verify_quote_line_transition($1,$2,$3,$4,$5)', [analyst, lines.get(2), 'NOT_VERIFIABLE', 'became not verifiable pre-run', id()]);
    } finally { await analystSetup.end(); }

    const system = await systemClient();
    let run: string;
    try {
      run = await runCreate(system, revision!);
      await runStart(system, run);
      await expect(lineResultRecord(system, run, lines.get(2)!, 'VERIFIED')).rejects.toThrow('VERIFY_LINE_RESULT_NOT_READY');
      await lineResultRecord(system, run, lines.get(1)!, 'VERIFIED');
      await expect(lineResultRecord(system, run, lines.get(1)!, 'VERIFIED')).rejects.toThrow(/duplicate key|verify_line_results_verify_run_id_verify_quote_line_id_key/);
    } finally { await system.end(); }

    await expect(owner.query(`INSERT INTO verify_line_results(verify_run_id,verify_quote_line_id,outcome,exclusion_reason,created_by) VALUES($1,$2,'EXCLUDED','manual override',$3)`, [run!, lines.get(1), analyst]))
      .rejects.toThrow('VERIFY_LINE_RESULT_EXCLUSION_INVALID');
  });

  it('keeps line results, run scope, and evidence links immutable, and enforces same-run evidence binding', async () => {
    const partner = await client(writer, companyA);
    let request: string; let revision: string; let request2: string; let revision2: string;
    try {
      request = await createRequest(partner, writer, companyA);
      revision = await createRevision(partner, writer, companyA, request, null, 'immutability-a', [{ lineNumber: 1, itemDescription: 'A', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 5, isPriceBearing: true }]);
      await submitFullyReady(partner, writer, companyA, request, revision, [1]);
      request2 = await createRequest(partner, writer, companyA);
      revision2 = await createRevision(partner, writer, companyA, request2, null, 'immutability-b', [{ lineNumber: 1, itemDescription: 'B', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 5, isPriceBearing: true }]);
      await submitFullyReady(partner, writer, companyA, request2, revision2, [1]);
    } finally { await partner.end(); }
    const lineA = (await lineIds(revision!)).get(1)!;

    const system = await systemClient();
    let runA: string; let runB: string; let evidenceA: string; let evidenceB: string; let resultA: string;
    try {
      runA = await runCreate(system, revision!);
      runB = await runCreate(system, revision2!);
      await runStart(system, runA);
      await runStart(system, runB);
      evidenceA = await evidenceBind(system, runA, 'sha256:a');
      evidenceB = await evidenceBind(system, runB, 'sha256:b');
      resultA = await lineResultRecord(system, runA, lineA, 'VERIFIED', null, [evidenceA]);
      await expect(lineResultRecord(system, runB, (await lineIds(revision2!)).get(1)!, 'VERIFIED', null, [evidenceA]))
        .rejects.toThrow('VERIFY_LINE_RESULT_EVIDENCE_RUN_MISMATCH');
    } finally { await system.end(); }

    await expect(owner.query('UPDATE verify_line_results SET outcome=$1 WHERE id=$2', ['EXCLUDED', resultA!])).rejects.toThrow('VERIFY_HISTORY_IMMUTABLE');
    await expect(owner.query('DELETE FROM verify_run_line_scope WHERE verify_run_id=$1', [runA!])).rejects.toThrow('VERIFY_HISTORY_IMMUTABLE');
    await expect(owner.query('UPDATE verify_line_result_evidence SET verify_evidence_binding_id=$1 WHERE verify_line_result_id=$2', [evidenceB!, resultA!])).rejects.toThrow('VERIFY_HISTORY_IMMUTABLE');
    await expect(owner.query('UPDATE verify_evidence_bindings SET source_identity=$1 WHERE id=$2', ['tampered', evidenceA!])).rejects.toThrow('VERIFY_HISTORY_IMMUTABLE');
  });

  it('P1: exactly one VerifyResult per VerifyRun — repeated preparation and preparation races are rejected at the database level', async () => {
    const partner = await client(writer, companyA);
    let request: string; let revision: string;
    try {
      request = await createRequest(partner, writer, companyA);
      revision = await createRevision(partner, writer, companyA, request, null, 'one-result-per-run', [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 10, isPriceBearing: true }]);
      await submitFullyReady(partner, writer, companyA, request, revision, [1]);
    } finally { await partner.end(); }

    const system = await systemClient();
    let run: string;
    try {
      run = await readyRun(system, revision!, [1]);
    } finally { await system.end(); }

    const internal1 = await internalClient(analyst, internalCompany);
    try {
      await prepareComputed(internal1, analyst, run);
      await expect(prepareComputed(internal1, analyst, run)).rejects.toThrow(/duplicate key|verify_results_run_unique/);
    } finally { await internal1.end(); }

    // Same-run supersession is now structurally impossible: a second result row for the same run cannot exist at all.
    await expect(owner.query(`INSERT INTO verify_results(verify_run_id,methodology_version,classification,prepared_by) VALUES($1,'verify-v0.1','FULL',$2)`, [run!, analyst]))
      .rejects.toThrow(/duplicate key|verify_results_run_unique/);

    // Preparation race: two concurrent prepare attempts on a second run — exactly one succeeds.
    const partner2 = await client(writer, companyA);
    let request2: string; let revision2: string;
    try {
      request2 = await createRequest(partner2, writer, companyA);
      revision2 = await createRevision(partner2, writer, companyA, request2, null, 'prepare-race', [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 10, isPriceBearing: true }]);
      await submitFullyReady(partner2, writer, companyA, request2, revision2, [1]);
    } finally { await partner2.end(); }
    const system2 = await systemClient();
    let run2: string;
    try {
      run2 = await readyRun(system2, revision2!, [1]);
    } finally { await system2.end(); }
    const raceA = await internalClient(analyst, internalCompany);
    const raceB = await internalClient(analyst, internalCompany);
    try {
      const outcomes = await Promise.allSettled([prepareComputed(raceA, analyst, run2!), prepareComputed(raceB, analyst, run2!)]);
      const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/duplicate key|verify_results_run_unique/);
    } finally { await raceA.end(); await raceB.end(); }
  });

  it('P1/P2: computes deterministic per-currency coverage from immutable captured inputs (not live rows), and represents a zero denominator as 0, not NULL', async () => {
    const partner = await client(writer, companyA);

    // Case 1: FULL, including a legitimate zero-value line contributing zero to value coverage.
    let request: string; let revision: string;
    try {
      request = await createRequest(partner, writer, companyA);
      revision = await createRevision(partner, writer, companyA, request, null, 'classification-full', [
        { lineNumber: 1, itemDescription: 'Priced', quantity: 2, unitId, currencyCode: 'SAR', unitPrice: 100, isPriceBearing: true },
        { lineNumber: 2, itemDescription: 'Zero value', quantity: 3, unitId, currencyCode: 'SAR', unitPrice: 0, isPriceBearing: true, isRealZeroValue: true },
      ]);
      await submitFullyReady(partner, writer, companyA, request, revision, [1, 2]);
    } finally { /* keep partner open for next case */ }
    const linesFull = await lineIds(revision!);
    const system1 = await systemClient();
    let runFull: string;
    try {
      runFull = await runCreate(system1, revision!);
      await runStart(system1, runFull);
      await lineResultRecord(system1, runFull, linesFull.get(1)!, 'VERIFIED');
      await lineResultRecord(system1, runFull, linesFull.get(2)!, 'VERIFIED');
      await runComplete(system1, runFull);
    } finally { await system1.end(); }
    expect((await owner.query('SELECT status FROM verify_requests WHERE id=$1', [request!])).rows[0].status).toBe('IN_REVIEW');

    // P1 remediation proof: the computation function body itself never references the mutable source tables at all
    // (verify_quote_lines is additionally already fully immutable post-creation via the existing Batch 1-C trigger).
    const functionDefinition = (await owner.query(`SELECT pg_get_functiondef('public.internal_verify_result_prepare_computed(uuid,uuid,uuid,text)'::regprocedure) definition`)).rows[0].definition as string;
    expect(functionDefinition).not.toMatch(/(FROM|JOIN)\s+public\.verify_quote_line/i);

    const analystConn1 = await internalClient(analyst, internalCompany);
    let resultFull: string;
    try {
      resultFull = await prepareComputed(analystConn1, analyst, runFull);
    } finally { await analystConn1.end(); }
    const fullRow = (await owner.query('SELECT classification,per_currency_scopes FROM verify_results WHERE id=$1', [resultFull!])).rows[0];
    expect(fullRow.classification).toBe('FULL');
    expect(fullRow.per_currency_scopes.SAR).toEqual({
      totalLineCount: 2, verifiedLineCount: 2, excludedLineCount: 0, insufficientEvidenceLineCount: 0,
      lineCoveragePercent: 100, totalValue: 200, verifiedValue: 200, valueCoveragePercent: 100,
    });

    const approverConn1 = await internalClient(approver, internalCompany);
    try {
      await approverConn1.query('SELECT internal_verify_result_finalize($1,$2,$3)', [approver, resultFull, id()]);
    } finally { await approverConn1.end(); }
    expect((await owner.query('SELECT status,current_submitted_revision_id FROM verify_requests WHERE id=$1', [request!])).rows[0]).toEqual({ status: 'COMPLETED', current_submitted_revision_id: revision! });

    // Case 2: PARTIAL - one verified, one excluded (pre-run NOT_VERIFIABLE).
    const request2 = await createRequest(partner, writer, companyA);
    const revision2 = await createRevision(partner, writer, companyA, request2, null, 'classification-partial', [
      { lineNumber: 1, itemDescription: 'Verified', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 50, isPriceBearing: true },
      { lineNumber: 2, itemDescription: 'Excluded', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 30, isPriceBearing: true },
    ]);
    await submitFullyReady(partner, writer, companyA, request2, revision2, [1, 2]);
    const linesPartial = await lineIds(revision2);
    const analystConn2 = await internalClient(analyst, internalCompany);
    try {
      await analystConn2.query('SELECT internal_verify_quote_line_transition($1,$2,$3,$4,$5)', [analyst, linesPartial.get(2), 'NOT_VERIFIABLE', 'pending clarification', id()]);
    } finally { await analystConn2.end(); }
    const system2 = await systemClient();
    let runPartial: string;
    try {
      runPartial = await runCreate(system2, revision2);
      await runStart(system2, runPartial);
      await lineResultRecord(system2, runPartial, linesPartial.get(1)!, 'VERIFIED');
      await runComplete(system2, runPartial);
    } finally { await system2.end(); }
    const analystConn3 = await internalClient(analyst, internalCompany);
    let resultPartial: string;
    try {
      resultPartial = await prepareComputed(analystConn3, analyst, runPartial);
    } finally { await analystConn3.end(); }
    expect((await owner.query('SELECT classification FROM verify_results WHERE id=$1', [resultPartial])).rows[0].classification).toBe('PARTIAL');

    // Case 3: INSUFFICIENT_FOR_RESULT - informational-only quote (no applicable lines at all).
    const request3 = await createRequest(partner, writer, companyA);
    const revision3 = await createRevision(partner, writer, companyA, request3, null, 'classification-informational-only', [
      { lineNumber: 1, itemDescription: 'Note only', isPriceBearing: false, isInformational: true },
    ]);
    await partner.query('SELECT partner_verify_request_submit($1,$2,$3,$4,$5)', [writer, companyA, request3, revision3, id()]);
    const system3 = await systemClient();
    let runInsufficient: string;
    try {
      runInsufficient = await runCreate(system3, revision3);
      await runStart(system3, runInsufficient);
      await runComplete(system3, runInsufficient);
    } finally { await system3.end(); }
    const analystConn4 = await internalClient(analyst, internalCompany);
    let resultInsufficient: string;
    try {
      resultInsufficient = await prepareComputed(analystConn4, analyst, runInsufficient);
    } finally { await analystConn4.end(); }
    expect((await owner.query('SELECT classification,per_currency_scopes FROM verify_results WHERE id=$1', [resultInsufficient])).rows[0]).toEqual({ classification: 'INSUFFICIENT_FOR_RESULT', per_currency_scopes: {} });

    // Case 4: P2 — all-applicable-zero-value quote, fully verified: FULL with valueCoveragePercent deterministically 0, not null.
    const request4 = await createRequest(partner, writer, companyA);
    const revision4 = await createRevision(partner, writer, companyA, request4, null, 'all-zero-value', [
      { lineNumber: 1, itemDescription: 'Zero A', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 0, isPriceBearing: true, isRealZeroValue: true },
      { lineNumber: 2, itemDescription: 'Zero B', quantity: 2, unitId, currencyCode: 'SAR', unitPrice: 0, isPriceBearing: true, isRealZeroValue: true },
    ]);
    await submitFullyReady(partner, writer, companyA, request4, revision4, [1, 2]);
    const linesZero = await lineIds(revision4);
    const system4 = await systemClient();
    let runZero: string;
    try {
      runZero = await runCreate(system4, revision4);
      await runStart(system4, runZero);
      await lineResultRecord(system4, runZero, linesZero.get(1)!, 'VERIFIED');
      await lineResultRecord(system4, runZero, linesZero.get(2)!, 'VERIFIED');
      await runComplete(system4, runZero);
    } finally { await system4.end(); }
    const analystConn5 = await internalClient(analyst, internalCompany);
    let resultZero: string;
    try {
      resultZero = await prepareComputed(analystConn5, analyst, runZero);
    } finally { await analystConn5.end(); }
    const zeroRow = (await owner.query('SELECT classification,per_currency_scopes FROM verify_results WHERE id=$1', [resultZero])).rows[0];
    expect(zeroRow.classification).toBe('FULL');
    expect(zeroRow.per_currency_scopes.SAR).toEqual({
      totalLineCount: 2, verifiedLineCount: 2, excludedLineCount: 0, insufficientEvidenceLineCount: 0,
      lineCoveragePercent: 100, totalValue: 0, verifiedValue: 0, valueCoveragePercent: 0,
    });
    expect(zeroRow.per_currency_scopes.SAR.valueCoveragePercent).not.toBeNull();

    await partner.end();
  });

  it('computes independent per-currency coverage with no cross-currency aggregation, and excludes quote-level adjustments from value coverage', async () => {
    const partner = await client(writer, companyA);
    const request = await createRequest(partner, writer, companyA);
    const revisionResult = await partner.query(`SELECT partner_verify_revision_create($1,$2,$3,$4,$5::text[],$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12) revision_id`,
      [writer, companyA, request, null, ['SAR', 'USD'], JSON.stringify({}), null, null, 'mixed-fp-2', JSON.stringify([
        { lineNumber: 1, itemDescription: 'SAR verified', quantity: 2, unitId, currencyCode: 'SAR', unitPrice: 100, isPriceBearing: true },
        { lineNumber: 2, itemDescription: 'SAR excluded', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 40, isPriceBearing: true },
        { lineNumber: 3, itemDescription: 'USD verified', quantity: 1, unitId, currencyCode: 'USD', unitPrice: 50, isPriceBearing: true },
      ]), 'mixed-currency-multi', id()]);
    const multiRevision = revisionResult.rows[0].revision_id as string;
    const lines = await lineIds(multiRevision);
    for (const lineNumber of [1, 2, 3]) {
      await partner.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, lines.get(lineNumber), 'READY_FOR_VERIFICATION', null, id()]);
    }
    await owner.query('INSERT INTO verify_quote_line_adjustments(verify_quote_line_id,adjustment_type,amount,currency_code) VALUES($1,$2,$3,$4)', [lines.get(1), 'DISCOUNT', -20, 'SAR']);
    await owner.query('INSERT INTO verify_quote_level_adjustments(verify_quote_revision_id,adjustment_type,amount,currency_code) VALUES($1,$2,$3,$4)', [multiRevision, 'SHIPPING', 500, 'SAR']);
    await partner.query('SELECT partner_verify_request_submit($1,$2,$3,$4,$5)', [writer, companyA, request, multiRevision, id()]);
    const analystExclude = await internalClient(analyst, internalCompany);
    try {
      await analystExclude.query('SELECT internal_verify_quote_line_transition($1,$2,$3,$4,$5)', [analyst, lines.get(2), 'NOT_VERIFIABLE', 'mixed currency exclusion', id()]);
    } finally { await analystExclude.end(); }

    const system = await systemClient();
    let run: string;
    try {
      run = await runCreate(system, multiRevision);
      await runStart(system, run);
      await lineResultRecord(system, run, lines.get(1)!, 'VERIFIED');
      await lineResultRecord(system, run, lines.get(3)!, 'VERIFIED');
      await runComplete(system, run);
    } finally { await system.end(); }

    const internal = await internalClient(analyst, internalCompany);
    let resultId: string;
    try {
      resultId = await prepareComputed(internal, analyst, run!);
    } finally { await internal.end(); }
    const row = (await owner.query('SELECT per_currency_scopes FROM verify_results WHERE id=$1', [resultId])).rows[0];
    // Line 1: 2*100 - 20 (line-level discount) = 180. The 500 SHIPPING is quote-level and must be excluded entirely.
    expect(row.per_currency_scopes.SAR).toEqual({
      totalLineCount: 2, verifiedLineCount: 1, excludedLineCount: 1, insufficientEvidenceLineCount: 0,
      lineCoveragePercent: 50, totalValue: 220, verifiedValue: 180, valueCoveragePercent: expect.any(Number),
    });
    expect(row.per_currency_scopes.USD).toEqual({
      totalLineCount: 1, verifiedLineCount: 1, excludedLineCount: 0, insufficientEvidenceLineCount: 0,
      lineCoveragePercent: 100, totalValue: 50, verifiedValue: 50, valueCoveragePercent: 100,
    });
    await partner.end();
  });

  it('cannot complete a run with unresolved applicable lines, and requires PREPARED->FINAL through separate analyst/approver authorization', async () => {
    const partner = await client(writer, companyA);
    let request: string; let revision: string;
    try {
      request = await createRequest(partner, writer, companyA);
      revision = await createRevision(partner, writer, companyA, request, null, 'completeness-guard', [
        { lineNumber: 1, itemDescription: 'Line', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 10, isPriceBearing: true },
      ]);
      await submitFullyReady(partner, writer, companyA, request, revision, [1]);
    } finally { await partner.end(); }

    const system = await systemClient();
    let run: string;
    try {
      run = await runCreate(system, revision!);
      await runStart(system, run);
      await expect(runComplete(system, run)).rejects.toThrow('VERIFY_RUN_LINE_RESULTS_INCOMPLETE');
      await expect(system.query('SELECT internal_verify_result_prepare_computed($1,$2,$3,$4)', [analyst, run, null, id()])).rejects.toThrow(/permission denied/i);
      await expect(system.query('SELECT internal_verify_result_finalize($1,$2,$3)', [approver, run, id()])).rejects.toThrow(/permission denied/i);
    } finally { await system.end(); }
  });

  it('P2: lock order is consistent (request-before-run) across start/complete/fail/cancel — proves start-vs-cancel, complete-vs-fail, and cancel-vs-complete never deadlock', async () => {
    // start-vs-cancel: begin a QUEUED run's start inside an open transaction, race a concurrent cancel attempt.
    const partnerA = await client(writer, companyA);
    let requestA: string; let revisionA: string;
    try {
      requestA = await createRequest(partnerA, writer, companyA);
      revisionA = await createRevision(partnerA, writer, companyA, requestA, null, 'lock-start-vs-cancel', [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 1, isPriceBearing: true }]);
      await submitFullyReady(partnerA, writer, companyA, requestA, revisionA, [1]);
    } finally { /* keep open for run creation */ }
    const setupSystemA = await systemClient();
    let runA: string;
    try { runA = await runCreate(setupSystemA, revisionA!); } finally { await setupSystemA.end(); }

    const starter = await systemClient();
    const canceller = await client(writer, companyA);
    try {
      await starter.query('BEGIN');
      await starter.query('SELECT internal_verify_system_run_start($1,$2)', [runA, id()]);
      const pendingCancel = settled(canceller.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, requestA!, id()]));
      expect(await waitUntilLockBlocked()).toBe(true);
      await starter.query('COMMIT');
      expect(await pendingCancel).toBeNull();
    } finally { await starter.end(); await canceller.end(); await partnerA.end(); }
    // Run was started (RUNNING) before cancel's snapshot could complete, so cancel must have deferred to IN_REVIEW.
    expect(['RUNNING']).toContain((await owner.query('SELECT status FROM verify_runs WHERE id=$1', [runA!])).rows[0].status);
    expect(['IN_REVIEW', 'SUBMITTED']).toContain((await owner.query('SELECT status FROM verify_requests WHERE id=$1', [requestA!])).rows[0].status);

    // complete-vs-fail: a RUNNING run racing internal_verify_system_run_complete against internal_verify_system_run_fail — exactly one wins.
    const partnerB = await client(writer, companyA);
    let requestB: string; let revisionB: string;
    try {
      requestB = await createRequest(partnerB, writer, companyA);
      revisionB = await createRevision(partnerB, writer, companyA, requestB, null, 'lock-complete-vs-fail', [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 1, isPriceBearing: true }]);
      await submitFullyReady(partnerB, writer, companyA, requestB, revisionB, [1]);
    } finally { await partnerB.end(); }
    const setupSystemB = await systemClient();
    let runB: string;
    try {
      runB = await runCreate(setupSystemB, revisionB);
      await runStart(setupSystemB, runB);
      await lineResultRecord(setupSystemB, runB, (await lineIds(revisionB)).get(1)!, 'VERIFIED');
    } finally { await setupSystemB.end(); }
    const completer = await systemClient();
    const failer = await systemClient();
    try {
      const outcomes = await Promise.allSettled([runComplete(completer, runB), runFail(failer, runB)]);
      const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      expect(fulfilled.length).toBe(1);
      expect(['COMPLETED', 'FAILED']).toContain((await owner.query('SELECT status FROM verify_runs WHERE id=$1', [runB])).rows[0].status);
    } finally { await completer.end(); await failer.end(); }

    // cancellation-vs-completion: RUNNING run, request cancel races internal_verify_system_run_complete — no deadlock, consistent end-state.
    const partnerC = await client(writer, companyA);
    let requestC: string; let revisionC: string;
    try {
      requestC = await createRequest(partnerC, writer, companyA);
      revisionC = await createRevision(partnerC, writer, companyA, requestC, null, 'lock-cancel-vs-complete', [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 1, isPriceBearing: true }]);
      await submitFullyReady(partnerC, writer, companyA, requestC, revisionC, [1]);
    } finally { /* keep open */ }
    const setupSystemC = await systemClient();
    let runC: string;
    try {
      runC = await runCreate(setupSystemC, revisionC!);
      await runStart(setupSystemC, runC);
      await lineResultRecord(setupSystemC, runC, (await lineIds(revisionC!)).get(1)!, 'VERIFIED');
    } finally { await setupSystemC.end(); }
    const completerC = await systemClient();
    const cancellerC = await client(writer, companyA);
    try {
      const outcomes = await Promise.allSettled([runComplete(completerC, runC), cancellerC.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, requestC!, id()])]);
      // Both orderings are legitimate and prove no deadlock: either both succeed (cancel observed RUNNING and
      // deferred to IN_REVIEW before completion), or completion won the request-lock race first and cancel
      // then correctly refuses an already-IN_REVIEW request.
      const [completeOutcome, cancelOutcome] = outcomes;
      expect(completeOutcome.status).toBe('fulfilled');
      if (cancelOutcome.status === 'rejected') {
        expect((cancelOutcome as PromiseRejectedResult).reason.message).toBe('PARTNER_VERIFY_NOT_CANCELLABLE');
      }
    } finally { await completerC.end(); await cancellerC.end(); await partnerC.end(); }
    // No deadlock occurred (Promise.allSettled resolved); final request state is one of the valid consistent outcomes.
    expect(['IN_REVIEW', 'COMPLETED']).toContain((await owner.query('SELECT status FROM verify_requests WHERE id=$1', [requestC!])).rows[0].status);
  }, 60_000);

  it('P2: restores the Batch 1-C negative assertion — unauthorized direct runtime/internal DML cannot perform SUBMITTED -> IN_REVIEW (only the authorized SYSTEM gateway can)', async () => {
    const partner = await client(writer, companyA);
    let request: string; let revision: string;
    try {
      request = await createRequest(partner, writer, companyA);
      revision = await createRevision(partner, writer, companyA, request, null, 'direct-dml-denied', [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 1, isPriceBearing: true }]);
      await submitFullyReady(partner, writer, companyA, request, revision, [1]);
    } finally { await partner.end(); }

    const runtimeAttacker = await client(writer, companyA);
    const internalAttacker = await internalClient(analyst, internalCompany);
    try {
      await expect(runtimeAttacker.query(`UPDATE verify_requests SET status='IN_REVIEW' WHERE id=$1`, [request!])).rejects.toThrow(/permission denied/i);
      await expect(internalAttacker.query(`UPDATE verify_requests SET status='IN_REVIEW' WHERE id=$1`, [request!])).rejects.toThrow(/permission denied/i);
    } finally { await runtimeAttacker.end(); await internalAttacker.end(); }
    expect((await owner.query('SELECT status FROM verify_requests WHERE id=$1', [request!])).rows[0].status).toBe('SUBMITTED');

    // The authorized path (SYSTEM gateway completing a RUNNING run) still works.
    const system = await systemClient();
    try {
      const run = await runCreate(system, revision!);
      await runStart(system, run);
      await lineResultRecord(system, run, (await lineIds(revision!)).get(1)!, 'VERIFIED');
      await runComplete(system, run);
    } finally { await system.end(); }
    expect((await owner.query('SELECT status FROM verify_requests WHERE id=$1', [request!])).rows[0].status).toBe('IN_REVIEW');
  });

  it('applies section 13 cancellation semantics: QUEUED cancels atomically, RUNNING defers the request to IN_REVIEW', async () => {
    const partner1 = await client(writer, companyA);
    let requestQueued: string; let revisionQueued: string;
    try {
      requestQueued = await createRequest(partner1, writer, companyA);
      revisionQueued = await createRevision(partner1, writer, companyA, requestQueued, null, 'cancel-queued', [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 1, isPriceBearing: true }]);
      await submitFullyReady(partner1, writer, companyA, requestQueued, revisionQueued, [1]);
    } finally { /* keep open */ }
    const system1 = await systemClient();
    let runQueued: string;
    try {
      runQueued = await runCreate(system1, revisionQueued);
    } finally { await system1.end(); }
    await partner1.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, requestQueued, id()]);
    expect((await owner.query('SELECT status FROM verify_requests WHERE id=$1', [requestQueued])).rows[0].status).toBe('CANCELLED');
    expect((await owner.query('SELECT status FROM verify_runs WHERE id=$1', [runQueued])).rows[0].status).toBe('CANCELLED');

    let requestRunning: string; let revisionRunning: string;
    requestRunning = await createRequest(partner1, writer, companyA);
    revisionRunning = await createRevision(partner1, writer, companyA, requestRunning, null, 'cancel-running', [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 1, isPriceBearing: true }]);
    await submitFullyReady(partner1, writer, companyA, requestRunning, revisionRunning, [1]);
    const system2 = await systemClient();
    let runRunning: string;
    try {
      runRunning = await runCreate(system2, revisionRunning);
      await runStart(system2, runRunning);
    } finally { await system2.end(); }
    await partner1.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, requestRunning, id()]);
    expect((await owner.query('SELECT status FROM verify_requests WHERE id=$1', [requestRunning])).rows[0].status).toBe('IN_REVIEW');
    expect((await owner.query('SELECT status FROM verify_runs WHERE id=$1', [runRunning])).rows[0].status).toBe('RUNNING');
    await expect(partner1.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, requestRunning, id()])).rejects.toThrow('PARTNER_VERIFY_NOT_CANCELLABLE');

    await partner1.end();
  });

  it('allows a historical rerun on a non-current submitted revision without mutating the current request lifecycle', async () => {
    const partner = await client(writer, companyA);
    let request: string; let revisionOld: string; let revisionNew: string;
    try {
      request = await createRequest(partner, writer, companyA);
      revisionOld = await createRevision(partner, writer, companyA, request, null, 'historical-r1', [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 1, isPriceBearing: true }]);
      await submitFullyReady(partner, writer, companyA, request, revisionOld, [1]);
      revisionNew = await createRevision(partner, writer, companyA, request, revisionOld, 'historical-r2', [{ lineNumber: 1, itemDescription: 'L2', quantity: 2, unitId, currencyCode: 'SAR', unitPrice: 2, isPriceBearing: true }]);
      await submitFullyReady(partner, writer, companyA, request, revisionNew, [1]);
    } finally { await partner.end(); }
    const statusBeforeHistoricalRerun = (await owner.query('SELECT status,current_submitted_revision_id FROM verify_requests WHERE id=$1', [request!])).rows[0];
    expect(statusBeforeHistoricalRerun).toEqual({ status: 'SUBMITTED', current_submitted_revision_id: revisionNew! });

    const oldLine = (await lineIds(revisionOld!)).get(1)!;
    const system = await systemClient();
    let historicalRun: string; let historicalResult: string;
    try {
      historicalRun = await runCreate(system, revisionOld!);
      const created = (await owner.query(`SELECT metadata->>'historicalRerun' historical FROM audit_logs WHERE action='verify.run.created' AND entity_id=$1`, [historicalRun])).rows[0];
      expect(created.historical).toBe('true');
      await runStart(system, historicalRun);
      await lineResultRecord(system, historicalRun, oldLine, 'VERIFIED');
      await runComplete(system, historicalRun);
    } finally { await system.end(); }
    expect((await owner.query('SELECT status FROM verify_requests WHERE id=$1', [request!])).rows[0].status).toBe('SUBMITTED');

    const analystConn = await internalClient(analyst, internalCompany);
    try {
      historicalResult = await prepareComputed(analystConn, analyst, historicalRun);
    } finally { await analystConn.end(); }
    const approverConn = await internalClient(approver, internalCompany);
    try {
      await approverConn.query('SELECT internal_verify_result_finalize($1,$2,$3)', [approver, historicalResult, id()]);
    } finally { await approverConn.end(); }

    expect((await owner.query('SELECT status,current_submitted_revision_id FROM verify_requests WHERE id=$1', [request!])).rows[0]).toEqual({ status: 'SUBMITTED', current_submitted_revision_id: revisionNew! });
  });

  it('P2: pointer movement (new revision submission) concurrent with SYSTEM run creation/start on the prior revision does not corrupt state', async () => {
    const partner = await client(writer, companyA);
    let request: string; let revisionOld: string;
    try {
      request = await createRequest(partner, writer, companyA);
      revisionOld = await createRevision(partner, writer, companyA, request, null, 'pointer-race-r1', [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 1, isPriceBearing: true }]);
      await submitFullyReady(partner, writer, companyA, request, revisionOld, [1]);
    } finally { /* keep open */ }
    const revisionNew = await createRevision(partner, writer, companyA, request!, revisionOld!, 'pointer-race-r2', [{ lineNumber: 1, itemDescription: 'L2', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 2, isPriceBearing: true }]);
    const lineNew = (await lineIds(revisionNew)).get(1)!;
    await partner.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, lineNew, 'READY_FOR_VERIFICATION', null, id()]);

    const system = await systemClient();
    const submitter = client(writer, companyA);
    try {
      const [runOutcome, submitOutcome] = await Promise.allSettled([
        (async () => { const run = await runCreate(system, revisionOld!); await runStart(system, run); return run; })(),
        (async () => { const connection = await submitter; await connection.query('SELECT partner_verify_request_submit($1,$2,$3,$4,$5)', [writer, companyA, request, revisionNew, id()]); await connection.end(); })(),
      ]);
      expect(runOutcome.status).toBe('fulfilled');
      expect(submitOutcome.status).toBe('fulfilled');
    } finally { await system.end(); await partner.end(); }

    const finalRequestState = (await owner.query('SELECT status,current_submitted_revision_id FROM verify_requests WHERE id=$1', [request!])).rows[0];
    expect(finalRequestState).toEqual({ status: 'SUBMITTED', current_submitted_revision_id: revisionNew });
    expect((await owner.query('SELECT verify_quote_revision_id FROM verify_runs WHERE verify_quote_revision_id=$1', [revisionOld!])).rows[0].verify_quote_revision_id).toBe(revisionOld);
  });

  it('Zero Human Access: Analyst, Approver, and system-executor cannot read raw content, documents, or document versions directly', async () => {
    const partner = await client(writer, companyA);
    let request: string; let revision: string; let documentId: string; let versionId: string;
    try {
      documentId = id(); versionId = id();
      await owner.query(`INSERT INTO documents(id,company_id,filename,detected_mime_type,byte_size,storage_key,sha256,status) VALUES($1,$2,'raw.pdf','application/pdf',1,$3,'sha','AVAILABLE')`, [documentId, companyA, `verify/${documentId}`]);
      await owner.query('INSERT INTO document_versions(id,company_id,document_id,version,storage_key,sha256) VALUES($1,$2,$3,1,$4,\'sha\')', [versionId, companyA, documentId, `verify/${versionId}`]);
      request = await createRequest(partner, writer, companyA);
      revision = await createRevision(partner, writer, companyA, request, null, 'raw-access-denial', [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 1, isPriceBearing: true }]);
      await submitFullyReady(partner, writer, companyA, request, revision, [1]);
    } finally { await partner.end(); }

    const analystConn = await internalClient(analyst, internalCompany);
    const approverConn = await internalClient(approver, internalCompany);
    const system = await systemClient();
    try {
      await expect(analystConn.query('SELECT * FROM documents WHERE id=$1', [documentId!])).rejects.toThrow(/permission denied/i);
      await expect(analystConn.query('SELECT * FROM document_versions WHERE id=$1', [versionId!])).rejects.toThrow(/permission denied/i);
      await expect(approverConn.query('SELECT * FROM documents WHERE id=$1', [documentId!])).rejects.toThrow(/permission denied/i);
      await expect(approverConn.query('SELECT * FROM document_versions WHERE id=$1', [versionId!])).rejects.toThrow(/permission denied/i);
      await expect(system.query('SELECT * FROM documents WHERE id=$1', [documentId!])).rejects.toThrow(/permission denied/i);
      await expect(system.query('SELECT * FROM document_versions WHERE id=$1', [versionId!])).rejects.toThrow(/permission denied/i);
      await expect(system.query('SELECT * FROM verify_quote_revisions WHERE id=$1', [revision!])).rejects.toThrow(/permission denied/i);
      await expect(system.query('SELECT * FROM verify_raw_review_grants')).rejects.toThrow(/permission denied/i);
    } finally { await analystConn.end(); await approverConn.end(); await system.end(); }
  });

  it('denies direct RLS access to the new tables and preserves FORCE RLS, and confirms role attributes', async () => {
    const partner = await client(writer, companyA);
    let request: string; let revision: string;
    try {
      request = await createRequest(partner, writer, companyA);
      revision = await createRevision(partner, writer, companyA, request, null, 'rls-guard', [{ lineNumber: 1, itemDescription: 'L', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 1, isPriceBearing: true }]);
      await submitFullyReady(partner, writer, companyA, request, revision, [1]);
    } finally { await partner.end(); }
    const system = await systemClient();
    let run: string;
    try {
      run = await runCreate(system, revision!);
    } finally { await system.end(); }

    const foreign = await client(writer, companyB);
    try {
      await expect(foreign.query('SELECT * FROM verify_run_line_scope WHERE verify_run_id=$1', [run!])).rejects.toThrow(/permission denied/i);
      await expect(foreign.query('SELECT * FROM verify_line_results WHERE verify_run_id=$1', [run!])).rejects.toThrow(/permission denied/i);
      await expect(foreign.query('INSERT INTO verify_line_results(verify_run_id,verify_quote_line_id,outcome,created_by) VALUES($1,$2,\'VERIFIED\',$3)', [run!, id(), writer])).rejects.toThrow(/permission denied/i);
    } finally { await foreign.end(); }

    const tables = await owner.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('verify_run_line_scope','verify_line_results','verify_line_result_evidence') AND relkind='r'`);
    expect(tables.rows.length).toBe(3);
    expect(tables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const systemRoleGrants = await owner.query(`SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolinherit FROM pg_roles WHERE rolname IN ('sco_verify_system_executor','sco_verify_gateway_owner')`);
    const byName = new Map(systemRoleGrants.rows.map((row) => [row.rolname, row]));
    expect(byName.get('sco_verify_gateway_owner')).toEqual({ rolname: 'sco_verify_gateway_owner', rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolinherit: false });
    expect(byName.get('sco_verify_system_executor')).toEqual({ rolname: 'sco_verify_system_executor', rolcanlogin: true, rolsuper: false, rolbypassrls: false, rolinherit: false });

    const resultUnique = await owner.query(`SELECT conname FROM pg_constraint WHERE conname='verify_results_run_unique'`);
    expect(resultUnique.rows.length).toBe(1);
  });
});
