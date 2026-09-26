import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

const database = new Pool({ connectionString: process.env.DATABASE_URL });
const uuid = () => randomUUID();
let service: InternalDatabaseService;
let actor: string;
let deniedActor: string;
let supplierCompany: string;
let supplierPartnership: string;
let purchaseSource: string;
let productIdentity: string;
let unit: string;

async function principal(permissions: string[]) {
  let sco = (await database.query(`SELECT id FROM "Company" WHERE type='SCO' AND status='ACTIVE' LIMIT 1`)).rows[0]?.id;
  if (!sco) {
    sco = uuid();
    await database.query(`INSERT INTO "Company"(id,name,type) VALUES($1,$2,'SCO')`, [sco, `SFD commercial internal ${sco}`]);
  }
  const user = uuid(); const membership = uuid(); const role = uuid();
  await database.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [user, `${user}@sfd-commercial.test`]);
  await database.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membership, user, sco]);
  await database.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3)`, [role, sco, `sfd-commercial-${uuid()}`]);
  await database.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [uuid(), sco, membership, role]);
  for (const permission of permissions) await database.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`, [uuid(), sco, role, permission]);
  return user;
}

async function activeSupplierSource(createdBy: string) {
  const existing = (await database.query(`SELECT ps.supplier_company_id,ps.supplier_partnership_id,ps.id FROM purchase_sources ps JOIN company_partnerships cp ON cp.id=ps.supplier_partnership_id WHERE ps.status='ACTIVE' AND cp.status='ACTIVE' AND cp.type='SUPPLIER_PARTNERSHIP' LIMIT 1`)).rows[0];
  if (existing) return existing;
  const companyId = uuid(); const partnershipId = uuid(); const sourceId = uuid();
  await database.query(`INSERT INTO "Company"(id,name,type) VALUES($1,$2,'SUPPLIER')`, [companyId, `SFD commercial supplier ${companyId}`]);
  await database.query(`INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,'SUPPLIER_PARTNERSHIP','ACTIVE')`, [partnershipId, companyId]);
  const sourceTypeId = (await database.query(`SELECT id FROM purchase_source_type_definitions WHERE active ORDER BY sort_order,id LIMIT 1`)).rows[0].id;
  await database.query(`INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,status,created_by) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6)`, [sourceId, companyId, partnershipId, `sfd-commercial-${sourceId}`, sourceTypeId, createdBy]);
  return { supplier_company_id: companyId, supplier_partnership_id: partnershipId, id: sourceId };
}

async function activeProductScope(createdBy: string) {
  const existing = (await database.query(`SELECT pi.id product_identity_id,pi.unit_id FROM product_identities pi JOIN unit_definitions u ON u.id=pi.unit_id WHERE pi.status='ACTIVE' AND u.active LIMIT 1`)).rows[0];
  if (existing) return existing;
  const categoryId = uuid(); const unitId = uuid(); const productId = uuid();
  await database.query(`INSERT INTO product_categories(id,code,name) VALUES($1,$2,$3)`, [categoryId, `sfd-commercial-${categoryId}`, `SFD commercial category ${categoryId}`]);
  await database.query(`INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,$3,'count')`, [unitId, `sfd-commercial-${unitId}`, `SFD commercial unit ${unitId}`]);
  await database.query(`INSERT INTO product_identities(id,category_id,unit_id,created_by,status) VALUES($1,$2,$3,$4,'ACTIVE')`, [productId, categoryId, unitId, createdBy]);
  return { product_identity_id: productId, unit_id: unitId };
}

function frameworkInput(overrides: Record<string, unknown> = {}) {
  return {
    reference: `SFD-COMMERCIAL-${uuid()}`,
    supplierCompanyId: supplierCompany,
    supplierPartnershipId: supplierPartnership,
    purchaseSourceId: purchaseSource,
    effectiveFrom: '2032-01-01',
    effectiveUntil: '2032-12-31',
    scopeLines: [{ productIdentityId: productIdentity, unitId: unit }],
    idempotencyKey: uuid(),
    ...overrides,
  };
}

async function draftFramework() {
  return service.createSupplierFutureDemandFramework(actor, frameworkInput());
}

async function publishedBuyingPowerLine() {
  const runId = uuid(); const snapshotId = uuid(); const lineId = uuid();
  await database.query(
    `INSERT INTO buying_power_aggregation_runs(id,initiated_by,horizon,time_bucket,request_key,source_fingerprint,status,completed_at)
     VALUES($1,$2,'ROLLING_PLANNED','2032-01-01',$3,$4,'PUBLISHED',now())`,
    [runId, actor, uuid(), uuid()],
  );
  await database.query(
    `INSERT INTO buying_power_snapshots(id,aggregation_run_id,horizon,time_bucket,cutoff_at,source_fingerprint,published_by)
     VALUES($1,$2,'ROLLING_PLANNED','2032-01-01',now(),$3,$4)`,
    [snapshotId, runId, uuid(), actor],
  );
  await database.query(
    `INSERT INTO buying_power_snapshot_lines(id,snapshot_id,product_identity_id,unit_id,qualified_quantity,committed_quantity,potential_quantity)
     VALUES($1,$2,$3,$4,10,20,30)`,
    [lineId, snapshotId, productIdentity, unit],
  );
  return { snapshotId, lineId };
}

describe('Batch 12-B Supplier Future-Demand Framework commercial terms', () => {
  beforeAll(async () => {
    service = new InternalDatabaseService();
    actor = await principal([
      'supplier_future_demand_framework.create', 'supplier_future_demand_framework.approve',
      'supplier_future_demand_framework.offer', 'supplier_future_demand_framework.accept',
      'supplier_future_demand_framework.commercial.write', 'supplier_future_demand_framework.commercial.read_confidential',
    ]);
    deniedActor = await principal([]);
    const source = await activeSupplierSource(actor);
    supplierCompany = source.supplier_company_id; supplierPartnership = source.supplier_partnership_id; purchaseSource = source.id;
    const scope = await activeProductScope(actor);
    productIdentity = scope.product_identity_id; unit = scope.unit_id;
  });

  afterAll(async () => { await service.onModuleDestroy(); await database.end(); });

  it('creates separate immutable fixed purchase terms with explicit currency and tax treatment', async () => {
    const framework = await draftFramework();
    const input = {
      productIdentityId: productIdentity, unitId: unit, pricingKind: 'FIXED' as const,
      fixedUnitPurchasePrice: 12.5, currencyCode: 'SAR', taxTreatment: 'VAT_EXCLUSIVE', taxReference: 'KSA_STANDARD_RATE', idempotencyKey: uuid(),
    };
    const termId = await service.createSupplierFutureDemandFrameworkCommercialTerm(actor, framework.revision_id, input);
    expect(await service.createSupplierFutureDemandFrameworkCommercialTerm(actor, framework.revision_id, input)).toBe(termId);
    await expect(service.createSupplierFutureDemandFrameworkCommercialTerm(actor, framework.revision_id, { ...input, fixedUnitPurchasePrice: 13 })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_IDEMPOTENCY_CONFLICT');
    expect(await service.getSupplierFutureDemandFrameworkCommercialTerms(actor, framework.revision_id)).toEqual([expect.objectContaining({ commercial_term_id: termId, pricing_kind: 'FIXED', fixed_unit_purchase_price: '12.500000', currency_code: 'SAR', tax_treatment: 'VAT_EXCLUSIVE', tax_reference: 'KSA_STANDARD_RATE', tiers: [] })]);
    await expect(service.createSupplierFutureDemandFrameworkCommercialTerm(deniedActor, framework.revision_id, { ...input, idempotencyKey: uuid() })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_FORBIDDEN');
    await expect(service.createSupplierFutureDemandFrameworkCommercialTerm(actor, framework.revision_id, { ...input, idempotencyKey: uuid(), fixedUnitPurchasePrice: 0 })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_INVALID');
    await expect(service.createSupplierFutureDemandFrameworkCommercialTerm(actor, framework.revision_id, { ...input, idempotencyKey: uuid(), fixedUnitPurchasePrice: -1 })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_INVALID');
    await expect(service.createSupplierFutureDemandFrameworkCommercialTerm(actor, framework.revision_id, { ...input, idempotencyKey: uuid(), currencyCode: 'SA' })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_INVALID');
    await expect(database.query(`UPDATE supplier_future_demand_framework_commercial_terms SET currency_code='USD' WHERE id=$1`, [termId])).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_HISTORY_IMMUTABLE');
    await service.approveSupplierFutureDemandFramework(actor, framework.revision_id, uuid());
    await expect(service.createSupplierFutureDemandFrameworkCommercialTerm(actor, framework.revision_id, { ...input, idempotencyKey: uuid() })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_INVALID');
  });

  it('accepts deterministic tiered pricing and rejects invalid, overlapping, and concurrent tier states', async () => {
    const invalidFramework = await draftFramework();
    const base = { productIdentityId: productIdentity, unitId: unit, pricingKind: 'TIERED' as const, currencyCode: 'SAR', taxTreatment: 'VAT_EXCLUSIVE' };
    await expect(service.createSupplierFutureDemandFrameworkCommercialTerm(actor, invalidFramework.revision_id, { ...base, idempotencyKey: uuid(), tiers: [{ lowerQuantity: 1, upperQuantity: 10, unitPurchasePrice: 10 }, { lowerQuantity: 10, upperQuantity: 20, unitPurchasePrice: 9 }] })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_TIER_INVALID');
    await expect(service.createSupplierFutureDemandFrameworkCommercialTerm(actor, invalidFramework.revision_id, { ...base, idempotencyKey: uuid(), tiers: [{ lowerQuantity: 10, upperQuantity: 1, unitPurchasePrice: 10 }] })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_TIER_INVALID');
    await expect(service.createSupplierFutureDemandFrameworkCommercialTerm(actor, invalidFramework.revision_id, { ...base, idempotencyKey: uuid(), tiers: [{ lowerQuantity: 0, upperQuantity: 10, unitPurchasePrice: 10 }] })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_TIER_INVALID');
    const framework = await draftFramework();
    const termId = await service.createSupplierFutureDemandFrameworkCommercialTerm(actor, framework.revision_id, { ...base, idempotencyKey: uuid(), tiers: [{ lowerQuantity: 1, upperQuantity: 9, unitPurchasePrice: 10 }, { lowerQuantity: 10, unitPurchasePrice: 9 }] });
    const rows: any[] = await service.getSupplierFutureDemandFrameworkCommercialTerms(actor, framework.revision_id);
    expect(rows[0]).toMatchObject({ commercial_term_id: termId, pricing_kind: 'TIERED', fixed_unit_purchase_price: null, tiers: [{ lowerQuantity: 1, upperQuantity: 9, unitPurchasePrice: 10 }, { lowerQuantity: 10, upperQuantity: null, unitPurchasePrice: 9 }] });
    const raceFramework = await draftFramework();
    const firstService = new InternalDatabaseService(); const secondService = new InternalDatabaseService();
    try {
      const results = await Promise.allSettled([
        firstService.createSupplierFutureDemandFrameworkCommercialTerm(actor, raceFramework.revision_id, { ...base, idempotencyKey: uuid(), tiers: [{ lowerQuantity: 1, unitPurchasePrice: 10 }] }),
        secondService.createSupplierFutureDemandFrameworkCommercialTerm(actor, raceFramework.revision_id, { ...base, idempotencyKey: uuid(), tiers: [{ lowerQuantity: 1, unitPurchasePrice: 9 }] }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect((await database.query(`SELECT count(*)::int count FROM supplier_future_demand_framework_commercial_terms WHERE revision_id=$1`, [raceFramework.revision_id])).rows[0].count).toBe(1);
    } finally { await firstService.onModuleDestroy(); await secondService.onModuleDestroy(); }
  });

  it('records non-reserving indicative capacity with deterministic overlap protection', async () => {
    const framework = await draftFramework();
    const before = await database.query(`SELECT (SELECT count(*)::int FROM procurement_needs) needs,(SELECT count(*)::int FROM commercial_commitments) commitments,(SELECT count(*)::int FROM procurement_releases) releases,(SELECT count(*)::int FROM supplier_purchase_orders) purchase_orders`);
    const input = { productIdentityId: productIdentity, unitId: unit, periodStart: '2032-02-01', periodEnd: '2032-02-28', indicativeQuantity: 100, idempotencyKey: uuid() };
    const periodId = await service.createSupplierFutureDemandFrameworkCapacityPeriod(actor, framework.revision_id, input);
    expect(await service.createSupplierFutureDemandFrameworkCapacityPeriod(actor, framework.revision_id, input)).toBe(periodId);
    await expect(service.createSupplierFutureDemandFrameworkCapacityPeriod(actor, framework.revision_id, { ...input, idempotencyKey: uuid(), periodStart: '2032-02-15', periodEnd: '2032-03-01' })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_CAPACITY_OVERLAP');
    await expect(service.createSupplierFutureDemandFrameworkCapacityPeriod(actor, framework.revision_id, { ...input, idempotencyKey: uuid(), periodStart: '2032-03-02', periodEnd: '2032-03-01' })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_CAPACITY_INVALID');
    await expect(service.createSupplierFutureDemandFrameworkCapacityPeriod(actor, framework.revision_id, { ...input, idempotencyKey: uuid(), indicativeQuantity: 0 })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_CAPACITY_INVALID');
    expect(await service.getSupplierFutureDemandFrameworkCapacityPeriods(actor, framework.revision_id)).toEqual([expect.objectContaining({ id: periodId, indicative_quantity: '100.0000' })]);
    const after = await database.query(`SELECT (SELECT count(*)::int FROM procurement_needs) needs,(SELECT count(*)::int FROM commercial_commitments) commitments,(SELECT count(*)::int FROM procurement_releases) releases,(SELECT count(*)::int FROM supplier_purchase_orders) purchase_orders`);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('attaches only published QUALIFIED or COMMITTED provenance without lineage disclosure', async () => {
    const framework = await draftFramework();
    const buyingPower = await publishedBuyingPowerLine();
    const qualifiedId = await service.attachSupplierFutureDemandFrameworkBuyingPowerProvenance(actor, framework.revision_id, { snapshotId: buyingPower.snapshotId, snapshotLineId: buyingPower.lineId, signalClass: 'QUALIFIED', idempotencyKey: uuid() });
    const committedId = await service.attachSupplierFutureDemandFrameworkBuyingPowerProvenance(actor, framework.revision_id, { snapshotId: buyingPower.snapshotId, snapshotLineId: buyingPower.lineId, signalClass: 'COMMITTED', idempotencyKey: uuid() });
    const provenance: any[] = await service.getSupplierFutureDemandFrameworkBuyingPowerProvenance(actor, framework.revision_id);
    expect(provenance).toEqual(expect.arrayContaining([expect.objectContaining({ id: qualifiedId, signal_class: 'QUALIFIED' }), expect.objectContaining({ id: committedId, signal_class: 'COMMITTED' })]));
    expect(Object.keys(provenance[0])).not.toEqual(expect.arrayContaining(['source_company_id', 'source_record_id', 'contribution_quantity', 'source_reference']));
    await expect(service.attachSupplierFutureDemandFrameworkBuyingPowerProvenance(actor, framework.revision_id, { snapshotId: buyingPower.snapshotId, snapshotLineId: buyingPower.lineId, signalClass: 'POTENTIAL' as never, idempotencyKey: uuid() })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_PROVENANCE_INVALID');
    await expect(service.getSupplierFutureDemandFrameworkBuyingPowerProvenance(deniedActor, framework.revision_id)).resolves.toEqual([]);
  });

  it('enforces protected-table RLS, FORCE RLS, ACLs, safe runtime denial, and mutation audit', async () => {
    const tableNames = ['supplier_future_demand_framework_commercial_terms', 'supplier_future_demand_framework_price_tiers', 'supplier_future_demand_framework_capacity_periods', 'supplier_future_demand_framework_buying_power_provenance'];
    const tables = await database.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relkind='r' AND relname=ANY($1)`, [tableNames]);
    expect(tables.rows).toHaveLength(4); expect(tables.rows.every((row: any) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const acl = await database.query(`SELECT has_table_privilege('sco_runtime','public.supplier_future_demand_framework_commercial_terms','SELECT') runtime_select,has_function_privilege('public','public.internal_supplier_future_demand_framework_commercial_term_create(uuid,uuid,uuid,uuid,text,numeric,text,text,text,jsonb,text,text)','EXECUTE') public_execute,has_function_privilege('sco_runtime','public.internal_supplier_future_demand_framework_commercial_term_create(uuid,uuid,uuid,uuid,text,numeric,text,text,text,jsonb,text,text)','EXECUTE') runtime_execute,proconfig FROM pg_proc WHERE oid='public.internal_supplier_future_demand_framework_commercial_term_create(uuid,uuid,uuid,uuid,text,numeric,text,text,text,jsonb,text,text)'::regprocedure`);
    expect(acl.rows[0]).toMatchObject({ runtime_select: false, public_execute: false, runtime_execute: false }); expect(acl.rows[0].proconfig).toContain('search_path=pg_catalog, public');
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); await runtime.connect();
    try {
      await runtime.query(`SELECT set_config('app.sco_internal','true',false)`);
      await expect(runtime.query(`SELECT * FROM supplier_future_demand_framework_commercial_terms`)).rejects.toThrow(/permission denied/i);
      await expect(runtime.query(`SELECT public.internal_supplier_future_demand_framework_commercial_term_create(NULL,NULL,NULL,NULL,'FIXED',1,'SAR','VAT_EXCLUSIVE',NULL,NULL,'spoof',NULL)`)).rejects.toThrow(/permission denied/i);
    } finally { await runtime.end(); }
    const framework = await draftFramework();
    const auditBefore = await database.query(`SELECT count(*)::int count FROM audit_logs WHERE action='supplier_future_demand_framework.commercial_term_created'`);
    await expect(service.createSupplierFutureDemandFrameworkCommercialTerm(actor, framework.revision_id, { productIdentityId: productIdentity, unitId: unit, pricingKind: 'FIXED', fixedUnitPurchasePrice: 0, currencyCode: 'SAR', taxTreatment: 'VAT_EXCLUSIVE', idempotencyKey: uuid() })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_COMMERCIAL_INVALID');
    expect((await database.query(`SELECT count(*)::int count FROM audit_logs WHERE action='supplier_future_demand_framework.commercial_term_created'`)).rows[0].count).toBe(auditBefore.rows[0].count);
  });

  it('denies partner, supplier, and dual-role runtime spoofing across every Batch 12 table and gateway', async () => {
    const framework = await draftFramework();
    const dualRoleCompany = uuid(); const dualRoleUser = uuid();
    await database.query(`INSERT INTO "Company"(id,name,type) VALUES($1,$2,'PARTNER')`, [dualRoleCompany, `dual-role-${dualRoleCompany}`]);
    await database.query(`INSERT INTO company_partnerships(company_id,type,status) VALUES($1,'BUYER_PARTNERSHIP','ACTIVE'),($1,'SUPPLIER_PARTNERSHIP','ACTIVE')`, [dualRoleCompany]);
    await database.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [dualRoleUser, `${dualRoleUser}@sfd-dual-role.test`]);
    await database.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [uuid(), dualRoleUser, dualRoleCompany]);
    const tableNames = [
      'supplier_future_demand_frameworks', 'supplier_future_demand_framework_revisions',
      'supplier_future_demand_framework_scope_lines', 'supplier_future_demand_framework_lifecycle_events',
      'supplier_future_demand_framework_commercial_terms', 'supplier_future_demand_framework_price_tiers',
      'supplier_future_demand_framework_capacity_periods', 'supplier_future_demand_framework_buying_power_provenance',
    ];
    const tables = await database.query(`SELECT relname,relrowsecurity,relforcerowsecurity,has_table_privilege('sco_runtime',format('public.%I',relname),'SELECT') runtime_select,has_table_privilege('sco_internal_executor',format('public.%I',relname),'SELECT') internal_select FROM pg_class WHERE relkind='r' AND relname=ANY($1) ORDER BY relname`, [tableNames]);
    expect(tables.rows).toHaveLength(tableNames.length);
    expect(tables.rows.every((table: any) => table.relrowsecurity && table.relforcerowsecurity && !table.runtime_select && !table.internal_select)).toBe(true);

    const gateways = await database.query(`SELECT proname,prosecdef,proconfig,has_function_privilege('public',oid,'EXECUTE') public_execute,has_function_privilege('sco_runtime',oid,'EXECUTE') runtime_execute FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'internal_supplier_future_demand_framework%' ORDER BY proname`);
    expect(gateways.rows).not.toHaveLength(0);
    expect(gateways.rows.every((gateway: any) => gateway.prosecdef && !gateway.public_execute && !gateway.runtime_execute && gateway.proconfig.includes('search_path=pg_catalog, public'))).toBe(true);

    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); await runtime.connect();
    try {
      await runtime.query(`SELECT set_config('app.tenant_id',$1,false),set_config('app.actor_id',$2,false),set_config('app.sco_internal','true',false)`, [dualRoleCompany, dualRoleUser]);
      for (const tableName of tableNames) await expect(runtime.query(`SELECT * FROM public.${tableName}`)).rejects.toThrow(/permission denied/i);
      await expect(runtime.query(`SELECT public.internal_supplier_future_demand_framework_get($1,$2)`, [actor, framework.framework_id])).rejects.toThrow(/permission denied/i);
      await expect(runtime.query(`SELECT public.internal_supplier_future_demand_framework_commercial_terms_get($1,$2)`, [actor, framework.revision_id])).rejects.toThrow(/permission denied/i);
    } finally { await runtime.end(); }

    expect(await service.getSupplierFutureDemandFramework(deniedActor, framework.framework_id)).toEqual([]);
    expect(await service.getSupplierFutureDemandFramework(deniedActor, uuid())).toEqual([]);
    expect(await service.getSupplierFutureDemandFrameworkCommercialTerms(deniedActor, framework.revision_id)).toEqual([]);
    expect(await service.getSupplierFutureDemandFrameworkBuyingPowerProvenance(deniedActor, framework.revision_id)).toEqual([]);
  });
});