import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const uid = () => randomUUID();
let internal: InternalDatabaseService;
let sco: string, partnerA: string, partnerB: string, supplier: string;
let summaryActor: string, lineageActor: string, noPowerActor: string, partnerActor: string, supplierActor: string;
let product: string, unit: string, needA: string, lineA: string, snapshot: string;
let bucket: string;

async function principal(companyId: string, permissions: string[], prefix: string) {
  const user = uid(), membership = uid(), role = uid();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [user, `${prefix}-${user}@views.test`]);
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membership, user, companyId]);
  await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3)`, [role, companyId, `${prefix}-${role}`]);
  await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [uid(), companyId, membership, role]);
  for (const permission of permissions) await owner.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`, [uid(), companyId, role, permission]);
  return user;
}

async function createCommitment(companyId: string, actor: string) {
  const offer = uid(), revision = uid(), po = uid(), commitment = uid(), line = uid();
  await owner.query(`INSERT INTO partner_offers(id,company_id,offer_reference,created_by) VALUES($1,$2,$3,$4)`, [offer, companyId, `VIEW-${offer}`, actor]);
  await owner.query(`INSERT INTO partner_offer_revisions(id,partner_offer_id,revision_number,status,currency_code,offer_total_excl_tax,offer_tax_amount,offer_total_incl_tax,created_by) VALUES($1,$2,1,'ACCEPTED','SAR',100,0,100,$3)`, [revision, offer, actor]);
  await owner.query(`INSERT INTO partner_purchase_orders(id,partner_company_id,accepted_offer_id,accepted_offer_revision_id,po_reference,po_date,submitted_by,currency_code,total_excl_tax,total_incl_tax,status) VALUES($1,$2,$3,$4,$5,current_date,$6,'SAR',100,100,'VERIFIED')`, [po, companyId, offer, revision, `VIEW-${po}`, actor]);
  await owner.query(`INSERT INTO commercial_commitments(id,partner_company_id,partner_purchase_order_id,accepted_offer_id,accepted_offer_revision_id,commitment_revision_number,currency_code,total_excl_tax,total_incl_tax,committed_by) VALUES($1,$2,$3,$4,$5,1,'SAR',100,100,$6)`, [commitment, companyId, po, offer, revision, actor]);
  await owner.query(`INSERT INTO commercial_commitment_lines(id,commercial_commitment_id,line_number,product_identity_id,product_description,quantity,unit_id,unit_selling_price,amount_excl_tax,amount_incl_tax) VALUES($1,$2,1,$3,'View product',100,$4,1,100,100)`, [line, commitment, product, unit]);
  return line;
}

describe('Batch 10-C Buying Power views and Partner-safe boundary', () => {
  beforeAll(async () => {
    internal = new InternalDatabaseService();
    sco = uid(); partnerA = uid(); partnerB = uid(); supplier = uid();
    await owner.query(`INSERT INTO "Company"(id,name,type) VALUES($1,'Views SCO','SCO'),($2,'Views A','PARTNER'),($3,'Views B','PARTNER'),($4,'Views Supplier','SUPPLIER')` , [sco, partnerA, partnerB, supplier]);
    summaryActor = await principal(sco, ['buying_power.aggregate','buying_power.rebuild','buying_power.read_summary'], 'summary');
    lineageActor = await principal(sco, ['buying_power.read_lineage'], 'lineage');
    noPowerActor = await principal(sco, [], 'job-title-only');
    partnerActor = await principal(partnerA, ['buying_power.partner_own_read'], 'partner');
    supplierActor = await principal(supplier, ['buying_power.partner_own_read'], 'supplier');
    const creator = uid(), category = uid(); unit = uid(); product = uid();
    bucket = (await owner.query(`SELECT date_trunc('week',current_date)::date AS bucket`)).rows[0].bucket;
    await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [creator, `${creator}@views.test`]);
    await owner.query(`INSERT INTO product_categories(id,code,name) VALUES($1,$2,'Views')`, [category, `views-${category}`]);
    await owner.query(`INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,'Each','count')`, [unit, `views-${unit}`]);
    await owner.query(`INSERT INTO product_identities(id,category_id,unit_id,created_by,status,brand,manufacturer,model_reference) VALUES($1,$2,$3,$4,'ACTIVE','VBrand','VManufacturer','V-100')`, [product, category, unit, creator]);
    const project = uid(); needA = uid();
    await owner.query(`INSERT INTO projects(id,company_id,code,name,status,created_by) VALUES($1,$2,$3,'Views Project','ACTIVE',$4)`, [project, partnerA, `V-${project}`, creator]);
    await owner.query(`INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,ready_quantity,unit_id,need_date,maturity,review_status) VALUES($1,$2,$3,$4,'MANUAL',$5,'Own need',100,80,$6,current_date,'READY','APPROVED')`, [needA, partnerA, project, creator, product, unit]);
    lineA = await createCommitment(partnerA, creator);
    await owner.query(`INSERT INTO company_partnerships(company_id,type,status) VALUES($1,'BUYER_PARTNERSHIP','ACTIVE'),($1,'SUPPLIER_PARTNERSHIP','ACTIVE')`, [partnerA]);
    await internal.createBuyingPowerConversion(summaryActor, lineA, 'NEED', needA, 100, uid());
    const run = await internal.runBuyingPowerClassification(summaryActor, 'ROLLING_PLANNED', bucket, `views-${uid()}`, [needA], [lineA], uid());
    snapshot = run.snapshotId;
  });
  afterAll(async () => { await internal?.onModuleDestroy(); await owner.end(); });

  it('returns a safe internal summary with metrics and reproducibility metadata', async () => {
    const rows = await internal.getBuyingPowerInternalSummary(summaryActor, snapshot);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ snapshot_id: snapshot, product_identity_id: product, unit_id: unit, horizon: 'ROLLING_PLANNED', time_bucket: bucket, committed_quantity: '100.0000' });
    expect(rows[0].product_description).toContain('VManufacturer');
    expect(Object.keys(rows[0])).not.toEqual(expect.arrayContaining(['source_company_id','source_record_id','snapshot_membership_id','project_id','need_id','partner_company_id']));
    expect(rows[0].cutoff_at).toBeTruthy(); expect(rows[0].published_at).toBeTruthy(); expect(rows[0].snapshot_status).toBe('PUBLISHED');
  });

  it('keeps summary separate from lineage and denies job-title-only access', async () => {
    expect(await internal.getBuyingPowerInternalLineage(summaryActor, snapshot)).toEqual([]);
    expect(await internal.getBuyingPowerInternalSummary(noPowerActor, snapshot)).toEqual([]);
    expect(await internal.getBuyingPowerInternalLineage(noPowerActor, snapshot)).toEqual([]);
  });

  it('allows only explicit lineage capability to trace protected memberships', async () => {
    const rows = await internal.getBuyingPowerInternalLineage(lineageActor, snapshot);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ snapshot_id: snapshot, product_identity_id: product, unit_id: unit, source_company_id: partnerA, horizon: 'ROLLING_PLANNED', time_bucket: bucket });
    expect(rows[0]).not.toHaveProperty('purchase_source_id');
    expect(rows[0]).not.toHaveProperty('supplier_company_id');
  });

  it('keeps internal tables and gateways unavailable to Partner and Supplier runtime', async () => {
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); await runtime.connect();
    try {
      await runtime.query(`SELECT set_config('app.tenant_id',$1,false)`, [partnerA]);
      await expect(runtime.query('SELECT * FROM buying_power_snapshots')).rejects.toThrow(/permission denied/i);
      await expect(runtime.query('SELECT * FROM public.internal_buying_power_summary_view($1,$2)', [partnerActor, snapshot])).rejects.toThrow(/permission denied/i);
      await expect(runtime.query('SELECT * FROM public.internal_buying_power_lineage_view($1,$2)', [partnerActor, snapshot])).rejects.toThrow(/permission denied/i);
    } finally { await runtime.end(); }
  });

  it('returns only Partner A own facts and resists tenant/company/snapshot spoofing', async () => {
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); await runtime.connect();
    try {
      await runtime.query(`SELECT set_config('app.tenant_id',$1,false)`, [partnerA]);
      const own = (await runtime.query('SELECT * FROM public.partner_buying_power_own_context($1,$2,$3,$4)', [partnerActor, partnerA, 'WEEKLY_IMMEDIATE', bucket])).rows;
      expect(own).toHaveLength(1); expect(own[0]).toMatchObject({ product_identity_id: product, committed_quantity: '100.0000', qualified_quantity: '100', released_quantity: '0', procured_quantity: '0' });
      expect((await runtime.query('SELECT * FROM public.partner_buying_power_own_context($1,$2,$3,$4)', [partnerActor, partnerB, 'WEEKLY_IMMEDIATE', bucket])).rows).toEqual([]);
      expect((await runtime.query('SELECT * FROM public.partner_buying_power_own_context($1,$2,$3,$4)', [partnerActor, partnerA, 'WEEKLY_IMMEDIATE', '2099-01-12'])).rows).toEqual([]);
      await runtime.query(`SELECT set_config('app.sco_internal','true',false),set_config('app.actor_id',$1,false)`, [summaryActor]);
      expect((await runtime.query('SELECT * FROM public.partner_buying_power_own_context($1,$2,$3,$4)', [summaryActor, partnerA, 'WEEKLY_IMMEDIATE', bucket])).rows).toEqual([]);
    } finally { await runtime.end(); }
  });

  it('is privacy-invariant when another Partner contributes the same product and horizon', async () => {
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); await runtime.connect();
    try {
      await runtime.query(`SELECT set_config('app.tenant_id',$1,false)`, [partnerA]);
      const before = (await runtime.query('SELECT * FROM public.partner_buying_power_own_context($1,$2,$3,$4)', [partnerActor, partnerA, 'WEEKLY_IMMEDIATE', bucket])).rows;
      const creator = uid(), project = uid(), need = uid();
      await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [creator, `${creator}@views.test`]);
      await owner.query(`INSERT INTO projects(id,company_id,code,name,status,created_by) VALUES($1,$2,$3,'B project','ACTIVE',$4)`, [project, partnerB, `VB-${project}`, creator]);
      await owner.query(`INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,ready_quantity,unit_id,need_date,maturity,review_status) VALUES($1,$2,$3,$4,'MANUAL',$5,'B need',50,50,$6,current_date,'READY','APPROVED')`, [need, partnerB, project, creator, product, unit]);
      const after = (await runtime.query('SELECT * FROM public.partner_buying_power_own_context($1,$2,$3,$4)', [partnerActor, partnerA, 'WEEKLY_IMMEDIATE', bucket])).rows;
      expect(after).toEqual(before);
    } finally { await runtime.end(); }
  });

  it('does not grant Supplier or dual-role Partner access to internal summary or lineage', async () => {
    expect(await internal.getBuyingPowerInternalSummary(partnerActor, snapshot)).toEqual([]);
    expect(await internal.getBuyingPowerInternalLineage(partnerActor, snapshot)).toEqual([]);
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); await runtime.connect();
    try {
      await runtime.query(`SELECT set_config('app.tenant_id',$1,false)`, [supplier]);
      expect((await runtime.query('SELECT * FROM public.partner_buying_power_own_context($1,$2)', [supplierActor, supplier])).rows).toEqual([]);
      await expect(runtime.query('SELECT * FROM buying_power_snapshot_lines')).rejects.toThrow(/permission denied/i);
    } finally { await runtime.end(); }
  });

  it('returns safe empty results for unknown snapshots and foreign companies without topology errors', async () => {
    expect(await internal.getBuyingPowerInternalSummary(summaryActor, uid())).toEqual([]);
    expect(await internal.getBuyingPowerInternalLineage(lineageActor, uid())).toEqual([]);
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); await runtime.connect();
    try {
      await runtime.query(`SELECT set_config('app.tenant_id',$1,false)`, [partnerA]);
      expect((await runtime.query('SELECT * FROM public.partner_buying_power_own_context($1,$2)', [partnerActor, partnerB])).rows).toEqual([]);
      expect((await runtime.query('SELECT * FROM public.partner_buying_power_own_context($1,$2)', [partnerActor, uid()])).rows).toEqual([]);
    } finally { await runtime.end(); }
  });

  it('keeps all source facts and published snapshot rows unchanged across read paths', async () => {
    const tables = ['procurement_needs','procurement_execution_items','commercial_commitments','procurement_releases','supplier_purchase_orders','supplier_po_coverage_bindings','buying_power_aggregation_runs','buying_power_snapshots','buying_power_snapshot_lines','buying_power_snapshot_source_memberships'];
    const before: Record<string, number> = {};
    for (const table of tables) before[table] = (await owner.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count;
    await internal.getBuyingPowerInternalSummary(summaryActor, snapshot);
    await internal.getBuyingPowerInternalLineage(lineageActor, snapshot);
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); await runtime.connect();
    try { await runtime.query(`SELECT set_config('app.tenant_id',$1,false)`, [partnerA]); await runtime.query('SELECT * FROM public.partner_buying_power_own_context($1,$2)', [partnerActor, partnerA]); } finally { await runtime.end(); }
    for (const table of tables) expect((await owner.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count).toBe(before[table]);
  });

  it('preserves RLS, fixed search paths, read-only behavior, and 10-B values', async () => {
    const before = (await owner.query(`SELECT product_identity_id,unit_id,committed_quantity,potential_quantity,qualified_quantity,open_quantity,released_quantity,procured_quantity FROM buying_power_snapshot_lines WHERE snapshot_id=$1`, [snapshot])).rows;
    const classifiedBefore = await internal.getBuyingPowerClassifiedSummary(summaryActor, snapshot);
    const rls = (await owner.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN('buying_power_aggregation_runs','buying_power_snapshots','buying_power_snapshot_lines','buying_power_snapshot_source_memberships')`)).rows;
    expect(rls).toHaveLength(4); expect(rls.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const acl = (await owner.query(`SELECT has_function_privilege('public','public.partner_buying_power_own_context(uuid,uuid,text,date)','EXECUTE') AS public_execute,has_function_privilege('sco_runtime','public.partner_buying_power_own_context(uuid,uuid,text,date)','EXECUTE') AS runtime_execute,has_function_privilege('sco_internal_executor','public.internal_buying_power_summary_view(uuid,uuid)','EXECUTE') AS summary_execute`)).rows[0];
    expect(acl).toEqual({ public_execute: false, runtime_execute: true, summary_execute: true });
    const configs = (await owner.query(`SELECT proname,proconfig FROM pg_proc WHERE proname IN('internal_buying_power_summary_view','internal_buying_power_lineage_view','partner_buying_power_own_context') ORDER BY proname`)).rows;
    expect(configs.every((row) => row.proconfig.some((v: string) => v.includes('search_path=pg_catalog, public')))).toBe(true);
    expect((await owner.query(`SELECT product_identity_id,unit_id,committed_quantity,potential_quantity,qualified_quantity,open_quantity,released_quantity,procured_quantity FROM buying_power_snapshot_lines WHERE snapshot_id=$1`, [snapshot])).rows).toEqual(before);
    expect(await internal.getBuyingPowerClassifiedSummary(summaryActor, snapshot)).toEqual(classifiedBefore);
  });
});
