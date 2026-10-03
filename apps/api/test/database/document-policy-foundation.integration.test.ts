import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const purposeAuthority = new Pool({ connectionString: process.env.PURPOSE_AUTHORITY_DATABASE_URL });
const id = () => randomUUID();

let scoCompany: string;
let partnerA: string;
let partnerB: string;
let actor: string;
let sourceDocument: string;
let derivativeDocument: string;
let foreignDocument: string;
let concurrentDocument: string;
let cycleDocumentA: string;
let cycleDocumentB: string;
let multiNodeDocumentA: string;
let multiNodeDocumentB: string;
let multiNodeDocumentC: string;

async function document(companyId: string, suffix: string) {
  const documentId = id();
  await owner.query(
    `INSERT INTO documents(id,company_id,uploader_user_id,filename,detected_mime_type,byte_size,storage_key,sha256,status)
     VALUES($1,$2,$3,$4,'application/pdf',1,$5,$6,'AVAILABLE')`,
    [documentId, companyId, actor, `${suffix}.pdf`, `${companyId}/${suffix}`, id()],
  );
  return documentId;
}

async function authorize(
  client: Client,
  documentId: string,
  relatedDocumentId: string | null,
  operation: 'POLICY_REVISE' | 'LINEAGE_CREATE',
  actorId = actor,
  companyId = partnerA,
) {
  const binding = (await client.query<{ backend_pid: number; transaction_id: string }>(
    'SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id',
  )).rows[0];
  const decision = (await purposeAuthority.query<{ id: string }>(
    'SELECT public.issue_document_policy_purpose_decision($1,$2,$3,$4,$5) AS id',
    [actorId, companyId, documentId, relatedDocumentId, operation],
  )).rows[0].id;
  await purposeAuthority.query(
    'SELECT public.consume_document_policy_purpose_decision($1,$2,$3,$4,$5,$6,$7,$8::bigint)',
    [decision, actorId, companyId, documentId, relatedDocumentId, operation, binding.backend_pid, binding.transaction_id],
  );
  return decision;
}

async function revise(documentId: string, sensitivity: 'CONFIDENTIAL' | 'RESTRICTED', companyId = partnerA) {
  const client = await internal.connect();
  try {
    await client.query('BEGIN');
    const decision = await authorize(client, documentId, null, 'POLICY_REVISE', actor, companyId);
    const result = await client.query<{ id: string }>(
      `SELECT public.document_policy_revise($1,$2,$3::"DocumentPolicySensitivity",'ACTIVE'::"DocumentPolicyLifecycleState",'UNSET'::"DocumentRetentionMetadataState",NULL,$4) AS id`,
      [actor, documentId, sensitivity, decision],
    );
    await client.query('COMMIT');
    return result.rows[0].id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe('Stage 009-A document policy foundation', () => {
  beforeAll(async () => {
    scoCompany = id();
    partnerA = id();
    partnerB = id();
    actor = id();
    const membership = id();
    const role = id();
    await owner.query(
      `INSERT INTO "Company"(id,name,type) VALUES($1,'Document policy SCO','SCO'),($2,'Document policy A','PARTNER'),($3,'Document policy B','PARTNER')`,
      [scoCompany, partnerA, partnerB],
    );
    await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [actor, `${actor}@document-policy.test`]);
    await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membership, actor, scoCompany]);
    await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,'Document policy manager')`, [role, scoCompany, `document-policy-${role}`]);
    await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(), scoCompany, membership, role]);
    await owner.query(
      `INSERT INTO "RolePermission"(id,company_id,role_id,permission_id)
       SELECT $1,$2,$3,id FROM "Permission" WHERE code='document.policy.manage'`,
      [id(), scoCompany, role],
    );
    sourceDocument = await document(partnerA, 'source');
    derivativeDocument = await document(partnerA, 'derivative');
    foreignDocument = await document(partnerB, 'foreign');
    concurrentDocument = await document(partnerA, 'concurrent');
    cycleDocumentA = await document(partnerA, 'cycle-a');
    cycleDocumentB = await document(partnerA, 'cycle-b');
    multiNodeDocumentA = await document(partnerA, 'multi-a');
    multiNodeDocumentB = await document(partnerA, 'multi-b');
    multiNodeDocumentC = await document(partnerA, 'multi-c');
  });

  afterAll(async () => {
    await owner.end();
    await internal.end();
    await runtime.end();
    await purposeAuthority.end();
  });

  it('creates immutable, fail-closed initial policy evidence without storage locators', async () => {
    const policies = await owner.query(
      `SELECT document_id,owner_company_id,access_scope,sensitivity,disclosure_posture,lifecycle_state,retention_metadata_state
       FROM document_policy_revisions WHERE document_id=$1`,
      [sourceDocument],
    );
    expect(policies.rows).toEqual([{
      document_id: sourceDocument,
      owner_company_id: partnerA,
      access_scope: 'TENANT',
      sensitivity: 'UNCLASSIFIED',
      disclosure_posture: 'HIDDEN',
      lifecycle_state: 'PENDING_POLICY',
      retention_metadata_state: 'UNSET',
    }]);
    await expect(owner.query(`UPDATE document_policy_revisions SET sensitivity='CONFIDENTIAL' WHERE document_id=$1`, [sourceDocument]))
      .rejects.toThrow('DOCUMENT_POLICY_HISTORY_IMMUTABLE');
    await expect(runtime.query(`SELECT * FROM document_policy_revisions`)).rejects.toThrow(/permission denied/i);
    const event = await owner.query(`SELECT row_to_json(e) AS event FROM document_policy_events e WHERE document_id=$1`, [sourceDocument]);
    expect(JSON.stringify(event.rows)).not.toMatch(/storage_key|storageKey|bucket|path|url/i);
  });

  it('preserves revisions and rejects sensitivity downgrade or caller purpose substitution', async () => {
    const first = await revise(sourceDocument, 'CONFIDENTIAL');
    expect(first).toEqual(expect.any(String));
    await expect(revise(sourceDocument, 'UNCLASSIFIED' as never)).rejects.toThrow('DOCUMENT_POLICY_BROADENING_FORBIDDEN');
    const client = await internal.connect();
    try {
      await client.query('BEGIN');
      const decision = await authorize(client, sourceDocument, null, 'POLICY_REVISE');
      await expect(client.query(
        `SELECT public.document_policy_revise($1,$2,'RESTRICTED'::"DocumentPolicySensitivity",'ACTIVE'::"DocumentPolicyLifecycleState",'UNSET'::"DocumentRetentionMetadataState",NULL,$3)`,
        [actor, sourceDocument, id()],
      )).rejects.toThrow('DOCUMENT_POLICY_MANAGE_FORBIDDEN');
      await client.query('ROLLBACK');
      expect(decision).toEqual(expect.any(String));
    } finally {
      client.release();
    }
    const revisions = await owner.query(
      `SELECT revision_number,sensitivity,primary_purpose_code,lifecycle_state FROM document_policy_revisions WHERE document_id=$1 ORDER BY revision_number`,
      [sourceDocument],
    );
    expect(revisions.rows).toEqual([
      { revision_number: 1, sensitivity: 'UNCLASSIFIED', primary_purpose_code: null, lifecycle_state: 'PENDING_POLICY' },
      { revision_number: 2, sensitivity: 'CONFIDENTIAL', primary_purpose_code: 'PUR-15', lifecycle_state: 'ACTIVE' },
    ]);
  });

  it('serializes concurrent revisions into non-contradictory immutable history', async () => {
    await Promise.all([
      revise(concurrentDocument, 'CONFIDENTIAL'),
      revise(concurrentDocument, 'CONFIDENTIAL'),
    ]);
    const revisions = await owner.query(
      `SELECT revision_number,sensitivity,primary_purpose_code,lifecycle_state
       FROM document_policy_revisions WHERE document_id=$1 ORDER BY revision_number`,
      [concurrentDocument],
    );
    expect(revisions.rows).toEqual([
      { revision_number: 1, sensitivity: 'UNCLASSIFIED', primary_purpose_code: null, lifecycle_state: 'PENDING_POLICY' },
      { revision_number: 2, sensitivity: 'CONFIDENTIAL', primary_purpose_code: 'PUR-15', lifecycle_state: 'ACTIVE' },
      { revision_number: 3, sensitivity: 'CONFIDENTIAL', primary_purpose_code: 'PUR-15', lifecycle_state: 'ACTIVE' },
    ]);
  });

  it('rejects forged actor context and actor or resource substitutions without a matching authority decision', async () => {
    const client = await internal.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.actor_id',$1,true)`, [id()]);
      await expect(client.query(
        `SELECT public.document_policy_revise($1,$2,'RESTRICTED'::"DocumentPolicySensitivity",'ACTIVE'::"DocumentPolicyLifecycleState",'UNSET'::"DocumentRetentionMetadataState",NULL,$3)`,
        [actor, sourceDocument, id()],
      )).rejects.toThrow('DOCUMENT_POLICY_MANAGE_FORBIDDEN');
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      const decision = await authorize(client, sourceDocument, null, 'POLICY_REVISE');
      await expect(client.query(
        `SELECT public.document_policy_revise($1,$2,'RESTRICTED'::"DocumentPolicySensitivity",'ACTIVE'::"DocumentPolicyLifecycleState",'UNSET'::"DocumentRetentionMetadataState",NULL,$3)`,
        [actor, derivativeDocument, decision],
      )).rejects.toThrow('DOCUMENT_POLICY_MANAGE_FORBIDDEN');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('does not give the document-policy gateway owner direct RBAC visibility or mutation authority', async () => {
    const client = await owner.connect();
    try {
      await client.query('SET ROLE sco_document_policy_gateway_owner');
      await expect(client.query(`SELECT * FROM "CompanyMembership"`)).rejects.toThrow(/permission denied/i);
      await expect(client.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(), scoCompany, id(), id()]))
        .rejects.toThrow(/permission denied/i);
    } finally {
      await client.query('RESET ROLE').catch(() => undefined);
      client.release();
    }
  });

  it('serializes concurrent opposing lineage edges so the graph remains acyclic', async () => {
    await revise(cycleDocumentA, 'RESTRICTED');
    await revise(cycleDocumentB, 'RESTRICTED');
    const create = async (source: string, derived: string) => {
      const client = await internal.connect();
      try {
        await client.query('BEGIN');
        const decision = await authorize(client, source, derived, 'LINEAGE_CREATE');
        await client.query(`SELECT public.document_lineage_derivative_create($1,$2,$3,$4)`, [actor, source, derived, decision]);
        await client.query('COMMIT');
        return 'committed';
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        return String(error);
      } finally {
        client.release();
      }
    };

    const results = await Promise.all([
      create(cycleDocumentA, cycleDocumentB),
      create(cycleDocumentB, cycleDocumentA),
    ]);
    expect(results.filter((result) => result === 'committed')).toHaveLength(1);
    expect(results.some((result) => result.includes('DOCUMENT_LINEAGE_CYCLE'))).toBe(true);
    const edges = await owner.query(
      `SELECT source_document_id,derived_document_id FROM document_lineage_edges
       WHERE source_document_id IN ($1,$2) OR derived_document_id IN ($1,$2)`,
      [cycleDocumentA, cycleDocumentB],
    );
    expect(edges.rows).toHaveLength(1);
  });

  it('serializes concurrent three-node cycle closure attempts', async () => {
    await revise(multiNodeDocumentA, 'RESTRICTED');
    await revise(multiNodeDocumentB, 'RESTRICTED');
    await revise(multiNodeDocumentC, 'RESTRICTED');
    const create = async (source: string, derived: string) => {
      const client = await internal.connect();
      try {
        await client.query('BEGIN');
        const decision = await authorize(client, source, derived, 'LINEAGE_CREATE');
        await client.query(`SELECT public.document_lineage_derivative_create($1,$2,$3,$4)`, [actor, source, derived, decision]);
        await client.query('COMMIT');
        return 'committed';
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        return String(error);
      } finally {
        client.release();
      }
    };

    await expect(create(multiNodeDocumentA, multiNodeDocumentB)).resolves.toBe('committed');
    const results = await Promise.all([
      create(multiNodeDocumentB, multiNodeDocumentC),
      create(multiNodeDocumentC, multiNodeDocumentA),
    ]);
    expect(results.filter((result) => result === 'committed')).toHaveLength(1);
    expect(results.some((result) => result.includes('DOCUMENT_LINEAGE_CYCLE'))).toBe(true);
  });

  it('keeps versions distinct from derivatives and preserves restrictive derivative lineage', async () => {
    await owner.query(
      `INSERT INTO document_versions(id,company_id,document_id,version,storage_key,sha256)
       VALUES($1,$2,$3,1,$4,$5)`,
      [id(), partnerA, sourceDocument, `${partnerA}/source-v1`, id()],
    );
    await revise(derivativeDocument, 'RESTRICTED');
    const client = await internal.connect();
    try {
      await client.query('BEGIN');
      const decision = await authorize(client, sourceDocument, derivativeDocument, 'LINEAGE_CREATE');
      const edge = await client.query<{ id: string }>(
        `SELECT public.document_lineage_derivative_create($1,$2,$3,$4) AS id`,
        [actor, sourceDocument, derivativeDocument, decision],
      );
      await client.query('COMMIT');
      expect(edge.rows[0].id).toEqual(expect.any(String));
    } finally {
      client.release();
    }
    const cycle = await internal.connect();
    try {
      await cycle.query('BEGIN');
      const decision = await authorize(cycle, derivativeDocument, sourceDocument, 'LINEAGE_CREATE');
      await expect(cycle.query(`SELECT public.document_lineage_derivative_create($1,$2,$3,$4)`, [actor, derivativeDocument, sourceDocument, decision]))
        .rejects.toThrow('DOCUMENT_LINEAGE_CYCLE');
    } finally {
      await cycle.query('ROLLBACK').catch(() => undefined);
      cycle.release();
    }
    const lineage = await owner.query(`SELECT source_document_id,derived_document_id FROM document_lineage_edges WHERE derived_document_id=$1`, [derivativeDocument]);
    expect(lineage.rows).toEqual([{ source_document_id: sourceDocument, derived_document_id: derivativeDocument }]);
  });

  it('denies cross-company lineage and leaves every delivery/disclosure operation inactive', async () => {
    await revise(foreignDocument, 'RESTRICTED', partnerB);
    const client = await internal.connect();
    try {
      await client.query('BEGIN');
      await expect(client.query(`SELECT public.document_lineage_derivative_create($1,$2,$3,$4)`, [actor, sourceDocument, foreignDocument, id()]))
        .rejects.toThrow('DOCUMENT_LINEAGE_MANAGE_FORBIDDEN');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const operations = await owner.query<{ operation: string; allowed: boolean }>(
      `SELECT value::text AS operation, public.document_policy_operation_allowed($1,value) AS allowed
       FROM unnest(enum_range(NULL::"DocumentPolicyOperation")) AS value`,
      [sourceDocument],
    );
    expect(operations.rows).toHaveLength(8);
    expect(operations.rows.every((row) => row.allowed === false)).toBe(true);
  });
});
