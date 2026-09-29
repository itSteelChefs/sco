import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let companyA: string; let companyB: string; let internalCompany: string;
let partnerA: string; let partnerB: string; let analyst: string; let approver: string; let rawReviewer: string;
let requestA: string; let requestB: string; let revisionA: string; let revisionB: string;
let lineA: string; let failedRun: string; let completedRun: string; let preparedResult: string;

async function grant(userId: string, code: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, internalCompany])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, internalCompany, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), internalCompany, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), internalCompany, role, code]);
}

async function executor(actor: string, tenant = companyA) {
  const client = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
  await client.connect();
  await client.query(`SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false)`, [actor, tenant]);
  return client;
}

async function prepare(client: Client, actor: string, run: string, classification = 'PARTIAL', supersedes: string | null = null, correlation = id()) {
  const prepared = await client.query(`SELECT internal_verify_result_prepare($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10) result_id`, [actor, run, classification, '{}', '{}', '{}', '{}', '{}', supersedes, correlation]);
  return prepared.rows[0].result_id as string;
}

async function rawGrant(actor: string, request: string, revision: string | null, timing = 'active') {
  const grantId = id();
  const starts = timing === 'expired' ? "now()-interval '2 hours'" : "now()-interval '1 minute'";
  const expires = timing === 'expired' ? "now()-interval '1 hour'" : "now()+interval '1 hour'";
  await owner.query(`INSERT INTO verify_raw_review_grants(id,actor_user_id,verify_request_id,verify_quote_revision_id,purpose,scope_description,reason,authorization_basis,starts_at,expires_at,revoked_at,authorized_by)
    VALUES($1,$2,$3,$4,'quality review','single quote revision','comparison exception','independent authorization',${starts},${expires},${timing === 'revoked' ? 'now()' : 'NULL'},$5)`, [grantId, actor, request, revision, approver]);
  return grantId;
}

describe('Verify V0.1 foundation security remediation', () => {
  beforeAll(async () => {
    companyA = id(); companyB = id(); internalCompany = id(); partnerA = id(); partnerB = id(); analyst = id(); approver = id(); rawReviewer = id();
    await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,\'Verify A\',\'PARTNER\'),($2,\'Verify B\',\'PARTNER\'),($3,\'Verify Internal\',\'SCO\')', [companyA, companyB, internalCompany]);
    await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\'),($3,$4,\'x\'),($5,$6,\'x\'),($7,$8,\'x\'),($9,$10,\'x\')', [partnerA, `${partnerA}@verify.test`, partnerB, `${partnerB}@verify.test`, analyst, `${analyst}@verify.test`, approver, `${approver}@verify.test`, rawReviewer, `${rawReviewer}@verify.test`]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\'),($4,$5,$6,\'ACTIVE\'),($7,$8,$9,\'ACTIVE\'),($10,$11,$9,\'ACTIVE\'),($12,$13,$9,\'ACTIVE\')', [id(), partnerA, companyA, id(), partnerB, companyB, id(), analyst, internalCompany, id(), approver, id(), rawReviewer]);
    await grant(analyst, 'verify.analyst'); await grant(approver, 'verify.approver'); await grant(rawReviewer, 'verify.raw_review_access');
    requestA = id(); requestB = id(); revisionA = id(); revisionB = id(); lineA = id(); failedRun = id(); completedRun = id();
    await owner.query('INSERT INTO verify_requests(id,company_id,requested_by,human_review_consented_at,human_review_consented_by) VALUES($1,$2,$3,now(),$3),($4,$5,$6,NULL,NULL)', [requestA, companyA, partnerA, requestB, companyB, partnerB]);
    await owner.query('INSERT INTO verify_quote_revisions(id,verify_request_id,revision_number,submitted_currencies,input_fingerprint,created_by) VALUES($1,$2,1,ARRAY[\'SAR\'],\'input-a\',$3),($4,$5,1,ARRAY[\'USD\'],\'input-b\',$6)', [revisionA, requestA, partnerA, revisionB, requestB, partnerB]);
    await owner.query('INSERT INTO verify_quote_lines(id,verify_quote_revision_id,line_number,currency_code,unit_price,is_price_bearing,readiness_state) VALUES($1,$2,1,\'SAR\',100,true,\'NEEDS_COMPLETION\')', [lineA, revisionA]);
    await owner.query('INSERT INTO verify_runs(id,verify_quote_revision_id,methodology_version,evidence_fingerprint,status,created_by) VALUES($1,$2,\'verify-v0.1\',\'failed\',\'FAILED\',$3),($4,$2,\'verify-v0.1\',\'complete\',\'COMPLETED\',$3)', [failedRun, revisionA, analyst, completedRun]);
  });

  afterAll(async () => {
    await owner.query(`TRUNCATE
      verify_raw_content_access_events,
      verify_raw_review_grants,
      verify_results,
      verify_evidence_bindings,
      verify_runs,
      verify_quote_level_adjustments,
      verify_quote_line_adjustments,
      verify_quote_lines,
      verify_quote_revisions,
      verify_requests`);
    await owner.end();
  });

  it('uses trusted gateways for approved line and run transitions while protected fields remain immutable', async () => {
    const queued = id();
    const completes = id();
    const cancels = id();
    await owner.query('INSERT INTO verify_runs(id,verify_quote_revision_id,methodology_version,evidence_fingerprint,created_by) VALUES($1,$2,\'verify-v0.1\',\'transition\',$3)', [queued, revisionA, analyst]);
    await owner.query('INSERT INTO verify_runs(id,verify_quote_revision_id,methodology_version,evidence_fingerprint,created_by) VALUES($1,$2,\'verify-v0.1\',\'complete-transition\',$3),($4,$2,\'verify-v0.1\',\'cancel-transition\',$3)', [completes, revisionA, analyst, cancels]);
    const client = await executor(analyst);
    try {
      await client.query('SELECT internal_verify_quote_line_transition($1,$2,\'READY_FOR_VERIFICATION\',NULL,$3)', [analyst, lineA, id()]);
      await client.query('SELECT internal_verify_quote_line_transition($1,$2,\'NOT_VERIFIABLE\',\'insufficient identity\',$3)', [analyst, lineA, id()]);
      await client.query('SELECT internal_verify_run_transition($1,$2,\'RUNNING\',$3)', [analyst, queued, id()]);
      await client.query('SELECT internal_verify_run_transition($1,$2,\'FAILED\',$3)', [analyst, queued, id()]);
      await client.query('SELECT internal_verify_run_transition($1,$2,\'RUNNING\',$3)', [analyst, completes, id()]);
      await client.query('SELECT internal_verify_run_transition($1,$2,\'COMPLETED\',$3)', [analyst, completes, id()]);
      await client.query('SELECT internal_verify_run_transition($1,$2,\'CANCELLED\',$3)', [analyst, cancels, id()]);
      await expect(client.query('SELECT internal_verify_run_transition($1,$2,\'RUNNING\',$3)', [analyst, queued, id()])).rejects.toThrow('VERIFY_RUN_IMMUTABLE');
    } finally { await client.end(); }
    await expect(owner.query('UPDATE verify_quote_lines SET unit_price=1 WHERE id=$1', [lineA])).rejects.toThrow('VERIFY_QUOTE_LINE_IMMUTABLE');
    await expect(owner.query('UPDATE verify_runs SET methodology_version=\'rewrite\' WHERE id=$1', [failedRun])).rejects.toThrow('VERIFY_RUN_IMMUTABLE');
  });

  it('enforces retry lineage and immediate insert-only linkage', async () => {
    await owner.query('INSERT INTO verify_runs(id,verify_quote_revision_id,retry_of_run_id,methodology_version,evidence_fingerprint,created_by) VALUES($1,$2,$3,\'verify-v0.2\',\'retry\',$4)', [id(), revisionA, failedRun, analyst]);
    await expect(owner.query('INSERT INTO verify_runs(id,verify_quote_revision_id,retry_of_run_id,methodology_version,evidence_fingerprint,created_by) VALUES($1,$2,$3,\'verify-v0.2\',\'cross-tenant\',$4)', [id(), revisionB, failedRun, analyst])).rejects.toThrow('VERIFY_RUN_RETRY_INVALID');
    await expect(owner.query('INSERT INTO verify_runs(id,verify_quote_revision_id,retry_of_run_id,methodology_version,evidence_fingerprint,created_by) VALUES($1,$2,$3,\'verify-v0.2\',\'not-failed\',$4)', [id(), revisionA, completedRun, analyst])).rejects.toThrow('VERIFY_RUN_RETRY_INVALID');
    const self = id();
    await expect(owner.query('INSERT INTO verify_runs(id,verify_quote_revision_id,retry_of_run_id,methodology_version,evidence_fingerprint,created_by) VALUES($1,$2,$1,\'verify-v0.2\',\'self\',$3)', [self, revisionA, analyst])).rejects.toThrow(/foreign key|VERIFY_RUN_RETRY_INVALID/i);
  });

  it('enforces exact document/version and tenant ownership for quote and evidence bindings', async () => {
    const documentA = id(); const documentB = id(); const versionA = id(); const versionB = id();
    await owner.query(`INSERT INTO documents(id,company_id,filename,detected_mime_type,byte_size,storage_key,sha256,status) VALUES($1,$2,'a.pdf','application/pdf',1,$3,'a','AVAILABLE'),($4,$5,'b.pdf','application/pdf',1,$6,'b','AVAILABLE')`, [documentA, companyA, `verify/${documentA}`, documentB, companyB, `verify/${documentB}`]);
    await owner.query('INSERT INTO document_versions(id,company_id,document_id,version,storage_key,sha256) VALUES($1,$2,$3,1,$4,\'a\'),($5,$6,$7,1,$8,\'b\')', [versionA, companyA, documentA, `verify/${versionA}`, versionB, companyB, documentB, `verify/${versionB}`]);
    await expect(owner.query('INSERT INTO verify_quote_revisions(verify_request_id,revision_number,submitted_currencies,raw_content_document_id,raw_content_version_id,input_fingerprint,created_by) VALUES($1,2,ARRAY[\'SAR\'],$2,$3,\'bad-doc\',$4)', [requestA, documentA, versionB, partnerA])).rejects.toThrow('VERIFY_QUOTE_DOCUMENT_INVALID');
    await expect(owner.query('INSERT INTO verify_evidence_bindings(verify_run_id,evidence_type,source_identity,source_version_identity,document_id,document_version_id,approval_state,confidentiality_class,integrity_version_reference,created_by) VALUES($1,\'REFERENCE\',\'source\',\'v1\',$2,$3,\'APPROVED\',\'INTERNAL\',\'sha256:x\',$4)', [completedRun, documentB, versionB, analyst])).rejects.toThrow('VERIFY_EVIDENCE_DOCUMENT_INVALID');
    await owner.query('INSERT INTO verify_evidence_bindings(verify_run_id,evidence_type,source_identity,source_version_identity,document_id,document_version_id,approval_state,confidentiality_class,integrity_version_reference,created_by) VALUES($1,\'REFERENCE\',\'source\',\'v1\',$2,$3,\'APPROVED\',\'INTERNAL\',\'sha256:a\',$4)', [completedRun, documentA, versionA, analyst]);
  });

  it('requires analyst preparation, records its authorization path, and cannot prepare FINAL', async () => {
    const analystClient = await executor(analyst);
    try {
      preparedResult = await prepare(analystClient, analyst, completedRun);
    } finally { await analystClient.end(); }
    expect((await owner.query('SELECT status,prepared_by FROM verify_results WHERE id=$1', [preparedResult])).rows[0]).toEqual({ status: 'PREPARED', prepared_by: analyst });
    expect((await owner.query(`SELECT actor_user_id,metadata->>'runId' run_id,metadata->>'authorizationPath' capability FROM audit_logs WHERE action='verify.result.prepared' AND entity_id=$1`, [preparedResult])).rows[0]).toEqual({ actor_user_id: analyst, run_id: completedRun, capability: 'verify.analyst' });
  });

  it('denies preparation without verify.analyst and rolls preparation back when its audit fails', async () => {
    for (const actor of [approver, rawReviewer]) {
      const client = await executor(actor);
      try { await expect(prepare(client, actor, completedRun)).rejects.toThrow('VERIFY_ANALYST_FORBIDDEN'); } finally { await client.end(); }
    }
    const auditFailureRun = id(); const auditCorrelation = id();
    await owner.query('INSERT INTO verify_runs(id,verify_quote_revision_id,methodology_version,evidence_fingerprint,status,created_by) VALUES($1,$2,\'verify-v0.1\',\'audit-failure\',\'COMPLETED\',$3)', [auditFailureRun, revisionA, analyst]);
    await owner.query(`CREATE FUNCTION public.verify_test_fail_prepare_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='verify.result.prepared' AND NEW.correlation_id='${auditCorrelation}'::uuid THEN RAISE EXCEPTION 'VERIFY_TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$`);
    await owner.query('CREATE TRIGGER verify_test_fail_prepare_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.verify_test_fail_prepare_audit()');
    const analystClient = await executor(analyst);
    try { await expect(prepare(analystClient, analyst, auditFailureRun, 'PARTIAL', null, auditCorrelation)).rejects.toThrow('VERIFY_TEST_AUDIT_FAILURE'); } finally { await analystClient.end(); }
    await owner.query('DROP TRIGGER verify_test_fail_prepare_audit ON public.audit_logs');
    await owner.query('DROP FUNCTION public.verify_test_fail_prepare_audit()');
    expect((await owner.query('SELECT count(*)::int count FROM verify_results WHERE verify_run_id=$1', [auditFailureRun])).rows[0].count).toBe(0);
  });

  it('requires separate approver finalization, preserves FINAL fields, and makes supersession explicit', async () => {
    await expect(owner.query('INSERT INTO verify_results(verify_run_id,methodology_version,classification,status,prepared_by,finalised_by,finalised_at) VALUES($1,\'verify-v0.1\',\'FULL\',\'FINAL\',$2,$2,now())', [completedRun, analyst])).rejects.toThrow('VERIFY_RESULT_INVALID');
    await expect(owner.query('INSERT INTO verify_results(verify_run_id,methodology_version,classification,prepared_by) VALUES($1,\'wrong-method\',\'FULL\',$2)', [completedRun, analyst])).rejects.toThrow('VERIFY_RESULT_INVALID');
    for (const actor of [analyst, rawReviewer]) {
      const client = await executor(actor);
      try { await expect(client.query('SELECT internal_verify_result_finalize($1,$2,$3)', [actor, preparedResult, id()])).rejects.toThrow('VERIFY_APPROVER_FORBIDDEN'); } finally { await client.end(); }
    }
    const approverClient = await executor(approver);
    try { await approverClient.query('SELECT internal_verify_result_finalize($1,$2,$3)', [approver, preparedResult, id()]); } finally { await approverClient.end(); }
    await expect(owner.query('UPDATE verify_results SET status=\'PREPARED\' WHERE id=$1', [preparedResult])).rejects.toThrow('VERIFY_RESULT_IMMUTABLE');
    await expect(owner.query('UPDATE verify_results SET classification=\'FULL\' WHERE id=$1', [preparedResult])).rejects.toThrow('VERIFY_RESULT_IMMUTABLE');

    const replacementRun = id(); let replacement: string;
    await owner.query('INSERT INTO verify_runs(id,verify_quote_revision_id,methodology_version,evidence_fingerprint,status,created_by) VALUES($1,$2,\'verify-v0.2\',\'replacement\',\'COMPLETED\',$3)', [replacementRun, revisionA, analyst]);
    const analystClient = await executor(analyst);
    try { replacement = await prepare(analystClient, analyst, replacementRun, 'FULL', preparedResult); } finally { await analystClient.end(); }
    const client = await executor(approver);
    try {
      await client.query('SELECT internal_verify_result_finalize($1,$2,$3)', [approver, replacement, id()]);
      await client.query('SELECT internal_verify_result_supersede($1,$2,$3,$4)', [approver, preparedResult, replacement, id()]);
    } finally { await client.end(); }
    expect((await owner.query('SELECT status FROM verify_results WHERE id=$1', [preparedResult])).rows[0].status).toBe('SUPERSEDED');
  });

  it('records separate analyst and approver audit actions for one dual-capability user', async () => {
    await grant(analyst, 'verify.approver');
    const run = id();
    await owner.query('INSERT INTO verify_runs(id,verify_quote_revision_id,methodology_version,evidence_fingerprint,status,created_by) VALUES($1,$2,\'verify-v0.1\',\'dual-capability\',\'COMPLETED\',$3)', [run, revisionA, analyst]);
    const client = await executor(analyst);
    let result: string;
    try {
      result = await prepare(client, analyst, run, 'FULL');
      await client.query('SELECT internal_verify_result_finalize($1,$2,$3)', [analyst, result, id()]);
    } finally { await client.end(); }
    const audits = await owner.query(`SELECT action,metadata->>'authorizationPath' capability FROM audit_logs WHERE entity_id=$1 AND action IN ('verify.result.prepared','verify.result.finalized') ORDER BY created_at`, [result!]);
    expect(audits.rows).toEqual([{ action: 'verify.result.prepared', capability: 'verify.analyst' }, { action: 'verify.result.finalized', capability: 'verify.approver' }]);
  });

  it('has no grant-issuance or raw-delivery gateway and enforces independent authorization', async () => {
    const functions = await owner.query(`SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('verify_raw_review_grant_create','verify_raw_quote_content_open')`);
    expect(functions.rows).toEqual([]);
    const valid = await rawGrant(rawReviewer, requestA, revisionA);
    const missingConsent = await rawGrant(rawReviewer, requestB, revisionB);
    const expired = await rawGrant(rawReviewer, requestA, revisionA, 'expired');
    const revoked = await rawGrant(rawReviewer, requestA, revisionA, 'revoked');
    const noCapability = await rawGrant(analyst, requestA, revisionA);
    const rawClient = await executor(rawReviewer);
    try {
      await expect(rawClient.query('SELECT internal_verify_raw_review_authorization_check($1,$2,$3,$4,$5)', [rawReviewer, companyA, revisionA, id(), id()])).rejects.toThrow('VERIFY_RAW_REVIEW_FORBIDDEN');
      await expect(rawClient.query('SELECT internal_verify_raw_review_authorization_check($1,$2,$3,$4,$5)', [rawReviewer, companyB, revisionB, missingConsent, id()])).rejects.toThrow('VERIFY_RAW_REVIEW_FORBIDDEN');
      await expect(rawClient.query('SELECT internal_verify_raw_review_authorization_check($1,$2,$3,$4,$5)', [rawReviewer, companyA, revisionA, expired, id()])).rejects.toThrow('VERIFY_RAW_REVIEW_FORBIDDEN');
      await expect(rawClient.query('SELECT internal_verify_raw_review_authorization_check($1,$2,$3,$4,$5)', [rawReviewer, companyA, revisionA, revoked, id()])).rejects.toThrow('VERIFY_RAW_REVIEW_FORBIDDEN');
      await expect(rawClient.query('SELECT internal_verify_raw_review_authorization_check($1,$2,$3,$4,$5)', [approver, companyA, revisionA, valid, id()])).rejects.toThrow('VERIFY_RAW_REVIEW_FORBIDDEN');
      expect((await rawClient.query('SELECT internal_verify_raw_review_authorization_check($1,$2,$3,$4,$5) allowed', [rawReviewer, companyA, revisionA, valid, id()])).rows[0].allowed).toBe(true);
    } finally { await rawClient.end(); }
    const analystClient = await executor(analyst);
    try { await expect(analystClient.query('SELECT internal_verify_raw_review_authorization_check($1,$2,$3,$4,$5)', [analyst, companyA, revisionA, noCapability, id()])).rejects.toThrow('VERIFY_RAW_REVIEW_FORBIDDEN'); } finally { await analystClient.end(); }
    expect((await owner.query(`SELECT metadata->>'contentDeliveryEnabled' enabled FROM audit_logs WHERE action='verify.raw_review.authorization_intent_recorded' ORDER BY created_at DESC LIMIT 1`)).rows[0].enabled).toBe('false');
    expect((await owner.query('SELECT count(*)::int count FROM verify_raw_content_access_events')).rows[0].count).toBe(0);
  });

  it('denies direct DML, preserves FORCE RLS, and creates no procurement side effects', async () => {
    const before = (await owner.query('SELECT (SELECT count(*)::int FROM rfqs) rfqs,(SELECT count(*)::int FROM supplier_purchase_orders) pos,(SELECT count(*)::int FROM procurement_releases) releases')).rows[0];
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); await runtime.connect();
    try {
      await runtime.query(`SELECT set_config('app.tenant_id',$1,false),set_config('app.actor_id',$2,false)`, [companyB, partnerB]);
      await expect(runtime.query('SELECT * FROM verify_requests WHERE id=$1', [requestA])).rejects.toThrow(/permission denied/i);
      await expect(runtime.query('SELECT * FROM verify_quote_lines WHERE id=$1', [lineA])).rejects.toThrow(/permission denied/i);
      await expect(runtime.query('INSERT INTO verify_requests(company_id,requested_by) VALUES($1,$2)', [companyA, partnerB])).rejects.toThrow(/permission denied/i);
      await expect(runtime.query('INSERT INTO verify_raw_review_grants(actor_user_id,verify_request_id,purpose,scope_description,reason,authorization_basis,starts_at,expires_at,authorized_by) VALUES($1,$2,\'x\',\'x\',\'x\',\'x\',now(),now()+interval \'1 hour\',$3)', [partnerB, requestA, partnerA])).rejects.toThrow(/permission denied/i);
      await runtime.query('SET row_security=off');
      await expect(runtime.query('SELECT * FROM verify_requests')).rejects.toThrow(/permission denied|row-level security/i);
    } finally { await runtime.end(); }
    const tables = await owner.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname LIKE 'verify_%' AND relkind='r'`);
    expect(tables.rows.length).toBeGreaterThanOrEqual(10); expect(tables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    expect((await owner.query('SELECT (SELECT count(*)::int FROM rfqs) rfqs,(SELECT count(*)::int FROM supplier_purchase_orders) pos,(SELECT count(*)::int FROM procurement_releases) releases')).rows[0]).toEqual(before);
  });
});
