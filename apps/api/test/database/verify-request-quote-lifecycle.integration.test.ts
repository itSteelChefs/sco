import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let companyA: string; let companyB: string; let internalCompany: string; let unitId: string;
let writer: string; let reader: string; let unrelated: string; let inactive: string; let otherPartner: string;
let analyst: string; let approver: string; let rawReviewer: string;

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

async function lineIds(revision: string) {
  const rows = (await owner.query('SELECT line_number,id FROM verify_quote_lines WHERE verify_quote_revision_id=$1 ORDER BY line_number', [revision])).rows;
  return new Map<number, string>(rows.map((row) => [row.line_number as number, row.id as string]));
}

async function requestState(request: string) {
  return (await owner.query('SELECT status,current_submitted_revision_id FROM verify_requests WHERE id=$1', [request])).rows[0] as { status: string; current_submitted_revision_id: string | null };
}

// Handlers are attached synchronously so a racing gateway failure can never surface as an unhandled rejection.
function settled(pending: Promise<unknown>) {
  return pending.then(() => null, (error: Error) => error);
}

// Deterministic barrier: wait until a backend is genuinely blocked by another transaction's row lock.
async function waitUntilLockBlocked() {
  for (let attempt = 0; attempt < 4000; attempt += 1) {
    const blocked = await owner.query(`SELECT count(*)::int count FROM pg_stat_activity WHERE state='active' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid)) > 0 AND query ILIKE '%partner_verify_%'`);
    if (blocked.rows[0].count > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

async function createRequest(connection: Client, actor: string, company: string, correlation = id()) {
  return (await connection.query('SELECT partner_verify_request_create($1,$2,$3) request_id', [actor, company, correlation])).rows[0].request_id as string;
}

function priceLine(overrides: Record<string, unknown> = {}): Array<Record<string, unknown>> {
  return [{ lineNumber: 1, itemDescription: 'Compressor model CX-500', quantity: 2, unitId, currencyCode: 'SAR', unitPrice: 100, isPriceBearing: true, ...overrides }];
}

async function createRevision(connection: Client, actor: string, company: string, request: string, predecessor: string | null, key: string = id(), lines = priceLine(), fingerprint = `input-${key}`) {
  const result = await connection.query(`SELECT partner_verify_revision_create($1,$2,$3,$4,$5::text[],$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12) revision_id`, [actor, company, request, predecessor, ['SAR'], JSON.stringify({ payment: '30 days', delivery: 'Riyadh', tax: 'VAT' }), null, null, fingerprint, JSON.stringify(lines), key, id()]);
  return result.rows[0].revision_id as string;
}

async function setReady(connection: Client, actor: string, company: string, revision: string, correlation = id()) {
  const line = (await owner.query('SELECT id FROM verify_quote_lines WHERE verify_quote_revision_id=$1 AND line_number=1', [revision])).rows[0].id;
  await connection.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [actor, company, line, 'READY_FOR_VERIFICATION', null, correlation]);
  return line as string;
}

async function submit(connection: Client, actor: string, company: string, request: string, revision: string, correlation = id()) {
  await connection.query('SELECT partner_verify_request_submit($1,$2,$3,$4,$5)', [actor, company, request, revision, correlation]);
}

describe('Verify V0.1 Batch 1-C Partner request and quote revision lifecycle', () => {
  beforeAll(async () => {
    companyA = id(); companyB = id(); internalCompany = id(); unitId = id();
    writer = id(); reader = id(); unrelated = id(); inactive = id(); otherPartner = id(); analyst = id(); approver = id(); rawReviewer = id();
    await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,\'Verify Partner A\',\'PARTNER\'),($2,\'Verify Partner B\',\'PARTNER\'),($3,\'Verify Internal\',\'SCO\')', [companyA, companyB, internalCompany]);
    await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,\'Each\',\'count\')', [unitId, `verify-unit-${unitId}`]);
    const users = [writer, reader, unrelated, inactive, otherPartner, analyst, approver, rawReviewer];
    await owner.query(`INSERT INTO "User"(id,email,"passwordHash") SELECT value::uuid, value || '@verify-lifecycle.test', 'x' FROM unnest($1::text[]) value`, [users]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\'),($4,$5,$3,\'ACTIVE\'),($6,$7,$3,\'ACTIVE\'),($8,$9,$3,\'SUSPENDED\'),($10,$11,$12,\'ACTIVE\'),($13,$14,$15,\'ACTIVE\'),($16,$17,$15,\'ACTIVE\'),($18,$19,$15,\'ACTIVE\')', [id(), writer, companyA, id(), reader, id(), unrelated, id(), inactive, id(), otherPartner, companyB, id(), analyst, internalCompany, id(), approver, id(), rawReviewer]);
    await grant(writer, companyA, 'partner_verify.write');
    await grant(reader, companyA, 'partner.portal.read');
    await grant(unrelated, companyA, 'partner_po.submit');
    await grant(inactive, companyA, 'partner_verify.write');
    await grant(otherPartner, companyB, 'partner_verify.write');
    await grant(analyst, internalCompany, 'verify.analyst');
    await grant(approver, internalCompany, 'verify.approver');
    await grant(rawReviewer, internalCompany, 'verify.raw_review_access');
  });

  afterAll(async () => {
    await owner.query(`TRUNCATE verify_raw_content_access_events,verify_raw_review_grants,verify_results,verify_evidence_bindings,verify_runs,verify_quote_level_adjustments,verify_quote_line_adjustments,verify_quote_lines,verify_quote_revisions,verify_requests`);
    await owner.end();
  });

  it('allows only an active same-tenant Partner writer to create a request', async () => {
    const writerClient = await client(writer, companyA);
    try {
      const request = await createRequest(writerClient, writer, companyA);
      expect((await owner.query('SELECT company_id,requested_by,status FROM verify_requests WHERE id=$1', [request])).rows[0]).toEqual({ company_id: companyA, requested_by: writer, status: 'DRAFT' });
      expect((await owner.query(`SELECT company_id,actor_user_id,metadata->>'organizationId' organization,created_at IS NOT NULL recorded_at FROM audit_logs WHERE action='verify.request.created' AND entity_id=$1`, [request])).rows[0]).toEqual({ company_id: companyA, actor_user_id: writer, organization: companyA, recorded_at: true });
    } finally { await writerClient.end(); }
  });

  it('denies membership-only, read-only, unrelated, inactive, internal Verify, cross-tenant, and cross-company actors', async () => {
    const denied: Array<[string, string, string]> = [
      [reader, companyA, companyA], [unrelated, companyA, companyA], [inactive, companyA, companyA],
      [analyst, companyA, internalCompany], [approver, companyA, internalCompany], [rawReviewer, companyA, internalCompany],
      [otherPartner, companyA, companyB],
    ];
    for (const [actor, requestedCompany, tenant] of denied) {
      const connection = await client(actor, tenant);
      try { await expect(createRequest(connection, actor, requestedCompany)).rejects.toThrow('PARTNER_VERIFY_FORBIDDEN'); } finally { await connection.end(); }
    }
    const crossTenantWriter = await client(writer, companyB);
    try { await expect(createRequest(crossTenantWriter, writer, companyA)).rejects.toThrow('PARTNER_VERIFY_FORBIDDEN'); } finally { await crossTenantWriter.end(); }
  });

  it('creates a complete initial revision, preserves commercial terms, and submits atomically with the durable pointer', async () => {
    const connection = await client(writer, companyA);
    try {
      const request = await createRequest(connection, writer, companyA);
      const revision = await createRevision(connection, writer, companyA, request, null, 'initial-complete', [...priceLine(), { lineNumber: 2, itemDescription: 'Reference note', isPriceBearing: false, isInformational: true }]);
      const line = await setReady(connection, writer, companyA, revision);
      await submit(connection, writer, companyA, request, revision);
      expect((await owner.query('SELECT status,current_submitted_revision_id FROM verify_requests WHERE id=$1', [request])).rows[0]).toEqual({ status: 'SUBMITTED', current_submitted_revision_id: revision });
      expect((await owner.query('SELECT status,submitted_by,commercial_terms->>\'payment\' payment FROM verify_quote_revisions WHERE id=$1', [revision])).rows[0]).toEqual({ status: 'SUBMITTED', submitted_by: writer, payment: '30 days' });
      expect((await owner.query('SELECT readiness_state FROM verify_quote_lines WHERE id=$1', [line])).rows[0].readiness_state).toBe('READY_FOR_VERIFICATION');
      expect((await owner.query('SELECT readiness_state FROM verify_quote_lines WHERE verify_quote_revision_id=$1 AND line_number=2', [revision])).rows[0].readiness_state).toBe('NEEDS_COMPLETION');
    } finally { await connection.end(); }
  });

  it('rejects foreign revisions and incomplete or invalid price-bearing envelopes without partial submission', async () => {
    const connection = await client(writer, companyA);
    try {
      const first = await createRequest(connection, writer, companyA);
      const foreignRevision = await createRevision(connection, writer, companyA, first, null, 'foreign-revision');
      const second = await createRequest(connection, writer, companyA);
      await expect(submit(connection, writer, companyA, second, foreignRevision)).rejects.toThrow('PARTNER_VERIFY_NOT_SUBMITTABLE');
      const incomplete = await createRevision(connection, writer, companyA, second, null, 'incomplete', priceLine({ quantity: null }));
      await expect(submit(connection, writer, companyA, second, incomplete)).rejects.toThrow('VERIFY_REQUEST_ENVELOPE_INCOMPLETE');
      expect((await owner.query('SELECT status,current_submitted_revision_id FROM verify_requests WHERE id=$1', [second])).rows[0]).toEqual({ status: 'DRAFT', current_submitted_revision_id: null });
      const invalidPrice = await createRequest(connection, writer, companyA);
      const invalidRevision = await createRevision(connection, writer, companyA, invalidPrice, null, 'invalid-price', priceLine({ unitPrice: null }));
      await expect(setReady(connection, writer, companyA, invalidRevision)).rejects.toThrow('VERIFY_QUOTE_LINE_NOT_READY');
    } finally { await connection.end(); }
  });

  it('cancels DRAFT and SUBMITTED requests without deleting history and rejects prohibited repeat cancellation', async () => {
    const connection = await client(writer, companyA);
    try {
      const draft = await createRequest(connection, writer, companyA);
      await connection.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, draft, id()]);
      expect((await owner.query('SELECT status FROM verify_requests WHERE id=$1', [draft])).rows[0].status).toBe('CANCELLED');
      const submitted = await createRequest(connection, writer, companyA);
      const revision = await createRevision(connection, writer, companyA, submitted, null, 'cancel-submitted');
      await setReady(connection, writer, companyA, revision);
      await submit(connection, writer, companyA, submitted, revision);
      await owner.query('INSERT INTO verify_runs(verify_quote_revision_id,methodology_version,evidence_fingerprint,status,created_by) VALUES($1,\'verify-v0.1\',\'history\',\'QUEUED\',$2)', [revision, analyst]);
      await connection.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, submitted, id()]);
      expect((await owner.query('SELECT status FROM verify_requests WHERE id=$1', [submitted])).rows[0].status).toBe('CANCELLED');
      expect((await owner.query('SELECT count(*)::int count FROM verify_quote_revisions WHERE id=$1', [revision])).rows[0].count).toBe(1);
      expect((await owner.query('SELECT count(*)::int count FROM verify_runs WHERE verify_quote_revision_id=$1', [revision])).rows[0].count).toBe(1);
      await expect(connection.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, submitted, id()])).rejects.toThrow('PARTNER_VERIFY_NOT_CANCELLABLE');
    } finally { await connection.end(); }
  });

  it('creates material successor revisions with stale-write protection and idempotent retry without moving the pointer until submit', async () => {
    const connection = await client(writer, companyA);
    try {
      const request = await createRequest(connection, writer, companyA);
      const original = await createRevision(connection, writer, companyA, request, null, 'base');
      await setReady(connection, writer, companyA, original);
      await submit(connection, writer, companyA, request, original);
      const successor = await createRevision(connection, writer, companyA, request, original, 'successor', priceLine({ unitPrice: 125 }), 'changed-price');
      expect((await owner.query('SELECT current_submitted_revision_id FROM verify_requests WHERE id=$1', [request])).rows[0].current_submitted_revision_id).toBe(original);
      expect(await createRevision(connection, writer, companyA, request, original, 'successor', priceLine({ unitPrice: 125 }), 'changed-price')).toBe(successor);
      expect((await owner.query(`SELECT count(*)::int count FROM audit_logs WHERE action='verify.quote_revision.material_revision_created' AND entity_id=$1`, [successor])).rows[0].count).toBe(1);
      await expect(createRevision(connection, writer, companyA, request, original, 'stale')).rejects.toThrow('VERIFY_QUOTE_REVISION_STALE_PREDECESSOR');
      await expect(owner.query('UPDATE verify_quote_revisions SET input_fingerprint=\'rewrite\' WHERE id=$1', [original])).rejects.toThrow('VERIFY_QUOTE_REVISION_IMMUTABLE');
      await setReady(connection, writer, companyA, successor);
      await submit(connection, writer, companyA, request, successor);
      expect((await owner.query('SELECT current_submitted_revision_id FROM verify_requests WHERE id=$1', [request])).rows[0].current_submitted_revision_id).toBe(successor);
      await owner.query('INSERT INTO verify_runs(verify_quote_revision_id,methodology_version,evidence_fingerprint,status,created_by) VALUES($1,\'verify-v0.1\',\'original-run\',\'QUEUED\',$2)', [original, analyst]);
      expect((await owner.query('SELECT verify_quote_revision_id FROM verify_runs WHERE evidence_fingerprint=\'original-run\'')).rows[0].verify_quote_revision_id).toBe(original);
    } finally { await connection.end(); }
  });

  it('advances the pointer only through successful submission and proves the transition in audit', async () => {
    const connection = await client(writer, companyA);
    const firstCorrelation = id(); const secondCorrelation = id(); const cancelCorrelation = id();
    let request: string; let first: string; let second: string;
    try {
      request = await createRequest(connection, writer, companyA);
      first = await createRevision(connection, writer, companyA, request, null, 'pointer-r1');
      expect(await requestState(request)).toEqual({ status: 'DRAFT', current_submitted_revision_id: null });
      await setReady(connection, writer, companyA, first);
      await submit(connection, writer, companyA, request, first, firstCorrelation);
      expect(await requestState(request)).toEqual({ status: 'SUBMITTED', current_submitted_revision_id: first });

      second = await createRevision(connection, writer, companyA, request, first, 'pointer-r2');
      expect(await requestState(request)).toEqual({ status: 'SUBMITTED', current_submitted_revision_id: first });
      expect((await owner.query('SELECT count(*)::int count FROM audit_logs WHERE entity_id=$1 AND action LIKE \'verify.request.%\'', [request])).rows[0].count).toBe(2);
      await setReady(connection, writer, companyA, second);
      await submit(connection, writer, companyA, request, second, secondCorrelation);
      expect(await requestState(request)).toEqual({ status: 'SUBMITTED', current_submitted_revision_id: second });
      expect((await owner.query('SELECT status,submitted_by,submitted_at IS NOT NULL submitted FROM verify_quote_revisions WHERE id=$1', [first])).rows[0]).toEqual({ status: 'SUBMITTED', submitted_by: writer, submitted: true });

      await connection.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, request, cancelCorrelation]);
      expect(await requestState(request)).toEqual({ status: 'CANCELLED', current_submitted_revision_id: second });
    } finally { await connection.end(); }

    const submissions = await owner.query(`SELECT correlation_id,company_id,actor_user_id,metadata->>'organizationId' organization,metadata->>'previousSubmittedRevisionId' previous_pointer,metadata->>'revisionId' new_pointer,metadata->>'revisionNumber' revision_number,metadata->>'fromState' from_state,metadata->>'toState' to_state,created_at IS NOT NULL recorded FROM audit_logs WHERE action='verify.request.submitted' AND entity_id=$1 ORDER BY created_at`, [request!]);
    expect(submissions.rows).toEqual([
      { correlation_id: firstCorrelation, company_id: companyA, actor_user_id: writer, organization: companyA, previous_pointer: null, new_pointer: first!, revision_number: '1', from_state: 'DRAFT', to_state: 'SUBMITTED', recorded: true },
      { correlation_id: secondCorrelation, company_id: companyA, actor_user_id: writer, organization: companyA, previous_pointer: first!, new_pointer: second!, revision_number: '2', from_state: 'SUBMITTED', to_state: 'SUBMITTED', recorded: true },
    ]);
  });

  it('rejects every prohibited request status and pointer combination on the privileged direct-update path', async () => {
    const connection = await client(writer, companyA);
    let draftRequest: string; let draftRevision: string;
    let submittedRequest: string; let firstRevision: string; let secondRevision: string; let openRevision: string;
    let cancellableRequest: string; let cancellableRevision: string; let cancellableDraft: string;
    let cancelledRequest: string; let cancelledPointer: string; let cancelledDraft: string;
    try {
      draftRequest = await createRequest(connection, writer, companyA);
      draftRevision = await createRevision(connection, writer, companyA, draftRequest, null, 'matrix-draft');

      submittedRequest = await createRequest(connection, writer, companyA);
      firstRevision = await createRevision(connection, writer, companyA, submittedRequest, null, 'matrix-r1');
      await setReady(connection, writer, companyA, firstRevision);
      await submit(connection, writer, companyA, submittedRequest, firstRevision);
      secondRevision = await createRevision(connection, writer, companyA, submittedRequest, firstRevision, 'matrix-r2');
      await setReady(connection, writer, companyA, secondRevision);
      await submit(connection, writer, companyA, submittedRequest, secondRevision);
      openRevision = await createRevision(connection, writer, companyA, submittedRequest, secondRevision, 'matrix-r3');

      cancellableRequest = await createRequest(connection, writer, companyA);
      cancellableRevision = await createRevision(connection, writer, companyA, cancellableRequest, null, 'matrix-cancellable-r1');
      await setReady(connection, writer, companyA, cancellableRevision);
      await submit(connection, writer, companyA, cancellableRequest, cancellableRevision);
      cancellableDraft = await createRevision(connection, writer, companyA, cancellableRequest, cancellableRevision, 'matrix-cancellable-r2');

      cancelledRequest = await createRequest(connection, writer, companyA);
      cancelledPointer = await createRevision(connection, writer, companyA, cancelledRequest, null, 'matrix-cancelled-r1');
      await setReady(connection, writer, companyA, cancelledPointer);
      await submit(connection, writer, companyA, cancelledRequest, cancelledPointer);
      cancelledDraft = await createRevision(connection, writer, companyA, cancelledRequest, cancelledPointer, 'matrix-cancelled-r2');
      await connection.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, cancelledRequest, id()]);
    } finally { await connection.end(); }

    const denied: Array<[string, string, unknown[], RegExp]> = [
      ['DRAFT -> DRAFT with pointer set', 'UPDATE verify_requests SET current_submitted_revision_id=$1 WHERE id=$2', [draftRevision!, draftRequest!], /VERIFY_REQUEST_IMMUTABLE/],
      ['DRAFT -> DRAFT no-op', 'UPDATE verify_requests SET updated_at=now() WHERE id=$1', [draftRequest!], /VERIFY_REQUEST_IMMUTABLE/],
      ['DRAFT -> CANCELLED with pointer set', 'UPDATE verify_requests SET status=\'CANCELLED\',current_submitted_revision_id=$1 WHERE id=$2', [draftRevision!, draftRequest!], /VERIFY_REQUEST_POINTER_INVALID/],
      ['DRAFT -> SUBMITTED pointing at a DRAFT revision', 'UPDATE verify_requests SET status=\'SUBMITTED\',current_submitted_revision_id=$1 WHERE id=$2', [draftRevision!, draftRequest!], /VERIFY_REQUEST_POINTER_INVALID/],
      ['DRAFT -> SUBMITTED without a pointer', 'UPDATE verify_requests SET status=\'SUBMITTED\' WHERE id=$1', [draftRequest!], /VERIFY_REQUEST_SUBMISSION_INVALID/],
      ['SUBMITTED pointer -> NULL', 'UPDATE verify_requests SET current_submitted_revision_id=NULL WHERE id=$1', [submittedRequest!], /VERIFY_REQUEST_POINTER_INVALID/],
      ['SUBMITTED pointer -> DRAFT revision', 'UPDATE verify_requests SET current_submitted_revision_id=$1 WHERE id=$2', [openRevision!, submittedRequest!], /VERIFY_REQUEST_POINTER_INVALID/],
      ['SUBMITTED pointer -> older submitted revision', 'UPDATE verify_requests SET current_submitted_revision_id=$1 WHERE id=$2', [firstRevision!, submittedRequest!], /VERIFY_REQUEST_POINTER_INVALID/],
      ['SUBMITTED pointer -> foreign request revision', 'UPDATE verify_requests SET current_submitted_revision_id=$1 WHERE id=$2', [draftRevision!, submittedRequest!], /VERIFY_REQUEST_POINTER_INVALID/],
      ['SUBMITTED -> CANCELLED with a changed pointer', 'UPDATE verify_requests SET status=\'CANCELLED\',current_submitted_revision_id=$1 WHERE id=$2', [openRevision!, submittedRequest!], /VERIFY_REQUEST_POINTER_INVALID/],
      ['SUBMITTED -> CANCELLED with a cleared pointer', 'UPDATE verify_requests SET status=\'CANCELLED\',current_submitted_revision_id=NULL WHERE id=$1', [submittedRequest!], /VERIFY_REQUEST_POINTER_INVALID/],
      ['SUBMITTED -> IN_REVIEW', 'UPDATE verify_requests SET status=\'IN_REVIEW\' WHERE id=$1', [submittedRequest!], /VERIFY_REQUEST_IMMUTABLE/],
      ['SUBMITTED request delete', 'DELETE FROM verify_requests WHERE id=$1', [submittedRequest!], /VERIFY_REQUEST_IMMUTABLE/],
      ['CANCELLED pointer -> other revision', 'UPDATE verify_requests SET current_submitted_revision_id=$1 WHERE id=$2', [cancelledDraft!, cancelledRequest!], /VERIFY_REQUEST_IMMUTABLE/],
      ['CANCELLED pointer -> NULL', 'UPDATE verify_requests SET current_submitted_revision_id=NULL WHERE id=$1', [cancelledRequest!], /VERIFY_REQUEST_IMMUTABLE/],
      ['CANCELLED -> CANCELLED no-op', 'UPDATE verify_requests SET updated_at=now() WHERE id=$1', [cancelledRequest!], /VERIFY_REQUEST_IMMUTABLE/],
      ['CANCELLED -> DRAFT', 'UPDATE verify_requests SET status=\'DRAFT\',current_submitted_revision_id=NULL WHERE id=$1', [cancelledRequest!], /VERIFY_REQUEST_IMMUTABLE/],
      ['CANCELLED -> SUBMITTED', 'UPDATE verify_requests SET status=\'SUBMITTED\' WHERE id=$1', [cancelledRequest!], /VERIFY_REQUEST_IMMUTABLE/],
      ['submitted revision loses submitted_at', 'UPDATE verify_quote_revisions SET submitted_at=NULL WHERE id=$1', [secondRevision!], /VERIFY_QUOTE_REVISION_IMMUTABLE/],
      ['submitted revision loses submitted_by', 'UPDATE verify_quote_revisions SET submitted_by=NULL WHERE id=$1', [secondRevision!], /VERIFY_QUOTE_REVISION_IMMUTABLE/],
      ['inserted request claims SUBMITTED without a pointer', 'INSERT INTO verify_requests(company_id,requested_by,status) VALUES($1,$2,\'SUBMITTED\')', [companyA, writer], /verify_requests_pointer_status_check/],
    ];
    for (const [label, statement, parameters, expected] of denied) {
      await expect(owner.query(statement, parameters), label).rejects.toThrow(expected);
    }

    expect(await requestState(draftRequest!)).toEqual({ status: 'DRAFT', current_submitted_revision_id: null });
    expect(await requestState(submittedRequest!)).toEqual({ status: 'SUBMITTED', current_submitted_revision_id: secondRevision! });
    expect(await requestState(cancelledRequest!)).toEqual({ status: 'CANCELLED', current_submitted_revision_id: cancelledPointer! });
    expect((await owner.query('SELECT status FROM verify_quote_revisions WHERE id=$1', [openRevision!])).rows[0].status).toBe('DRAFT');
    expect((await owner.query('SELECT count(*)::int count FROM verify_requests WHERE id=$1', [submittedRequest!])).rows[0].count).toBe(1);

    expect((await owner.query('UPDATE verify_requests SET updated_at=now() WHERE id=$1', [submittedRequest!])).rowCount).toBe(1);
    expect((await owner.query('UPDATE verify_requests SET status=\'CANCELLED\' WHERE id=$1', [cancellableRequest!])).rowCount).toBe(1);
    expect(await requestState(cancellableRequest!)).toEqual({ status: 'CANCELLED', current_submitted_revision_id: cancellableRevision! });
    expect((await owner.query('SELECT status FROM verify_quote_revisions WHERE id=$1', [cancellableDraft!])).rows[0].status).toBe('DRAFT');
  });

  it('refuses stale and repeated submissions without rewinding the pointer', async () => {
    const connection = await client(writer, companyA);
    const staleCorrelation = id(); const repeatCorrelation = id();
    let request: string; let first: string; let second: string; let third: string;
    try {
      request = await createRequest(connection, writer, companyA);
      first = await createRevision(connection, writer, companyA, request, null, 'stale-r1');
      await setReady(connection, writer, companyA, first);
      await submit(connection, writer, companyA, request, first);
      second = await createRevision(connection, writer, companyA, request, first, 'stale-r2');
      third = await createRevision(connection, writer, companyA, request, second, 'stale-r3');
      await setReady(connection, writer, companyA, second);
      await setReady(connection, writer, companyA, third);
      await submit(connection, writer, companyA, request, third);
      expect(await requestState(request)).toEqual({ status: 'SUBMITTED', current_submitted_revision_id: third });

      await expect(submit(connection, writer, companyA, request, second, staleCorrelation)).rejects.toThrow('VERIFY_REQUEST_POINTER_INVALID');
      await expect(submit(connection, writer, companyA, request, third, repeatCorrelation)).rejects.toThrow('PARTNER_VERIFY_NOT_SUBMITTABLE');
    } finally { await connection.end(); }

    expect(await requestState(request!)).toEqual({ status: 'SUBMITTED', current_submitted_revision_id: third! });
    expect((await owner.query('SELECT status,submitted_by,submitted_at FROM verify_quote_revisions WHERE id=$1', [second!])).rows[0]).toEqual({ status: 'DRAFT', submitted_by: null, submitted_at: null });
    expect((await owner.query('SELECT count(*)::int count FROM verify_quote_revisions WHERE verify_request_id=$1', [request!])).rows[0].count).toBe(3);
    expect((await owner.query(`SELECT count(*)::int count FROM audit_logs WHERE action='verify.request.submitted' AND entity_id=$1`, [request!])).rows[0].count).toBe(2);
    expect((await owner.query('SELECT count(*)::int count FROM audit_logs WHERE correlation_id = ANY($1::uuid[])', [[staleCorrelation, repeatCorrelation]])).rows[0].count).toBe(0);
  });

  it('serializes competing successor submissions and submit-versus-cancel races in both orderings', async () => {
    const setup = await client(writer, companyA);
    let request: string; let first: string; let second: string; let third: string;
    try {
      request = await createRequest(setup, writer, companyA);
      first = await createRevision(setup, writer, companyA, request, null, 'race-submit-r1');
      await setReady(setup, writer, companyA, first);
      await submit(setup, writer, companyA, request, first);
      second = await createRevision(setup, writer, companyA, request, first, 'race-submit-r2');
      third = await createRevision(setup, writer, companyA, request, second, 'race-submit-r3');
      await setReady(setup, writer, companyA, second);
      await setReady(setup, writer, companyA, third);
    } finally { await setup.end(); }

    const winner = await client(writer, companyA);
    const loser = await client(writer, companyA);
    const loserCorrelation = id();
    try {
      await winner.query('BEGIN');
      await winner.query('SELECT partner_verify_request_submit($1,$2,$3,$4,$5)', [writer, companyA, request, third, id()]);
      const pending = settled(loser.query('SELECT partner_verify_request_submit($1,$2,$3,$4,$5)', [writer, companyA, request, second, loserCorrelation]));
      expect(await waitUntilLockBlocked()).toBe(true);
      await winner.query('COMMIT');
      expect((await pending)?.message).toBe('VERIFY_REQUEST_POINTER_INVALID');
    } finally { await winner.end(); await loser.end(); }
    expect(await requestState(request!)).toEqual({ status: 'SUBMITTED', current_submitted_revision_id: third! });
    expect((await owner.query('SELECT status FROM verify_quote_revisions WHERE id=$1', [second!])).rows[0].status).toBe('DRAFT');
    expect((await owner.query('SELECT count(*)::int count FROM audit_logs WHERE correlation_id=$1', [loserCorrelation])).rows[0].count).toBe(0);

    const cancelFirst = await client(writer, companyA);
    const submitSecond = await client(writer, companyA);
    let cancelRequest: string; let cancelPointer: string; let cancelSuccessor: string;
    const blockedSubmit = id();
    try {
      cancelRequest = await createRequest(cancelFirst, writer, companyA);
      cancelPointer = await createRevision(cancelFirst, writer, companyA, cancelRequest, null, 'race-cancel-r1');
      await setReady(cancelFirst, writer, companyA, cancelPointer);
      await submit(cancelFirst, writer, companyA, cancelRequest, cancelPointer);
      cancelSuccessor = await createRevision(cancelFirst, writer, companyA, cancelRequest, cancelPointer, 'race-cancel-r2');
      await setReady(cancelFirst, writer, companyA, cancelSuccessor);
      await cancelFirst.query('BEGIN');
      await cancelFirst.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, cancelRequest, id()]);
      const pending = settled(submitSecond.query('SELECT partner_verify_request_submit($1,$2,$3,$4,$5)', [writer, companyA, cancelRequest, cancelSuccessor, blockedSubmit]));
      expect(await waitUntilLockBlocked()).toBe(true);
      await cancelFirst.query('COMMIT');
      expect((await pending)?.message).toBe('PARTNER_VERIFY_NOT_SUBMITTABLE');
    } finally { await cancelFirst.end(); await submitSecond.end(); }
    expect(await requestState(cancelRequest!)).toEqual({ status: 'CANCELLED', current_submitted_revision_id: cancelPointer! });
    expect((await owner.query('SELECT count(*)::int count FROM audit_logs WHERE correlation_id=$1', [blockedSubmit])).rows[0].count).toBe(0);

    const submitFirst = await client(writer, companyA);
    const cancelSecond = await client(writer, companyA);
    let orderedRequest: string; let orderedFirst: string; let orderedSecond: string;
    try {
      orderedRequest = await createRequest(submitFirst, writer, companyA);
      orderedFirst = await createRevision(submitFirst, writer, companyA, orderedRequest, null, 'race-order-r1');
      await setReady(submitFirst, writer, companyA, orderedFirst);
      await submit(submitFirst, writer, companyA, orderedRequest, orderedFirst);
      orderedSecond = await createRevision(submitFirst, writer, companyA, orderedRequest, orderedFirst, 'race-order-r2');
      await setReady(submitFirst, writer, companyA, orderedSecond);
      await submitFirst.query('BEGIN');
      await submitFirst.query('SELECT partner_verify_request_submit($1,$2,$3,$4,$5)', [writer, companyA, orderedRequest, orderedSecond, id()]);
      const pending = settled(cancelSecond.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, orderedRequest, id()]));
      expect(await waitUntilLockBlocked()).toBe(true);
      await submitFirst.query('COMMIT');
      expect(await pending).toBeNull();
    } finally { await submitFirst.end(); await cancelSecond.end(); }
    expect(await requestState(orderedRequest!)).toEqual({ status: 'CANCELLED', current_submitted_revision_id: orderedSecond! });
  }, 120_000);

  it('proves the pre-remediation request guard accepted a pointer rebind that the hardened guard rejects', async () => {
    const connection = await client(writer, companyA);
    let request: string; let submitted: string; let draftSuccessor: string;
    try {
      request = await createRequest(connection, writer, companyA);
      submitted = await createRevision(connection, writer, companyA, request, null, 'counterfactual-r1');
      await setReady(connection, writer, companyA, submitted);
      await submit(connection, writer, companyA, request, submitted);
      draftSuccessor = await createRevision(connection, writer, companyA, request, submitted, 'counterfactual-r2');
    } finally { await connection.end(); }

    const counterfactual = new Client({ connectionString: process.env.DATABASE_URL });
    await counterfactual.connect();
    try {
      await counterfactual.query('BEGIN');
      await counterfactual.query(`CREATE OR REPLACE FUNCTION public.verify_request_lifecycle_only() RETURNS TRIGGER LANGUAGE plpgsql AS $counterfactual$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.human_review_consented_at IS DISTINCT FROM OLD.human_review_consented_at
     OR NEW.human_review_consented_by IS DISTINCT FROM OLD.human_review_consented_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('SUBMITTED', 'CANCELLED'))
       OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('SUBMITTED', 'CANCELLED'))
     ) THEN
    RAISE EXCEPTION 'VERIFY_REQUEST_IMMUTABLE';
  END IF;
  IF NEW.status = 'SUBMITTED' AND NEW.current_submitted_revision_id IS NULL THEN
    RAISE EXCEPTION 'VERIFY_REQUEST_SUBMISSION_INVALID';
  END IF;
  RETURN NEW;
END
$counterfactual$`);
      const rebind = await counterfactual.query('UPDATE verify_requests SET current_submitted_revision_id=$1 WHERE id=$2', [draftSuccessor, request]);
      expect(rebind.rowCount).toBe(1);
      expect((await counterfactual.query('SELECT current_submitted_revision_id FROM verify_requests WHERE id=$1', [request])).rows[0].current_submitted_revision_id).toBe(draftSuccessor);
    } finally {
      await counterfactual.query('ROLLBACK');
      await counterfactual.end();
    }

    expect((await owner.query(`SELECT pg_get_functiondef('public.verify_request_lifecycle_only()'::regprocedure) definition`)).rows[0].definition).toMatch(/VERIFY_REQUEST_POINTER_INVALID/);
    await expect(owner.query('UPDATE verify_requests SET current_submitted_revision_id=$1 WHERE id=$2', [draftSuccessor!, request!])).rejects.toThrow('VERIFY_REQUEST_POINTER_INVALID');
    expect(await requestState(request!)).toEqual({ status: 'SUBMITTED', current_submitted_revision_id: submitted! });
  });

  it('enforces Partner readiness prerequisites, NOT_VERIFIABLE reasons, and idempotent no-op audit behavior', async () => {
    const connection = await client(writer, companyA);
    try {
      const request = await createRequest(connection, writer, companyA);
      const revision = await createRevision(connection, writer, companyA, request, null, 'readiness', priceLine({ itemDescription: '' }));
      const line = (await owner.query('SELECT id FROM verify_quote_lines WHERE verify_quote_revision_id=$1', [revision])).rows[0].id;
      await expect(connection.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, line, 'READY_FOR_VERIFICATION', null, id()])).rejects.toThrow('VERIFY_QUOTE_LINE_NOT_READY');
      await expect(connection.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, line, 'NOT_VERIFIABLE', null, id()])).rejects.toThrow('VERIFY_QUOTE_LINE_NOT_VERIFIABLE_REASON_REQUIRED');
      const correlation = id();
      await connection.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, line, 'NOT_VERIFIABLE', 'outside V0.1 scope', correlation]);
      await connection.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, line, 'NOT_VERIFIABLE', 'outside V0.1 scope', id()]);
      expect((await owner.query(`SELECT count(*)::int count FROM audit_logs WHERE action='verify.quote_line.readiness_changed' AND entity_id=$1`, [line])).rows[0].count).toBe(1);
    } finally { await connection.end(); }
  });

  it('enforces identical READY_FOR_VERIFICATION invariants on the Partner and internal Analyst paths', async () => {
    const connection = await client(writer, companyA);
    let revision: string;
    try {
      const request = await createRequest(connection, writer, companyA);
      revision = await createRevision(connection, writer, companyA, request, null, 'readiness-parity', [
        { lineNumber: 1, itemDescription: 'Complete partner line', quantity: 2, unitId, currencyCode: 'SAR', unitPrice: 100, isPriceBearing: true },
        { lineNumber: 2, itemDescription: 'Complete internal line', quantity: 2, unitId, currencyCode: 'SAR', unitPrice: 100, isPriceBearing: true },
        { lineNumber: 3, itemDescription: 'Missing quantity', quantity: null, unitId, currencyCode: 'SAR', unitPrice: 100, isPriceBearing: true },
        { lineNumber: 4, itemDescription: 'Missing unit', quantity: 2, unitId: null, currencyCode: 'SAR', unitPrice: 100, isPriceBearing: true },
        { lineNumber: 5, itemDescription: 'Missing price', quantity: 2, unitId, currencyCode: 'SAR', unitPrice: null, isPriceBearing: true },
        { lineNumber: 6, itemDescription: 'Missing currency', quantity: 2, unitId, currencyCode: null, unitPrice: 100, isPriceBearing: true },
        { lineNumber: 7, itemDescription: 'Informational note', isPriceBearing: false, isInformational: true },
        { lineNumber: 8, quantity: 2, unitId, currencyCode: 'SAR', unitPrice: 100, isPriceBearing: true },
        { lineNumber: 9, itemDescription: 'Real zero value partner', quantity: 3, unitId, currencyCode: 'SAR', unitPrice: 0, isPriceBearing: true, isRealZeroValue: true },
        { lineNumber: 10, itemDescription: 'Real zero value internal', quantity: 3, unitId, currencyCode: 'SAR', unitPrice: 0, isPriceBearing: true, isRealZeroValue: true },
      ]);
      const lines = await lineIds(revision);
      const analystConnection = await internalClient(analyst, internalCompany);
      try {
        for (const lineNumber of [3, 4, 5, 6, 7, 8]) {
          const line = lines.get(lineNumber)!;
          await expect(connection.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, line, 'READY_FOR_VERIFICATION', null, id()])).rejects.toThrow('VERIFY_QUOTE_LINE_NOT_READY');
          await expect(analystConnection.query('SELECT internal_verify_quote_line_transition($1,$2,$3,$4,$5)', [analyst, line, 'READY_FOR_VERIFICATION', null, id()])).rejects.toThrow('VERIFY_QUOTE_LINE_NOT_READY');
        }
        await expect(analystConnection.query('SELECT internal_verify_quote_line_transition($1,$2,$3,$4,$5)', [analyst, lines.get(3)!, 'NOT_VERIFIABLE', null, id()])).rejects.toThrow('VERIFY_QUOTE_LINE_NOT_VERIFIABLE_REASON_REQUIRED');
        await analystConnection.query('SELECT internal_verify_quote_line_transition($1,$2,$3,$4,$5)', [analyst, lines.get(2)!, 'READY_FOR_VERIFICATION', null, id()]);
        await analystConnection.query('SELECT internal_verify_quote_line_transition($1,$2,$3,$4,$5)', [analyst, lines.get(10)!, 'READY_FOR_VERIFICATION', null, id()]);
      } finally { await analystConnection.end(); }
      await connection.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, lines.get(1)!, 'READY_FOR_VERIFICATION', null, id()]);
      await connection.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, lines.get(9)!, 'READY_FOR_VERIFICATION', null, id()]);
    } finally { await connection.end(); }
    const states = (await owner.query('SELECT line_number,readiness_state FROM verify_quote_lines WHERE verify_quote_revision_id=$1 ORDER BY line_number', [revision!])).rows;
    expect(states.map((row) => row.readiness_state)).toEqual([
      'READY_FOR_VERIFICATION', 'READY_FOR_VERIFICATION', 'NEEDS_COMPLETION', 'NEEDS_COMPLETION', 'NEEDS_COMPLETION',
      'NEEDS_COMPLETION', 'NEEDS_COMPLETION', 'NEEDS_COMPLETION', 'READY_FOR_VERIFICATION', 'READY_FOR_VERIFICATION',
    ]);
  });

  it('derives internal readiness audit tenant attribution from the line and ignores caller-supplied context', async () => {
    const connection = await client(writer, companyA);
    let line: string;
    let incomplete: string;
    try {
      const request = await createRequest(connection, writer, companyA);
      const revision = await createRevision(connection, writer, companyA, request, null, 'audit-attribution', [
        { lineNumber: 1, itemDescription: 'Attributed line', quantity: 4, unitId, currencyCode: 'SAR', unitPrice: 55, isPriceBearing: true },
        { lineNumber: 2, itemDescription: 'Incomplete line', unitId, currencyCode: 'SAR', unitPrice: 55, isPriceBearing: true },
      ]);
      const lines = await lineIds(revision);
      line = lines.get(1)!;
      incomplete = lines.get(2)!;
    } finally { await connection.end(); }

    expect((await owner.query(`SELECT pg_get_function_arguments(oid) args FROM pg_proc WHERE proname='internal_verify_quote_line_transition'`)).rows[0].args).not.toMatch(/company/i);

    const spoofCorrelation = id(); const failedCorrelation = id(); const noopCorrelation = id();
    const spoofed = await internalClient(analyst, companyB);
    try {
      await expect(spoofed.query('SELECT internal_verify_quote_line_transition($1,$2,$3,$4,$5)', [analyst, incomplete, 'READY_FOR_VERIFICATION', null, failedCorrelation])).rejects.toThrow('VERIFY_QUOTE_LINE_NOT_READY');
      await spoofed.query('SELECT internal_verify_quote_line_transition($1,$2,$3,$4,$5)', [analyst, line, 'READY_FOR_VERIFICATION', null, spoofCorrelation]);
      await spoofed.query('SELECT internal_verify_quote_line_transition($1,$2,$3,$4,$5)', [analyst, line, 'READY_FOR_VERIFICATION', null, noopCorrelation]);
    } finally { await spoofed.end(); }

    const audit = await owner.query(`SELECT company_id,actor_user_id,metadata->>'organizationId' organization,metadata->>'fromState' from_state,metadata->>'toState' to_state,created_at IS NOT NULL recorded FROM audit_logs WHERE correlation_id=$1`, [spoofCorrelation]);
    expect(audit.rows).toEqual([{ company_id: companyA, actor_user_id: analyst, organization: companyA, from_state: 'NEEDS_COMPLETION', to_state: 'READY_FOR_VERIFICATION', recorded: true }]);
    expect((await owner.query('SELECT count(*)::int count FROM audit_logs WHERE correlation_id=$1', [failedCorrelation])).rows[0].count).toBe(0);
    expect((await owner.query('SELECT count(*)::int count FROM audit_logs WHERE correlation_id=$1', [noopCorrelation])).rows[0].count).toBe(0);
    expect((await owner.query('SELECT count(*)::int count FROM audit_logs WHERE entity_id=$1 AND company_id IS NULL', [line])).rows[0].count).toBe(0);
  });

  it('enforces cancellation terminality across every Partner lifecycle gateway', async () => {
    const connection = await client(writer, companyA);
    let request: string; let revision: string; let line: string;
    try {
      request = await createRequest(connection, writer, companyA);
      revision = await createRevision(connection, writer, companyA, request, null, 'terminality');
      line = (await lineIds(revision)).get(1)!;
      await connection.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, line, 'READY_FOR_VERIFICATION', null, id()]);
      await connection.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, request, id()]);

      const lineBefore = (await owner.query('SELECT readiness_state,readiness_reason,quantity,unit_price,currency_code FROM verify_quote_lines WHERE id=$1', [line])).rows[0];
      const readinessAuditsBefore = (await owner.query(`SELECT count(*)::int count FROM audit_logs WHERE action='verify.quote_line.readiness_changed' AND entity_id=$1`, [line])).rows[0].count;
      const denied = [id(), id(), id(), id(), id()];

      await expect(connection.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, line, 'READY_FOR_VERIFICATION', null, denied[0]])).rejects.toThrow('PARTNER_VERIFY_NOT_AVAILABLE');
      await expect(connection.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, line, 'NOT_VERIFIABLE', 'post cancellation', denied[1]])).rejects.toThrow('PARTNER_VERIFY_NOT_AVAILABLE');
      await expect(createRevision(connection, writer, companyA, request, revision, 'post-cancel-revision')).rejects.toThrow('PARTNER_VERIFY_NOT_AVAILABLE');
      await expect(submit(connection, writer, companyA, request, revision, denied[3])).rejects.toThrow('PARTNER_VERIFY_NOT_SUBMITTABLE');
      await expect(connection.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, request, denied[4]])).rejects.toThrow('PARTNER_VERIFY_NOT_CANCELLABLE');

      expect((await owner.query('SELECT readiness_state,readiness_reason,quantity,unit_price,currency_code FROM verify_quote_lines WHERE id=$1', [line])).rows[0]).toEqual(lineBefore);
      expect((await owner.query(`SELECT count(*)::int count FROM audit_logs WHERE action='verify.quote_line.readiness_changed' AND entity_id=$1`, [line])).rows[0].count).toBe(readinessAuditsBefore);
      expect((await owner.query('SELECT count(*)::int count FROM audit_logs WHERE correlation_id = ANY($1::uuid[])', [denied])).rows[0].count).toBe(0);
      expect((await owner.query(`SELECT count(*)::int count FROM audit_logs WHERE action='verify.request.cancelled' AND entity_id=$1`, [request])).rows[0].count).toBe(1);
      expect((await owner.query('SELECT status,current_submitted_revision_id FROM verify_requests WHERE id=$1', [request])).rows[0]).toEqual({ status: 'CANCELLED', current_submitted_revision_id: null });
      expect((await owner.query('SELECT count(*)::int count FROM verify_quote_revisions WHERE verify_request_id=$1', [request])).rows[0].count).toBe(1);
    } finally { await connection.end(); }

    const foreign = await client(otherPartner, companyB);
    try {
      await expect(foreign.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [otherPartner, companyB, line!, 'NOT_VERIFIABLE', 'cross company', id()])).rejects.toThrow('PARTNER_VERIFY_NOT_AVAILABLE');
      await expect(foreign.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [otherPartner, companyA, request!, id()])).rejects.toThrow('PARTNER_VERIFY_FORBIDDEN');
    } finally { await foreign.end(); }
  });

  it('serializes concurrent readiness and cancellation in both orderings across independent transactions', async () => {
    const setup = await client(writer, companyA);
    let request: string; let line: string;
    try {
      request = await createRequest(setup, writer, companyA);
      const revision = await createRevision(setup, writer, companyA, request, null, 'race-a');
      line = (await lineIds(revision)).get(1)!;
    } finally { await setup.end(); }

    const cancelConnection = await client(writer, companyA);
    const readyConnection = await client(writer, companyA);
    const raceCorrelation = id();
    try {
      await cancelConnection.query('BEGIN');
      await cancelConnection.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, request, id()]);
      const pendingReadiness = settled(readyConnection.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, line, 'NOT_VERIFIABLE', 'racing', raceCorrelation]));
      expect(await waitUntilLockBlocked()).toBe(true);
      await cancelConnection.query('COMMIT');
      expect((await pendingReadiness)?.message).toBe('PARTNER_VERIFY_NOT_AVAILABLE');
    } finally { await cancelConnection.end(); await readyConnection.end(); }
    expect((await owner.query('SELECT readiness_state FROM verify_quote_lines WHERE id=$1', [line])).rows[0].readiness_state).toBe('NEEDS_COMPLETION');
    expect((await owner.query('SELECT count(*)::int count FROM audit_logs WHERE correlation_id=$1', [raceCorrelation])).rows[0].count).toBe(0);

    const second = await client(writer, companyA);
    let requestB: string; let lineB: string;
    try {
      requestB = await createRequest(second, writer, companyA);
      const revisionB = await createRevision(second, writer, companyA, requestB, null, 'race-b');
      lineB = (await lineIds(revisionB)).get(1)!;
    } finally { await second.end(); }

    const readyFirst = await client(writer, companyA);
    const cancelSecond = await client(writer, companyA);
    try {
      await readyFirst.query('BEGIN');
      await readyFirst.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, lineB, 'READY_FOR_VERIFICATION', null, id()]);
      const pendingCancel = settled(cancelSecond.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, requestB, id()]));
      expect(await waitUntilLockBlocked()).toBe(true);
      await readyFirst.query('COMMIT');
      expect(await pendingCancel).toBeNull();
    } finally { await readyFirst.end(); await cancelSecond.end(); }
    expect((await owner.query('SELECT readiness_state FROM verify_quote_lines WHERE id=$1', [lineB])).rows[0].readiness_state).toBe('READY_FOR_VERIFICATION');
    expect((await owner.query('SELECT status FROM verify_requests WHERE id=$1', [requestB])).rows[0].status).toBe('CANCELLED');
  }, 60_000);

  it('never commits a readiness mutation after cancellation under repeated contention', async () => {
    const iterations = 25;
    let denials = 0;
    for (let index = 0; index < iterations; index += 1) {
      const setup = await client(writer, companyA);
      let request: string; let line: string;
      try {
        request = await createRequest(setup, writer, companyA);
        const revision = await createRevision(setup, writer, companyA, request, null, `stress-${index}`);
        line = (await lineIds(revision)).get(1)!;
      } finally { await setup.end(); }

      const cancelConnection = await client(writer, companyA);
      const readyConnection = await client(writer, companyA);
      const correlation = id();
      try {
        await cancelConnection.query('BEGIN');
        await cancelConnection.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, request, id()]);
        const pending = settled(readyConnection.query('SELECT partner_verify_line_readiness_set($1,$2,$3,$4,$5,$6)', [writer, companyA, line, 'READY_FOR_VERIFICATION', null, correlation]));
        await waitUntilLockBlocked();
        await cancelConnection.query('COMMIT');
        if ((await pending) === null) throw new Error('readiness committed after cancellation');
        denials += 1;
      } finally { await cancelConnection.end(); await readyConnection.end(); }

      expect((await owner.query('SELECT readiness_state FROM verify_quote_lines WHERE id=$1', [line])).rows[0].readiness_state).toBe('NEEDS_COMPLETION');
      expect((await owner.query('SELECT count(*)::int count FROM audit_logs WHERE correlation_id=$1', [correlation])).rows[0].count).toBe(0);
    }
    expect(denials).toBe(iterations);
  }, 180_000);

  it('rolls back lifecycle mutation when audit fails and denies direct runtime DML without procurement or raw-content side effects', async () => {
    const before = (await owner.query('SELECT (SELECT count(*)::int FROM rfqs) rfqs,(SELECT count(*)::int FROM supplier_purchase_orders) pos,(SELECT count(*)::int FROM verify_results) results')).rows[0];
    const connection = await client(writer, companyA);
    const correlation = id();
    try {
      const request = await createRequest(connection, writer, companyA);
      await owner.query(`CREATE FUNCTION public.verify_test_fail_lifecycle_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='verify.request.cancelled' AND NEW.correlation_id='${correlation}'::uuid THEN RAISE EXCEPTION 'VERIFY_TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$`);
      await owner.query('CREATE TRIGGER verify_test_fail_lifecycle_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.verify_test_fail_lifecycle_audit()');
      await expect(connection.query('SELECT partner_verify_request_cancel($1,$2,$3,$4)', [writer, companyA, request, correlation])).rejects.toThrow('VERIFY_TEST_AUDIT_FAILURE');
      await owner.query('DROP TRIGGER verify_test_fail_lifecycle_audit ON public.audit_logs');
      await owner.query('DROP FUNCTION public.verify_test_fail_lifecycle_audit()');
      expect((await owner.query('SELECT status FROM verify_requests WHERE id=$1', [request])).rows[0].status).toBe('DRAFT');
      await expect(connection.query('INSERT INTO verify_requests(company_id,requested_by) VALUES($1,$2)', [companyA, writer])).rejects.toThrow(/permission denied/i);
      await connection.query('SET row_security=off');
      await expect(connection.query('SELECT * FROM verify_requests')).rejects.toThrow(/permission denied|row-level security/i);
    } finally { await connection.end(); }
    const tables = await owner.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname LIKE 'verify_%' AND relkind='r'`);
    expect(tables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    expect((await owner.query('SELECT (SELECT count(*)::int FROM rfqs) rfqs,(SELECT count(*)::int FROM supplier_purchase_orders) pos,(SELECT count(*)::int FROM verify_results) results')).rows[0]).toEqual(before);
    expect((await owner.query(`SELECT count(*)::int count FROM "Permission" WHERE code LIKE 'verify.%'`)).rows[0].count).toBe(3);
    expect((await owner.query(`SELECT count(*)::int count FROM "Permission" WHERE code='partner_verify.write'`)).rows[0].count).toBe(1);
    const gateway = await owner.query(`SELECT pg_get_functiondef('public.partner_verify_revision_create(uuid,uuid,uuid,uuid,text[],jsonb,uuid,uuid,text,jsonb,text,text)'::regprocedure) definition`);
    expect(gateway.rows[0].definition).not.toMatch(/storage_key|raw_content_access|raw_quote_content_open/i);
  });
});
