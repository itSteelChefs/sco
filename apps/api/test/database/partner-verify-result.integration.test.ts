import { randomUUID } from 'node:crypto';
import { Client, Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PartnerVerifyService } from '../../src/modules/verify/partner-verify.service.js';
import { TenantTransactionService } from '../../src/database/tenant-transaction.service.js';
import { PartnerCompanyGuard } from '../../src/common/tenant/partner-company.guard.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();

let companyA: string; let companyB: string; let internalCompany: string; let unitId: string;
let writer: string; let reader: string; let suspendedReader: string; let revokedReader: string;
let noPermissionUser: string; let scoActor: string; let inactiveCompanyUser: string; let otherPartnerReader: string; let otherPartnerWriter: string;
let analyst: string; let approver: string;

async function grant(userId: string, companyId: string, code: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, companyId])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, companyId, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), companyId, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), companyId, role, code]);
}

async function runtimeClient(actor: string, tenant: string) {
  const connection = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
  await connection.connect();
  await connection.query(`SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false)`, [actor, tenant]);
  return connection;
}

async function systemClient() {
  const connection = new Client({ connectionString: process.env.VERIFY_SYSTEM_DATABASE_URL });
  await connection.connect();
  return connection;
}

async function internalClient(actor: string, tenant: string) {
  const connection = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
  await connection.connect();
  await connection.query(`SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false)`, [actor, tenant]);
  return connection;
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

async function runCreate(system: Client, revision: string, methodology = 'verify-v0.1', fingerprint = `ev-${id()}`, retryOf: string | null = null) {
  return (await system.query('SELECT internal_verify_system_run_create($1,$2,$3,$4,$5) run_id', [revision, methodology, fingerprint, retryOf, id()])).rows[0].run_id as string;
}
async function runStart(system: Client, run: string) { await system.query('SELECT internal_verify_system_run_start($1,$2)', [run, id()]); }
async function runComplete(system: Client, run: string) { await system.query('SELECT internal_verify_system_run_complete($1,$2)', [run, id()]); }
async function lineResultRecord(system: Client, run: string, line: string, outcome: string, reason: string | null = null) {
  await system.query('SELECT internal_verify_system_line_result_record($1,$2,$3,$4,$5,$6) result_id', [run, line, outcome, reason, null, id()]);
}
async function prepareComputed(internal: Client, actor: string, run: string, supersedes: string | null = null) {
  const result = await internal.query('SELECT internal_verify_result_prepare_computed($1,$2,$3,$4) result_id', [actor, run, supersedes, id()]);
  return result.rows[0].result_id as string;
}
async function finalize(internal: Client, actor: string, result: string) {
  await internal.query('SELECT internal_verify_result_finalize($1,$2,$3)', [actor, result, id()]);
}

// End-to-end happy path fixture, reusing the established Batch 1-C/1-D gateway chain exactly (no new lifecycle).
async function buildFinalResult(company: string, actor: string, classification: 'FULL' | 'PARTIAL') {
  const partner = await runtimeClient(actor, company);
  let request: string; let revision: string;
  try {
    request = await createRequest(partner, actor, company);
    const lines = classification === 'FULL'
      ? [{ lineNumber: 1, itemDescription: 'Priced', quantity: 2, unitId, currencyCode: 'SAR', unitPrice: 100, isPriceBearing: true }]
      : [
          { lineNumber: 1, itemDescription: 'Verified', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 50, isPriceBearing: true },
          { lineNumber: 2, itemDescription: 'Excluded', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 30, isPriceBearing: true },
        ];
    revision = await createRevision(partner, actor, company, request, null, `key-${id()}`, lines);
    await submitFullyReady(partner, actor, company, request, revision, classification === 'FULL' ? [1] : [1, 2]);
  } finally { await partner.end(); }

  const resolvedLines = await lineIds(revision!);
  const system = await systemClient();
  let run: string;
  try {
    run = await runCreate(system, revision!);
    await runStart(system, run);
    await lineResultRecord(system, run, resolvedLines.get(1)!, 'VERIFIED');
    if (classification === 'PARTIAL') await lineResultRecord(system, run, resolvedLines.get(2)!, 'INSUFFICIENT_EVIDENCE');
    await runComplete(system, run);
  } finally { await system.end(); }

  const internal = await internalClient(analyst, internalCompany);
  let result: string;
  try {
    result = await prepareComputed(internal, analyst, run!);
  } finally { await internal.end(); }

  const approverConn = await internalClient(approver, internalCompany);
  try { await finalize(approverConn, approver, result!); } finally { await approverConn.end(); }

  return { request: request!, revision: revision!, run: run!, result: result! };
}

// Minimal RuntimeDatabaseService-compatible adapter over a real sco_runtime connection (mirrors the SR-01/SR-02
// test's pattern), so PartnerVerifyService runs against genuine Postgres RLS/gateway authorization, not a mock.
class RealRuntimeDatabase {
  async withActor<T>(actorUserId: string, cb: (client: PoolClient) => Promise<T>): Promise<T> {
    const runtimePool = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
    const client = await runtimePool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.actor_id', $1, true)", [actorUserId]);
      const result = await cb(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      await runtimePool.end();
    }
  }
  async query(sql: string, values: unknown[] = []) {
    const runtimePool = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
    try { return await runtimePool.query(sql, values); } finally { await runtimePool.end(); }
  }
}

describe('Verify V0.1 Batch 1-E Partner-facing Verify Result', () => {
  beforeAll(async () => {
    companyA = id(); companyB = id(); internalCompany = id(); unitId = id();
    writer = id(); reader = id(); suspendedReader = id(); revokedReader = id();
    noPermissionUser = id(); scoActor = id(); inactiveCompanyUser = id(); otherPartnerReader = id(); otherPartnerWriter = id();
    analyst = id(); approver = id();

    await owner.query(
      `INSERT INTO "Company"(id,name,type) VALUES($1,'Verify 1-E Partner A','PARTNER'),($2,'Verify 1-E Partner B','PARTNER'),($3,'Verify 1-E Internal','SCO')`,
      [companyA, companyB, internalCompany],
    );
    await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,\'Each\',\'count\')', [unitId, `verify-1e-unit-${unitId}`]);

    const users = [writer, reader, suspendedReader, revokedReader, noPermissionUser, scoActor, inactiveCompanyUser, otherPartnerReader, otherPartnerWriter, analyst, approver];
    await owner.query(`INSERT INTO "User"(id,email,"passwordHash") SELECT value::uuid, value || '@verify-1e.test', 'x' FROM unnest($1::text[]) value`, [users]);

    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), writer, companyA]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), reader, companyA]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'SUSPENDED\')', [id(), suspendedReader, companyA]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'REVOKED\')', [id(), revokedReader, companyA]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), noPermissionUser, companyA]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), scoActor, internalCompany]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), otherPartnerReader, companyB]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), otherPartnerWriter, companyB]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), analyst, internalCompany]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), approver, internalCompany]);

    // inactiveCompanyUser: ACTIVE membership, but its own company is suspended.
    const inactiveCompany = id();
    await owner.query(`INSERT INTO "Company"(id,name,type,status) VALUES($1,'Verify 1-E Inactive Partner','PARTNER','SUSPENDED')`, [inactiveCompany]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), inactiveCompanyUser, inactiveCompany]);
    await grant(inactiveCompanyUser, inactiveCompany, 'partner_verify.read');

    await grant(writer, companyA, 'partner_verify.write');
    await grant(reader, companyA, 'partner_verify.read');
    await grant(suspendedReader, companyA, 'partner_verify.read');
    await grant(revokedReader, companyA, 'partner_verify.read');
    await grant(scoActor, internalCompany, 'partner_verify.read');
    await grant(otherPartnerReader, companyB, 'partner_verify.read');
    await grant(otherPartnerWriter, companyB, 'partner_verify.write');
    await grant(analyst, internalCompany, 'verify.analyst');
    await grant(approver, internalCompany, 'verify.approver');
  });

  afterAll(async () => { await owner.end(); });

  describe('positive: authorized Partner can retrieve its own authorized FINAL result', () => {
    it('1: Partner A with partner_verify.read retrieves its authorized FULL result via the gateway', async () => {
      const { request, revision, run, result } = await buildFinalResult(companyA, writer, 'FULL');
      const partner = await runtimeClient(reader, companyA);
      try {
        const row = (await partner.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [reader, companyA, request])).rows[0];
        expect(row).toMatchObject({ request_id: request, revision_id: revision, run_id: run, result_id: result, status: 'FINAL', classification: 'FULL' });
        expect(row.finalized_at).toBeTruthy();
      } finally { await partner.end(); }
    });

    it('via PartnerVerifyService (real TS service, real DB): response top-level keys match the explicit allowlist exactly', async () => {
      const { request } = await buildFinalResult(companyA, writer, 'FULL');
      const service = new PartnerVerifyService(new TenantTransactionService(new RealRuntimeDatabase() as never));
      const dto = await service.getResult({ membershipId: id(), userId: reader, companyId: companyA, status: 'ACTIVE' }, request);
      expect(Object.keys(dto).sort()).toEqual(['classification', 'coverage', 'finalizedAt', 'requestId', 'resultId', 'revisionId', 'runId', 'status'].sort());
      expect(Object.keys(dto.coverage[0]).sort()).toEqual(['currency', 'excludedLineCount', 'insufficientLineCount', 'lineCoveragePercent', 'totalLineCount', 'valueCoveragePercent', 'verifiedLineCount'].sort());
      const noConfidential = JSON.stringify(dto).toLowerCase();
      for (const forbidden of ['supplier', 'purchase_source', 'purchasesource', 'evidence', 'negotiation', 'confidence', 'variance', 'raw', 'fingerprint', 'audit']) {
        expect(noConfidential).not.toMatch(forbidden);
      }
    });

    it('does not recalculate the authoritative result: DTO values are a direct pass-through of verify_results/per_currency_scopes', async () => {
      const { request, result } = await buildFinalResult(companyA, writer, 'PARTIAL');
      const service = new PartnerVerifyService(new TenantTransactionService(new RealRuntimeDatabase() as never));
      const dto = await service.getResult({ membershipId: id(), userId: reader, companyId: companyA, status: 'ACTIVE' }, request);
      const authoritative = (await owner.query('SELECT classification, per_currency_scopes FROM verify_results WHERE id=$1', [result])).rows[0];
      expect(dto.classification).toBe(authoritative.classification);
      expect(dto.classification).toBe('PARTIAL');
      const sar = authoritative.per_currency_scopes.SAR;
      expect(dto.coverage).toEqual([{
        currency: 'SAR', totalLineCount: sar.totalLineCount, verifiedLineCount: sar.verifiedLineCount,
        excludedLineCount: sar.excludedLineCount, insufficientLineCount: sar.insufficientEvidenceLineCount,
        lineCoveragePercent: sar.lineCoveragePercent, valueCoveragePercent: sar.valueCoveragePercent,
      }]);
    });

    it('23: PARTIAL remains explicitly PARTIAL, never conflated with FULL', async () => {
      const { request } = await buildFinalResult(companyA, writer, 'PARTIAL');
      const partner = await runtimeClient(reader, companyA);
      try {
        const row = (await partner.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [reader, companyA, request])).rows[0];
        expect(row.classification).toBe('PARTIAL');
        expect(row.classification).not.toBe('FULL');
      } finally { await partner.end(); }
    });
  });

  describe('adversarial: authorization boundaries', () => {
    it('2: Partner A cannot retrieve Partner B\'s result through a foreign request ID', async () => {
      const { request } = await buildFinalResult(companyB, otherPartnerWriter, 'FULL');
      const partner = await runtimeClient(reader, companyA);
      try {
        const rows = (await partner.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [reader, companyA, request])).rows;
        expect(rows).toEqual([]);
      } finally { await partner.end(); }
    });

    it('3: suspended membership is denied', async () => {
      const { request } = await buildFinalResult(companyA, writer, 'FULL');
      const partner = await runtimeClient(suspendedReader, companyA);
      try { await expect(partner.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [suspendedReader, companyA, request])).rejects.toThrow('PARTNER_VERIFY_READ_FORBIDDEN'); }
      finally { await partner.end(); }
    });

    it('4: revoked membership is denied', async () => {
      const { request } = await buildFinalResult(companyA, writer, 'FULL');
      const partner = await runtimeClient(revokedReader, companyA);
      try { await expect(partner.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [revokedReader, companyA, request])).rejects.toThrow('PARTNER_VERIFY_READ_FORBIDDEN'); }
      finally { await partner.end(); }
    });

    it('5: inactive company is denied even with an ACTIVE membership and the permission', async () => {
      const partner = await runtimeClient(inactiveCompanyUser, companyA);
      try {
        const inactiveCompanyRow = (await owner.query('SELECT "companyId" FROM "CompanyMembership" WHERE "userId"=$1', [inactiveCompanyUser])).rows[0].companyId as string;
        await partner.query("SELECT set_config('app.tenant_id',$1,false)", [inactiveCompanyRow]);
        await expect(partner.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [inactiveCompanyUser, inactiveCompanyRow, id()])).rejects.toThrow('PARTNER_VERIFY_READ_FORBIDDEN');
      } finally { await partner.end(); }
    });

    it('6: a non-PARTNER company (SCO) actor is denied even with partner_verify.read granted', async () => {
      const partner = await runtimeClient(scoActor, internalCompany);
      try { await expect(partner.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [scoActor, internalCompany, id()])).rejects.toThrow('PARTNER_VERIFY_READ_FORBIDDEN'); }
      finally { await partner.end(); }
    });

    it('7: missing partner_verify.read is denied for an otherwise-active Partner member', async () => {
      const { request } = await buildFinalResult(companyA, writer, 'FULL');
      const partner = await runtimeClient(noPermissionUser, companyA);
      try { await expect(partner.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [noPermissionUser, companyA, request])).rejects.toThrow('PARTNER_VERIFY_READ_FORBIDDEN'); }
      finally { await partner.end(); }
    });

    it('8: a client-supplied tenant/company mismatch against the actor\'s real GUC context cannot bypass authorization', async () => {
      const { request } = await buildFinalResult(companyA, writer, 'FULL');
      const partner = await runtimeClient(reader, companyA);
      try {
        // GUCs say companyA, but the caller passes companyB as p_company — cross-check must reject, not silently scope to companyA.
        await expect(partner.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [reader, companyB, request])).rejects.toThrow('PARTNER_VERIFY_READ_FORBIDDEN');
      } finally { await partner.end(); }
    });

    it('9: app.sco_internal spoofing does not bypass Partner authorization', async () => {
      const { request } = await buildFinalResult(companyA, writer, 'FULL');
      const partner = await runtimeClient(noPermissionUser, companyA);
      try {
        await partner.query("SELECT set_config('app.sco_internal','true',false)");
        await expect(partner.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [noPermissionUser, companyA, request])).rejects.toThrow('PARTNER_VERIFY_READ_FORBIDDEN');
      } finally { await partner.end(); }
    });

    it('10: a DRAFT/intermediate (not COMPLETED) request is denied', async () => {
      const partner = await runtimeClient(writer, companyA);
      let request: string;
      try {
        request = await createRequest(partner, writer, companyA);
        await createRevision(partner, writer, companyA, request, null, `draft-${id()}`, [{ lineNumber: 1, itemDescription: 'x', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 10, isPriceBearing: true }]);
      } finally { /* still SUBMITTED at most, never COMPLETED */ }
      const reading = await runtimeClient(reader, companyA);
      try { expect((await reading.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [reader, companyA, request!])).rows).toEqual([]); }
      finally { await reading.end(); await partner.end(); }
    });

    it('11: a historical (non-current) revision\'s result is denied -- moving the request\'s pointer to a new revision before finalization means finalizing the old revision\'s run can never mark the request COMPLETED', async () => {
      const partner = await runtimeClient(writer, companyA);
      let request: string; let revisionOld: string; let revisionNew: string;
      try {
        request = await createRequest(partner, writer, companyA);
        revisionOld = await createRevision(partner, writer, companyA, request, null, `old-${id()}`, [{ lineNumber: 1, itemDescription: 'x', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 10, isPriceBearing: true }]);
        await submitFullyReady(partner, writer, companyA, request, revisionOld, [1]);
        revisionNew = await createRevision(partner, writer, companyA, request, revisionOld, `new-${id()}`, [{ lineNumber: 1, itemDescription: 'y', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 20, isPriceBearing: true }]);
        await submitFullyReady(partner, writer, companyA, request, revisionNew, [1]);
      } finally { await partner.end(); }
      expect((await owner.query('SELECT current_submitted_revision_id FROM verify_requests WHERE id=$1', [request!])).rows[0].current_submitted_revision_id).toBe(revisionNew!);

      const oldLine = (await lineIds(revisionOld!)).get(1)!;
      const system = await systemClient();
      let historicalRun: string;
      try {
        historicalRun = await runCreate(system, revisionOld!);
        await runStart(system, historicalRun);
        await lineResultRecord(system, historicalRun, oldLine, 'VERIFIED');
        await runComplete(system, historicalRun);
      } finally { await system.end(); }
      const internal = await internalClient(analyst, internalCompany);
      let historicalResult: string;
      try { historicalResult = await prepareComputed(internal, analyst, historicalRun!); } finally { await internal.end(); }
      const approverConn = await internalClient(approver, internalCompany);
      try { await finalize(approverConn, approver, historicalResult!); } finally { await approverConn.end(); }

      // Finalizing the historical (non-current) revision's result never completes the request.
      expect((await owner.query('SELECT status FROM verify_requests WHERE id=$1', [request!])).rows[0].status).not.toBe('COMPLETED');
      const reading = await runtimeClient(reader, companyA);
      try { expect((await reading.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [reader, companyA, request!])).rows).toEqual([]); }
      finally { await reading.end(); }
    });

    it('12: a SUPERSEDED result is denied (only the newer FINAL result is ever returned)', async () => {
      const { request, revision, result: firstResult } = await buildFinalResult(companyA, writer, 'FULL');
      const system = await systemClient();
      let retryRun: string;
      try {
        retryRun = await runCreate(system, revision, 'verify-v0.1', `ev-retry-${id()}`, null);
        await runStart(system, retryRun);
        const lines = await lineIds(revision);
        await lineResultRecord(system, retryRun, lines.get(1)!, 'VERIFIED');
        await runComplete(system, retryRun);
      } finally { await system.end(); }
      const internal = await internalClient(analyst, internalCompany);
      let secondResult: string;
      try { secondResult = await prepareComputed(internal, analyst, retryRun!, firstResult); } finally { await internal.end(); }
      const approverConn = await internalClient(approver, internalCompany);
      try {
        await finalize(approverConn, approver, secondResult!);
        await approverConn.query('SELECT internal_verify_result_supersede($1,$2,$3,$4)', [approver, firstResult, secondResult!, id()]);
      } finally { await approverConn.end(); }

      expect((await owner.query('SELECT status FROM verify_results WHERE id=$1', [firstResult])).rows[0].status).toBe('SUPERSEDED');
      const reading = await runtimeClient(reader, companyA);
      try {
        const row = (await reading.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [reader, companyA, request])).rows[0];
        expect(row.result_id).toBe(secondResult!);
        expect(row.result_id).not.toBe(firstResult);
      } finally { await reading.end(); }
    });

    it('13: an incomplete/non-COMPLETED run (RUNNING) is denied', async () => {
      const partner = await runtimeClient(writer, companyA);
      let request: string; let revision: string;
      try {
        request = await createRequest(partner, writer, companyA);
        revision = await createRevision(partner, writer, companyA, request, null, `running-${id()}`, [{ lineNumber: 1, itemDescription: 'x', quantity: 1, unitId, currencyCode: 'SAR', unitPrice: 10, isPriceBearing: true }]);
        await submitFullyReady(partner, writer, companyA, request, revision, [1]);
      } finally { await partner.end(); }
      const system = await systemClient();
      try { const run = await runCreate(system, revision!); await runStart(system, run); } finally { await system.end(); }
      const reading = await runtimeClient(reader, companyA);
      try { expect((await reading.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [reader, companyA, request!])).rows).toEqual([]); }
      finally { await reading.end(); }
    });

    it('P1-02: two independently FINAL, unreconciled results for the same current revision are ambiguous -- the gateway must fail closed and choose neither, then become unambiguous once the existing supersession lifecycle reconciles them', async () => {
      const { request, revision, result: firstResult } = await buildFinalResult(companyA, writer, 'FULL');

      // A second independent completed run on the SAME current revision, finalized to FINAL without ever calling
      // internal_verify_result_supersede. Both firstResult and secondResult are now simultaneously FINAL.
      // (Not a retry_of_run_id chain: that linkage is reserved for retrying a FAILED run, which firstRun is not.)
      const system = await systemClient();
      let retryRun: string;
      try {
        retryRun = await runCreate(system, revision, 'verify-v0.1', `ev-ambiguous-${id()}`, null);
        await runStart(system, retryRun);
        const lines = await lineIds(revision);
        await lineResultRecord(system, retryRun, lines.get(1)!, 'VERIFIED');
        await runComplete(system, retryRun);
      } finally { await system.end(); }
      const internal = await internalClient(analyst, internalCompany);
      let secondResult: string;
      try { secondResult = await prepareComputed(internal, analyst, retryRun!, firstResult); } finally { await internal.end(); }
      const approverConn1 = await internalClient(approver, internalCompany);
      try { await finalize(approverConn1, approver, secondResult!); } finally { await approverConn1.end(); }

      const bothFinal = await owner.query('SELECT id, status FROM verify_results WHERE id = ANY($1::uuid[]) ORDER BY id', [[firstResult, secondResult!]]);
      expect(bothFinal.rows.every((row) => row.status === 'FINAL')).toBe(true);

      // Ambiguous: the gateway must return zero rows -- not firstResult, not secondResult, not an error revealing
      // that a candidate exists at all. Same empty shape as a genuinely nonexistent/not-yet-completed request.
      const reading = await runtimeClient(reader, companyA);
      try { expect((await reading.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [reader, companyA, request])).rows).toEqual([]); }
      finally { await reading.end(); }

      // Reconcile using the EXISTING approved supersession lifecycle only -- no invented rule, no new pointer.
      const approverConn2 = await internalClient(approver, internalCompany);
      try { await approverConn2.query('SELECT internal_verify_result_supersede($1,$2,$3,$4)', [approver, firstResult, secondResult!, id()]); } finally { await approverConn2.end(); }

      const reading2 = await runtimeClient(reader, companyA);
      try {
        const row = (await reading2.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [reader, companyA, request])).rows[0];
        expect(row.result_id).toBe(secondResult!);
      } finally { await reading2.end(); }
    });
  });

  describe('SECURITY OWNERSHIP TESTS: sco_verify_partner_read_owner boundary (P1-01)', () => {
    const functions = ['partner_verify_read_allowed(uuid,uuid)', 'verify_partner_read_authorized(uuid,uuid)', 'partner_verify_result_get(uuid,uuid,uuid)'];

    it('1: every Batch 1-E SECURITY DEFINER function is owned by sco_verify_partner_read_owner', async () => {
      const result = await owner.query<{ proname: string; owner: string; prosecdef: boolean }>(
        `SELECT p.proname, o.rolname AS owner, p.prosecdef
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles o ON o.oid = p.proowner
         WHERE n.nspname = 'public' AND p.proname IN ('partner_verify_read_allowed','verify_partner_read_authorized','partner_verify_result_get')`,
      );
      expect(result.rows).toHaveLength(3);
      for (const row of result.rows) { expect(row.owner).toBe('sco_verify_partner_read_owner'); expect(row.prosecdef).toBe(true); }
    });

    it('2: the owner role cannot login, is not superuser, has no BYPASSRLS/CREATEDB/CREATEROLE, and is NOINHERIT', async () => {
      const result = await owner.query<{ rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolinherit: boolean }>(
        `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit FROM pg_roles WHERE rolname = 'sco_verify_partner_read_owner'`,
      );
      expect(result.rows[0]).toEqual({ rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false });
    });

    it('3/4: the owner has only SELECT (no INSERT/UPDATE/DELETE) on every table its functions touch', async () => {
      const tables = ['"User"', '"Company"', '"Permission"', '"CompanyMembership"', '"MembershipRole"', '"RolePermission"', 'verify_requests', 'verify_quote_revisions', 'verify_runs', 'verify_results'];
      const result = await owner.query<{ table_name: string; has_select: boolean; has_insert: boolean; has_update: boolean; has_delete: boolean }>(
        `SELECT t.table_name,
                has_table_privilege('sco_verify_partner_read_owner', t.table_name, 'SELECT') AS has_select,
                has_table_privilege('sco_verify_partner_read_owner', t.table_name, 'INSERT') AS has_insert,
                has_table_privilege('sco_verify_partner_read_owner', t.table_name, 'UPDATE') AS has_update,
                has_table_privilege('sco_verify_partner_read_owner', t.table_name, 'DELETE') AS has_delete
         FROM unnest($1::text[]) AS t(table_name)`,
        [tables],
      );
      expect(result.rows).toHaveLength(tables.length);
      for (const row of result.rows) {
        expect(row.has_select).toBe(true);
        expect(row).toMatchObject({ has_insert: false, has_update: false, has_delete: false });
      }
    });

    it('no policy for the owner is FOR ALL or an unconditional cross-tenant USING(true)', async () => {
      const result = await owner.query<{ tablename: string; cmd: string; qual: string | null }>(
        `SELECT tablename, cmd, qual FROM pg_policies WHERE roles::text[] @> ARRAY['sco_verify_partner_read_owner']`,
      );
      expect(result.rows.length).toBeGreaterThan(0);
      for (const row of result.rows) {
        expect(row.cmd).not.toBe('ALL');
        expect((row.qual ?? '').trim()).not.toBe('true');
      }
    });

    it('5/6: PUBLIC cannot execute any of the three functions; sco_runtime can execute only the outer partner_verify_result_get gateway', async () => {
      const result = await owner.query<{ fn: string; public_exec: boolean; runtime_exec: boolean }>(
        `SELECT t.fn,
                has_function_privilege('public', ('public.' || t.fn)::regprocedure, 'EXECUTE') AS public_exec,
                has_function_privilege('sco_runtime', ('public.' || t.fn)::regprocedure, 'EXECUTE') AS runtime_exec
         FROM unnest($1::text[]) AS t(fn)`,
        [functions],
      );
      for (const row of result.rows) {
        expect(row.public_exec).toBe(false);
        expect(row.runtime_exec).toBe(row.fn === 'partner_verify_result_get(uuid,uuid,uuid)');
      }
    });

    it('7: sco_runtime receives no new direct SELECT/INSERT/UPDATE/DELETE on any Verify table from this migration', async () => {
      const tables = ['verify_requests', 'verify_quote_revisions', 'verify_runs', 'verify_results'];
      const result = await owner.query<{ table_name: string; has_select: boolean; has_insert: boolean; has_update: boolean; has_delete: boolean }>(
        `SELECT t.table_name,
                has_table_privilege('sco_runtime', t.table_name, 'SELECT') AS has_select,
                has_table_privilege('sco_runtime', t.table_name, 'INSERT') AS has_insert,
                has_table_privilege('sco_runtime', t.table_name, 'UPDATE') AS has_update,
                has_table_privilege('sco_runtime', t.table_name, 'DELETE') AS has_delete
         FROM unnest($1::text[]) AS t(table_name)`,
        [tables],
      );
      for (const row of result.rows) expect(row).toEqual({ table_name: row.table_name, has_select: false, has_insert: false, has_update: false, has_delete: false });
    });

    it('8: cross-tenant access still fails through the new ownership boundary', async () => {
      const { request } = await buildFinalResult(companyA, writer, 'FULL');
      const partner = await runtimeClient(reader, companyA);
      try { await expect(partner.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [reader, companyB, request])).rejects.toThrow('PARTNER_VERIFY_READ_FORBIDDEN'); }
      finally { await partner.end(); }
    });

    it('9: app.sco_internal spoofing still fails through the new ownership boundary', async () => {
      const partner = await runtimeClient(noPermissionUser, companyA);
      try {
        await partner.query("SELECT set_config('app.sco_internal','true',false)");
        await expect(partner.query('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [noPermissionUser, companyA, id()])).rejects.toThrow('PARTNER_VERIFY_READ_FORBIDDEN');
      } finally { await partner.end(); }
    });
  });

  describe('confidentiality: no internal/confidential data path exists to leak', () => {
    it('17-22: the gateway function definition never references supplier/evidence/negotiation/internal tables or raw JSONB columns', async () => {
      const definition = (await owner.query(`SELECT pg_get_functiondef('public.partner_verify_result_get(uuid,uuid,uuid)'::regprocedure) definition`)).rows[0].definition as string;
      for (const forbidden of [/purchase_sources/i, /supplier_quotes/i, /company_partnerships/i, /verify_evidence_bindings/i, /negotiation_/i, /confidence_context/i, /variance_data/i, /exclusions_limitations/i, /audit_logs/i, /raw_content/i, /input_fingerprint/i]) {
        expect(definition).not.toMatch(forbidden);
      }
    });

    it('26: the gateway function performs no INSERT/UPDATE/DELETE (read-only, cannot mutate the result)', async () => {
      const definition = (await owner.query(`SELECT pg_get_functiondef('public.partner_verify_result_get(uuid,uuid,uuid)'::regprocedure) definition`)).rows[0].definition as string;
      expect(definition).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s+INTO|\bUPDATE\s+public\.|\bDELETE\s+FROM\b/i);
    });

    it('27: sco_runtime still has no direct UPDATE/DELETE privilege on verify_results (SR-01/SR-02 invariant preserved)', async () => {
      const result = await owner.query<{ has_update: boolean; has_delete: boolean; has_select: boolean }>(
        `SELECT has_table_privilege('sco_runtime','verify_results','UPDATE') AS has_update,
                has_table_privilege('sco_runtime','verify_results','DELETE') AS has_delete,
                has_table_privilege('sco_runtime','verify_results','SELECT') AS has_select`,
      );
      expect(result.rows[0]).toEqual({ has_update: false, has_delete: false, has_select: false });
    });

    it('28: finalized/superseded result immutability remains intact (unrelated regression check)', async () => {
      const { result } = await buildFinalResult(companyA, writer, 'FULL');
      await expect(owner.query(`UPDATE verify_results SET classification='FULL' WHERE id=$1`, [result])).rejects.toBeTruthy();
    });

    it('only sco_runtime (not PUBLIC, not sco_internal_executor, not sco_verify_system_executor) can execute the new Partner gateway', async () => {
      const result = await owner.query<{ public_exec: boolean; runtime_exec: boolean; internal_exec: boolean; system_exec: boolean }>(
        `SELECT has_function_privilege('public','public.partner_verify_result_get(uuid,uuid,uuid)','EXECUTE') AS public_exec,
                has_function_privilege('sco_runtime','public.partner_verify_result_get(uuid,uuid,uuid)','EXECUTE') AS runtime_exec,
                has_function_privilege('sco_internal_executor','public.partner_verify_result_get(uuid,uuid,uuid)','EXECUTE') AS internal_exec,
                has_function_privilege('sco_verify_system_executor','public.partner_verify_result_get(uuid,uuid,uuid)','EXECUTE') AS system_exec`,
      );
      expect(result.rows[0]).toEqual({ public_exec: false, runtime_exec: true, internal_exec: false, system_exec: false });
    });
  });

  describe('PartnerCompanyGuard: explicit Company.type = PARTNER enforcement', () => {
    it('allows a PARTNER company and denies a non-PARTNER (SCO) company', async () => {
      const guard = new PartnerCompanyGuard(new RealRuntimeDatabase() as never);
      const contextFor = (companyId: string) => ({ switchToHttp: () => ({ getRequest: () => ({ tenantContext: { membershipId: id(), userId: id(), companyId, status: 'ACTIVE' } }) }) } as never);
      await expect(guard.canActivate(contextFor(companyA))).resolves.toBe(true);
      await expect(guard.canActivate(contextFor(internalCompany))).rejects.toThrow();
    });
  });
});
