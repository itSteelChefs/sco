import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let service: InternalDatabaseService;
let actor: string;
let approveOnly: string;
let denied: string;
let supplierCompany: string;
let supplierPartnership: string;
let purchaseSource: string;
let productIdentity: string;
let unit: string;

async function principal(permissions: string[]) {
  let sco = (await db.query(`SELECT id FROM "Company" WHERE type='SCO' AND status='ACTIVE' LIMIT 1`)).rows[0]?.id;
  if (!sco) {
    sco = id();
    await db.query(`INSERT INTO "Company"(id,name,type) VALUES($1,$2,'SCO')`, [sco, `SFD internal ${sco}`]);
  }
  const user = id(); const membership = id(); const role = id();
  await db.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [user, `${user}@sfd.test`]);
  await db.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membership, user, sco]);
  await db.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3)`, [role, sco, `sfd-${id()}`]);
  await db.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(), sco, membership, role]);
  for (const permission of permissions) await db.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`, [id(), sco, role, permission]);
  return user;
}

async function activeSupplierSource(createdBy: string) {
  const existing = (await db.query(`SELECT ps.supplier_company_id,ps.supplier_partnership_id,ps.id FROM purchase_sources ps JOIN company_partnerships cp ON cp.id=ps.supplier_partnership_id WHERE ps.status='ACTIVE' AND cp.status='ACTIVE' AND cp.type='SUPPLIER_PARTNERSHIP' LIMIT 1`)).rows[0];
  if (existing) return existing;
  const companyId = id(); const partnershipId = id(); const sourceId = id();
  await db.query(`INSERT INTO "Company"(id,name,type) VALUES($1,$2,'SUPPLIER')`, [companyId, `SFD supplier ${companyId}`]);
  await db.query(`INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,'SUPPLIER_PARTNERSHIP','ACTIVE')`, [partnershipId, companyId]);
  const sourceTypeId = (await db.query(`SELECT id FROM purchase_source_type_definitions WHERE active ORDER BY sort_order,id LIMIT 1`)).rows[0].id;
  await db.query(`INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,status,created_by) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6)`, [sourceId, companyId, partnershipId, `sfd-${sourceId}`, sourceTypeId, createdBy]);
  return { supplier_company_id: companyId, supplier_partnership_id: partnershipId, id: sourceId };
}

async function activeProductScope(createdBy: string) {
  const existing = (await db.query(`SELECT pi.id product_identity_id,pi.unit_id FROM product_identities pi JOIN unit_definitions u ON u.id=pi.unit_id WHERE pi.status='ACTIVE' AND u.active LIMIT 1`)).rows[0];
  if (existing) return existing;
  const categoryId = id(); const unitId = id(); const productId = id();
  await db.query(`INSERT INTO product_categories(id,code,name) VALUES($1,$2,$3)`, [categoryId, `sfd-${categoryId}`, `SFD category ${categoryId}`]);
  await db.query(`INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,$3,'count')`, [unitId, `sfd-${unitId}`, `SFD unit ${unitId}`]);
  await db.query(`INSERT INTO product_identities(id,category_id,unit_id,created_by,status) VALUES($1,$2,$3,$4,'ACTIVE')`, [productId, categoryId, unitId, createdBy]);
  return { product_identity_id: productId, unit_id: unitId };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    reference: `SFD-${id()}`,
    supplierCompanyId: supplierCompany,
    supplierPartnershipId: supplierPartnership,
    purchaseSourceId: purchaseSource,
    effectiveFrom: '2031-01-01',
    effectiveUntil: '2031-12-31',
    scopeLines: [{ productIdentityId: productIdentity, unitId: unit }],
    idempotencyKey: id(),
    ...overrides,
  };
}

async function acceptedFramework() {
  const created = await service.createSupplierFutureDemandFramework(actor, input());
  await service.approveSupplierFutureDemandFramework(actor, created.revision_id, id());
  await service.offerSupplierFutureDemandFramework(actor, created.revision_id, id());
  await service.acceptSupplierFutureDemandFramework(actor, created.revision_id, { reference: `supplier-acceptance-${id()}`, idempotencyKey: id() });
  return created;
}

describe('Batch 12-A Supplier Future-Demand Framework core', () => {
  beforeAll(async () => {
    service = new InternalDatabaseService();
    actor = await principal([
      'supplier_future_demand_framework.create', 'supplier_future_demand_framework.read',
      'supplier_future_demand_framework.approve', 'supplier_future_demand_framework.offer',
      'supplier_future_demand_framework.accept', 'supplier_future_demand_framework.supersede',
      'supplier_future_demand_framework.terminate',
    ]);
    approveOnly = await principal(['supplier_future_demand_framework.approve']);
    denied = await principal([]);
    const source = await activeSupplierSource(actor);
    supplierCompany = source.supplier_company_id; supplierPartnership = source.supplier_partnership_id; purchaseSource = source.id;
    const scope = await activeProductScope(actor);
    productIdentity = scope.product_identity_id; unit = scope.unit_id;
  });
  afterAll(async () => { await service.onModuleDestroy(); await db.end(); });

  it('creates a draft with exact Product Identity and Unit and validates supplier scope', async () => {
    const created = await service.createSupplierFutureDemandFramework(actor, input());
    const rows: any[] = await service.getSupplierFutureDemandFramework(actor, created.framework_id);
    expect(rows[0]).toMatchObject({ framework_id: created.framework_id, revision_id: created.revision_id, revision_status: 'DRAFT', derived_state: 'INACTIVE' });
    expect((await db.query(`SELECT product_identity_id,unit_id FROM supplier_future_demand_framework_scope_lines WHERE revision_id=$1`, [created.revision_id])).rows[0]).toEqual({ product_identity_id: productIdentity, unit_id: unit });
    await expect(service.createSupplierFutureDemandFramework(actor, input({ supplierPartnershipId: id() }))).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_INVALID');
    await expect(service.createSupplierFutureDemandFramework(actor, input({ scopeLines: [{ productIdentityId: productIdentity }] }))).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_SCOPE_INVALID');
  });

  it('enforces ordered lifecycle, evidence, immutable revisions, and derived states', async () => {
    const created = await service.createSupplierFutureDemandFramework(actor, input({ effectiveFrom: '2000-01-01', effectiveUntil: '2999-12-31' }));
    await expect(service.offerSupplierFutureDemandFramework(actor, created.revision_id, id())).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_TRANSITION_INVALID');
    await service.approveSupplierFutureDemandFramework(actor, created.revision_id, id());
    await db.query(`RESET app.supplier_future_demand_framework_gateway`);
    await expect(db.query(`UPDATE supplier_future_demand_framework_revisions SET effective_until='3000-01-01' WHERE id=$1`, [created.revision_id])).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_IMMUTABLE');
    await expect(db.query(`DELETE FROM supplier_future_demand_framework_revisions WHERE id=$1`, [created.revision_id])).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_IMMUTABLE');
    await expect(service.approveSupplierFutureDemandFramework(approveOnly, created.revision_id, id())).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_TRANSITION_INVALID');
    await service.offerSupplierFutureDemandFramework(actor, created.revision_id, id());
    await expect(service.acceptSupplierFutureDemandFramework(actor, created.revision_id, { idempotencyKey: id() })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_ACCEPTANCE_EVIDENCE_INVALID');
    await service.acceptSupplierFutureDemandFramework(actor, created.revision_id, { reference: 'supplier-email-approval', idempotencyKey: id() });
    expect((await service.getSupplierFutureDemandFramework(actor, created.framework_id)).find((row: any) => row.revision_id === created.revision_id)).toMatchObject({ derived_state: 'ACTIVE' });
    await db.query(`RESET app.supplier_future_demand_framework_gateway`);
    await expect(db.query(`UPDATE supplier_future_demand_framework_revisions SET effective_until='3000-01-01' WHERE id=$1`, [created.revision_id])).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_IMMUTABLE');
    await expect(db.query(`DELETE FROM supplier_future_demand_framework_revisions WHERE id=$1`, [created.revision_id])).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_IMMUTABLE');
    await expect(db.query(`DELETE FROM supplier_future_demand_framework_lifecycle_events WHERE revision_id=$1`, [created.revision_id])).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_IMMUTABLE');
    await service.supersedeSupplierFutureDemandFramework(actor, created.revision_id, id());
    expect((await service.getSupplierFutureDemandFramework(actor, created.framework_id)).find((row: any) => row.revision_id === created.revision_id)).toMatchObject({ derived_state: 'INACTIVE', revision_status: 'SUPERSEDED' });
  });

  it('provides idempotency, termination, and concurrent revision safety', async () => {
    const retry = input(); const first = await service.createSupplierFutureDemandFramework(actor, retry);
    expect(await service.createSupplierFutureDemandFramework(actor, retry)).toEqual(first);
    await expect(service.createSupplierFutureDemandFramework(actor, { ...retry, reference: `${retry.reference}-changed` })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_IDEMPOTENCY_CONFLICT');
    await service.terminateSupplierFutureDemandFramework(actor, first.framework_id, 'commercially withdrawn', 'terminate-key');
    await service.terminateSupplierFutureDemandFramework(actor, first.framework_id, 'commercially withdrawn', 'terminate-key');
    await expect(service.createSupplierFutureDemandFrameworkRevision(actor, first.framework_id, { effectiveFrom: '2032-01-01', effectiveUntil: '2032-12-31', scopeLines: [{ productIdentityId: productIdentity, unitId: unit }], idempotencyKey: id() })).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_FORBIDDEN');
    const created = await service.createSupplierFutureDemandFramework(actor, input());
    const a = new InternalDatabaseService(); const b = new InternalDatabaseService();
    try {
      const result = await Promise.all([a.createSupplierFutureDemandFrameworkRevision(actor, created.framework_id, { effectiveFrom: '2032-01-01', effectiveUntil: '2032-12-31', scopeLines: [{ productIdentityId: productIdentity, unitId: unit }], idempotencyKey: id() }), b.createSupplierFutureDemandFrameworkRevision(actor, created.framework_id, { effectiveFrom: '2033-01-01', effectiveUntil: '2033-12-31', scopeLines: [{ productIdentityId: productIdentity, unitId: unit }], idempotencyKey: id() })]);
      expect(new Set((await db.query(`SELECT revision_number FROM supplier_future_demand_framework_revisions WHERE id=ANY($1::uuid[])`, [result])).rows.map((row) => row.revision_number)).size).toBe(2);
    } finally { await a.onModuleDestroy(); await b.onModuleDestroy(); }
  });

  it('denies Partner/Supplier runtime access, protects tables and gateways, and leaves adjacent domains unchanged', async () => {
    const before = await db.query(`SELECT (SELECT count(*)::int FROM procurement_needs) needs,(SELECT count(*)::int FROM commercial_commitments) commitments,(SELECT count(*)::int FROM procurement_releases) releases,(SELECT count(*)::int FROM supplier_purchase_orders) pos,(SELECT count(*)::int FROM buying_power_snapshots) buying_power`);
    await expect(service.createSupplierFutureDemandFramework(denied, input())).rejects.toThrow('SUPPLIER_FUTURE_DEMAND_FRAMEWORK_FORBIDDEN');
    const tables = await db.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relkind='r' AND relname = ANY(ARRAY['supplier_future_demand_frameworks','supplier_future_demand_framework_revisions','supplier_future_demand_framework_scope_lines','supplier_future_demand_framework_lifecycle_events'])`);
    expect(tables.rows).toHaveLength(4); expect(tables.rows.every((row: any) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const acl = await db.query(`SELECT has_table_privilege('sco_runtime','public.supplier_future_demand_frameworks','SELECT') runtime_select,has_function_privilege('public','public.internal_supplier_future_demand_framework_create(uuid,text,uuid,uuid,uuid,date,date,jsonb,text,text)','EXECUTE') public_execute,has_function_privilege('sco_runtime','public.internal_supplier_future_demand_framework_create(uuid,text,uuid,uuid,uuid,date,date,jsonb,text,text)','EXECUTE') runtime_execute,proconfig FROM pg_proc WHERE oid='public.internal_supplier_future_demand_framework_create(uuid,text,uuid,uuid,uuid,date,date,jsonb,text,text)'::regprocedure`);
    expect(acl.rows[0]).toMatchObject({ runtime_select: false, public_execute: false, runtime_execute: false }); expect(acl.rows[0].proconfig).toContain('search_path=pg_catalog, public');
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); await runtime.connect();
    try { await expect(runtime.query(`SELECT * FROM supplier_future_demand_frameworks`)).rejects.toThrow(/permission denied/i); } finally { await runtime.end(); }
    const after = await db.query(`SELECT (SELECT count(*)::int FROM procurement_needs) needs,(SELECT count(*)::int FROM commercial_commitments) commitments,(SELECT count(*)::int FROM procurement_releases) releases,(SELECT count(*)::int FROM supplier_purchase_orders) pos,(SELECT count(*)::int FROM buying_power_snapshots) buying_power`);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});