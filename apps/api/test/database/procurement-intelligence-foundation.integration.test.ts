import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool, type PoolClient } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const purposeAuthority = new Pool({ connectionString: process.env.PURPOSE_AUTHORITY_DATABASE_URL });
const id = () => randomUUID();

let sco: string;
let partner: string;
let actor: string;
let summaryReader: string;
let lineageReader: string;
let product: string;
let otherProduct: string;
let unit: string;
let otherUnit: string;
let sourceSnapshot: string;
let alternateSourceSnapshot: string;
let unpublishedSourceSnapshot: string;

async function principal(permissions: string[], suffix: string) {
  const user = id();
  const membership = id();
  const role = id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [user, `${suffix}-${user}@pi.test`]);
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membership, user, sco]);
  await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3)`, [role, sco, `pi-${role}`]);
  await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(), sco, membership, role]);
  for (const permission of permissions) {
    await owner.query(
      `INSERT INTO "RolePermission"(id,company_id,role_id,permission_id)
       SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`,
      [id(), sco, role, permission],
    );
  }
  return user;
}

async function buyingPowerSnapshot(
  requestKey: string,
  status: 'STARTED' | 'PUBLISHED',
  productId = product,
  unitId = unit,
  quantity = 10,
) {
  const run = id();
  const snapshot = id();
  const line = id();
  await owner.query(
    `INSERT INTO buying_power_aggregation_runs(
       id,initiated_by,horizon,time_bucket,request_key,source_fingerprint,status,completed_at
     ) VALUES($1,$2,'WEEKLY_IMMEDIATE',current_date,$3,$4,$5,$6)`,
    [run, actor, requestKey, `fingerprint-${requestKey}`, status, status === 'PUBLISHED' ? new Date() : null],
  );
  await owner.query(
    `INSERT INTO buying_power_snapshots(
       id,aggregation_run_id,horizon,time_bucket,cutoff_at,source_fingerprint,published_by
     ) VALUES($1,$2,'WEEKLY_IMMEDIATE',current_date,clock_timestamp(),$3,$4)`,
    [snapshot, run, `fingerprint-${requestKey}`, actor],
  );
  await owner.query(
    `INSERT INTO buying_power_snapshot_lines(
       id,snapshot_id,product_identity_id,unit_id,committed_quantity,open_quantity
     ) VALUES($1,$2,$3,$4,$5,$5)`,
    [line, snapshot, productId, unitId, quantity],
  );
  await owner.query(
    `INSERT INTO buying_power_snapshot_source_memberships(
       id,snapshot_line_id,snapshot_id,source_type,source_record_id,source_company_id,
       contribution_class,contribution_quantity,unit_id,source_reference
     ) VALUES($1,$2,$3,'NEED',$4,$5,'COMMITTED',$6,$7,'{}')`,
    [id(), line, snapshot, id(), partner, quantity, unitId],
  );
  return snapshot;
}

async function issue(actorUserId: string, sourceId: string) {
  const result = await purposeAuthority.query<{ decision_id: string; authorization_company_id: string }>(
    'SELECT * FROM public.issue_procurement_intelligence_purpose_decision($1,$2)',
    [actorUserId, sourceId],
  );
  return result.rows[0];
}

async function authorize(client: PoolClient, actorUserId: string, sourceId: string) {
  const binding = (await client.query<{ backend_pid: number; transaction_id: string }>(
    'SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id',
  )).rows[0];
  const decision = await issue(actorUserId, sourceId);
  await purposeAuthority.query(
    'SELECT public.consume_procurement_intelligence_purpose_decision($1,$2,$3,$4,$5,$6::bigint)',
    [
      decision.decision_id,
      actorUserId,
      decision.authorization_company_id,
      sourceId,
      binding.backend_pid,
      binding.transaction_id,
    ],
  );
  return decision.decision_id;
}

async function materialize(
  sourceId: string,
  requestKey: string,
  actorUserId = actor,
  correlationId: string | null = null,
) {
  const client = await internal.connect();
  try {
    await client.query('BEGIN');
    const decision = await authorize(client, actorUserId, sourceId);
    const result = await client.query<{ run_id: string; snapshot_id: string }>(
      'SELECT * FROM public.internal_procurement_intelligence_run($1,$2,$3,$4,$5)',
      [actorUserId, sourceId, requestKey, correlationId, decision],
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe('Stage 010-A Procurement Intelligence foundation', () => {
  beforeAll(async () => {
    sco = id();
    partner = id();
    await owner.query(
      `INSERT INTO "Company"(id,name,type) VALUES($1,'PI SCO','SCO'),($2,'PI Partner','PARTNER')`,
      [sco, partner],
    );
    actor = await principal(['procurement_intelligence.aggregate'], 'aggregate');
    summaryReader = await principal(['procurement_intelligence.read_summary'], 'summary');
    lineageReader = await principal(['procurement_intelligence.read_lineage'], 'lineage');
    const creator = id();
    const category = id();
    const otherCategory = id();
    unit = id();
    otherUnit = id();
    product = id();
    otherProduct = id();
    await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [creator, `${creator}@pi.test`]);
    await owner.query(`INSERT INTO product_categories(id,code,name) VALUES($1,$2,'PI'),($3,$4,'PI other')`, [category, `pi-${category}`, otherCategory, `pi-${otherCategory}`]);
    await owner.query(`INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,'Each','count'),($3,$4,'Box','count')`, [unit, `pi-${unit}`, otherUnit, `pi-${otherUnit}`]);
    await owner.query(
      `INSERT INTO product_identities(id,category_id,unit_id,created_by,status)
       VALUES($1,$2,$3,$4,'ACTIVE'),($5,$6,$7,$4,'ACTIVE')`,
      [product, category, unit, creator, otherProduct, otherCategory, otherUnit],
    );
    sourceSnapshot = await buyingPowerSnapshot('pi-source-primary', 'PUBLISHED');
    alternateSourceSnapshot = await buyingPowerSnapshot('pi-source-alternate', 'PUBLISHED', otherProduct, otherUnit, 12);
    unpublishedSourceSnapshot = await buyingPowerSnapshot('pi-source-unpublished', 'STARTED');
  });

  afterAll(async () => {
    await Promise.all([owner.end(), internal.end(), runtime.end(), purposeAuthority.end()]);
  });

  it('materializes only a published Buying Power aggregate with exact Product Identity and Unit', async () => {
    const result = await materialize(sourceSnapshot, 'pi-primary-request', actor, id());
    expect(result).toEqual({ run_id: expect.any(String), snapshot_id: expect.any(String) });
    const lines = await owner.query(
      `SELECT product_identity_id,unit_id,committed_quantity,open_quantity
       FROM procurement_intelligence_snapshot_lines WHERE snapshot_id=$1`,
      [result.snapshot_id],
    );
    expect(lines.rows).toEqual([{
      product_identity_id: product,
      unit_id: unit,
      committed_quantity: '10.0000',
      open_quantity: '10.0000',
    }]);
    const evidence = await owner.query(
      `SELECT r.status,s.source_buying_power_snapshot_id,s.source_fingerprint
       FROM procurement_intelligence_runs r
       JOIN procurement_intelligence_snapshots s ON s.procurement_intelligence_run_id=r.id
       WHERE r.id=$1`,
      [result.run_id],
    );
    expect(evidence.rows).toEqual([{
      status: 'PUBLISHED',
      source_buying_power_snapshot_id: sourceSnapshot,
      source_fingerprint: 'fingerprint-pi-source-primary',
    }]);
  });

  it('rejects unpublished, fabricated, direct operational, and capability-only sources', async () => {
    await expect(issue(actor, unpublishedSourceSnapshot)).rejects.toThrow('PROCUREMENT_INTELLIGENCE_PURPOSE_ISSUE_FORBIDDEN');
    await expect(issue(actor, id())).rejects.toThrow('PROCUREMENT_INTELLIGENCE_PURPOSE_ISSUE_FORBIDDEN');
    const client = await internal.connect();
    try {
      await client.query('BEGIN');
      await expect(client.query(
        'SELECT * FROM public.internal_procurement_intelligence_run($1,$2,$3,$4,$5)',
        [actor, sourceSnapshot, 'pi-no-authority', null, id()],
      )).rejects.toThrow('PROCUREMENT_INTELLIGENCE_FORBIDDEN');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('binds the fixed PUR-17 and CPF-33 authority and rejects replacement or replay', async () => {
    const client = await internal.connect();
    try {
      await client.query('BEGIN');
      const decision = await authorize(client, actor, sourceSnapshot);
      const values = await owner.query(
        `SELECT purpose_code,flow_cpf_id,operation,consumed_at IS NOT NULL AS consumed
         FROM procurement_intelligence_purpose_decisions WHERE id=$1`,
        [decision],
      );
      expect(values.rows).toEqual([{
        purpose_code: 'PUR-17',
        flow_cpf_id: 'CPF_33',
        operation: 'PI_SNAPSHOT_MATERIALIZE',
        consumed: true,
      }]);
      await expect(purposeAuthority.query(
        `UPDATE procurement_intelligence_purpose_decisions SET flow_cpf_id='CPF_26' WHERE id=$1`,
        [decision],
      )).rejects.toThrow(/permission denied/i);
      await client.query(
        'SELECT * FROM public.internal_procurement_intelligence_run($1,$2,$3,$4,$5)',
        [actor, sourceSnapshot, 'pi-replay-first', null, decision],
      );
      await expect(client.query(
        'SELECT * FROM public.internal_procurement_intelligence_run($1,$2,$3,$4,$5)',
        [actor, sourceSnapshot, 'pi-replay-second', null, decision],
      )).rejects.toThrow('PROCUREMENT_INTELLIGENCE_FORBIDDEN');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('is idempotent for the same source and request and conflicts across source snapshots', async () => {
    const first = await materialize(sourceSnapshot, 'pi-idempotent');
    const retry = await materialize(sourceSnapshot, 'pi-idempotent');
    expect(retry).toEqual(first);
    await expect(materialize(alternateSourceSnapshot, 'pi-idempotent')).rejects.toThrow('PROCUREMENT_INTELLIGENCE_IDEMPOTENCY_CONFLICT');
  });

  it('serializes concurrent identical requests into one logical result', async () => {
    const [left, right] = await Promise.all([
      materialize(sourceSnapshot, 'pi-concurrent-identical'),
      materialize(sourceSnapshot, 'pi-concurrent-identical'),
    ]);
    expect(left).toEqual(right);
    const count = await owner.query(
      `SELECT count(*)::integer AS value FROM procurement_intelligence_runs WHERE request_key='pi-concurrent-identical'`,
    );
    expect(count.rows[0]?.value).toBe(1);
  });

  it('keeps summary and lineage capabilities separate and excludes protected source identities from summary', async () => {
    const result = await materialize(alternateSourceSnapshot, 'pi-read-separation');
    const summary = await internal.query(
      'SELECT * FROM public.internal_procurement_intelligence_summary_view($1,$2)',
      [summaryReader, result.snapshot_id],
    );
    expect(summary.rows).toHaveLength(1);
    expect(Object.keys(summary.rows[0] ?? {})).not.toEqual(expect.arrayContaining([
      'source_buying_power_snapshot_id',
      'source_buying_power_snapshot_membership_id',
      'source_company_id',
      'request_key',
      'correlation_id',
    ]));
    const deniedLineage = await internal.query(
      'SELECT * FROM public.internal_procurement_intelligence_lineage_view($1,$2)',
      [summaryReader, result.snapshot_id],
    );
    expect(deniedLineage.rows).toEqual([]);
    const lineage = await internal.query(
      'SELECT * FROM public.internal_procurement_intelligence_lineage_view($1,$2)',
      [lineageReader, result.snapshot_id],
    );
    expect(lineage.rows).toHaveLength(1);
    expect(Object.keys(lineage.rows[0] ?? {})).not.toEqual(expect.arrayContaining([
      'source_company_id',
      'source_reference',
      'supplier_id',
      'purchase_source_id',
      'document_id',
    ]));
  });

  it('enforces direct-table, role, function, and immutable-history boundaries', async () => {
    await expect(runtime.query('SELECT * FROM procurement_intelligence_runs')).rejects.toThrow(/permission denied/i);
    await expect(internal.query('SELECT * FROM procurement_intelligence_runs')).rejects.toThrow(/permission denied/i);
    await expect(internal.query('SET ROLE sco_procurement_intelligence_gateway_owner')).rejects.toThrow(/permission denied/i);
    const grants = await owner.query(
      `SELECT has_function_privilege('public', 'public.internal_procurement_intelligence_run(uuid,uuid,text,uuid,uuid)', 'EXECUTE') AS public_execute,
              has_function_privilege('sco_runtime', 'public.internal_procurement_intelligence_run(uuid,uuid,text,uuid,uuid)', 'EXECUTE') AS runtime_execute`,
    );
    expect(grants.rows).toEqual([{ public_execute: false, runtime_execute: false }]);
    const immutable = await owner.query<{ id: string }>(
      `SELECT id FROM procurement_intelligence_snapshots LIMIT 1`,
    );
    await expect(owner.query(
      `UPDATE procurement_intelligence_snapshots SET source_fingerprint='tampered' WHERE id=$1`,
      [immutable.rows[0]?.id],
    )).rejects.toThrow('PROCUREMENT_INTELLIGENCE_HISTORY_IMMUTABLE');
  });

  it('hardens the gateway owner, catalog policy, and SECURITY DEFINER boundaries', async () => {
    const ownerAttributes = await owner.query(
      `SELECT rolcanlogin,rolinherit,rolbypassrls,rolsuper,rolcreatedb,rolcreaterole
       FROM pg_roles WHERE rolname='sco_procurement_intelligence_gateway_owner'`,
    );
    expect(ownerAttributes.rows).toEqual([{
      rolcanlogin: false,
      rolinherit: false,
      rolbypassrls: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
    }]);
    const tableSecurity = await owner.query(
      `SELECT relname,relrowsecurity,relforcerowsecurity
       FROM pg_class
       WHERE relname IN (
         'procurement_intelligence_purpose_decisions',
         'procurement_intelligence_runs',
         'procurement_intelligence_snapshots',
         'procurement_intelligence_snapshot_lines',
         'procurement_intelligence_snapshot_source_memberships'
       )
       ORDER BY relname`,
    );
    expect(tableSecurity.rows).toHaveLength(5);
    expect(tableSecurity.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const functionSecurity = await owner.query(
      `SELECT p.prosecdef, p.proconfig, has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
       FROM pg_proc p
       WHERE p.proname='internal_procurement_intelligence_run'`,
    );
    expect(functionSecurity.rows).toEqual([{
      prosecdef: true,
      proconfig: ['search_path=pg_catalog, public'],
      public_execute: false,
    }]);
    const gatewayOwner = new Client({ connectionString: process.env.DATABASE_URL });
    await gatewayOwner.connect();
    try {
      await gatewayOwner.query('SET ROLE sco_procurement_intelligence_gateway_owner');
      await expect(gatewayOwner.query('SELECT * FROM "Role"')).rejects.toThrow(/permission denied/i);
    } finally {
      await gatewayOwner.end();
    }
  });
});
