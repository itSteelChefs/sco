import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();

let internal: InternalDatabaseService;
let scoCompany: string;
let partnerCompany: string;
let creator: string;
let approver: string;
let selfWithoutPermission: string;
let selfApprover: string;
let lossApprover: string;
let pricingReader: string;
let marginReader: string;
let overheadReader: string;
let partnerActor: string;
let supplierActor: string;
let dualActor: string;
let product: string;
let unit: string;
let snapshot: string;

async function grant(userId: string, code: string) {
  let membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, scoCompany])).rows[0]?.id;
  if (!membership) {
    membership = id();
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [membership, userId, scoCompany]);
  }
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, scoCompany, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), scoCompany, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), scoCompany, role, code]);
}

async function createExternalActor(type: 'PARTNER' | 'SUPPLIER', userId: string = id(), existingUser = false) {
  const company = id();
  if (!existingUser) await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\')', [userId, `${userId}@${type.toLowerCase()}.test`]);
  await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,$2,$3)', [company, `${type}-${company}`, type]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, company]);
  return { userId, company };
}

async function createPricing(actor = creator, overrides: Partial<{ caseId: string; currency: string; quantity: number; unitSellingPrice: number; overhead: number; directCosts: object[]; allocations: object[] }> = {}) {
  return internal.createPricing(actor, {
    caseId: overrides.caseId,
    partnerCompanyId: partnerCompany,
    currency: overrides.currency ?? 'SAR',
    lines: [{
      lineNumber: 1,
      productIdentityId: product,
      quantity: overrides.quantity ?? 5,
      unitId: unit,
      unitSellingPrice: overrides.unitSellingPrice ?? 50,
      allocations: (overrides.allocations ?? [{ snapshotId: snapshot, quantity: 5, fxRate: 3.75, asOfDate: '2026-09-23', fxReason: 'manual pricing conversion' }]) as any[],
    }],
    directCosts: (overrides.directCosts ?? []) as any[],
    overhead: overrides.overhead,
    overheadReason: overrides.overhead === undefined ? undefined : 'manual analytical assessment',
    correlationId: id(),
  });
}

describe('Commercial pricing foundation', () => {
  beforeAll(async () => {
    scoCompany = id(); partnerCompany = id(); creator = id(); approver = id(); selfWithoutPermission = id(); selfApprover = id(); lossApprover = id(); pricingReader = id(); marginReader = id(); overheadReader = id();
    const supplier = id();
    const category = id(); const project = id(); const need = id(); const cycle = id(); const execution = id(); const executionItem = id(); const rfq = id(); const rfqItem = id(); const source = id(); const partnership = id();
    for (const user of [creator, approver, selfWithoutPermission, selfApprover, lossApprover, pricingReader, marginReader, overheadReader]) await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\')', [user, `${user}@pricing.test`]);
    await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,\'SCO pricing\',\'SCO\'),($2,\'Partner pricing\',\'PARTNER\'),($3,\'Supplier pricing\',\'SUPPLIER\')', [scoCompany, partnerCompany, supplier]);
    await grant(creator, 'pricing.create'); await grant(creator, 'pricing.direct_cost.manage');
    await grant(approver, 'pricing.approve');
    await grant(selfWithoutPermission, 'pricing.create'); await grant(selfWithoutPermission, 'pricing.approve');
    await grant(selfApprover, 'pricing.create'); await grant(selfApprover, 'pricing.approve'); await grant(selfApprover, 'pricing.self_approve');
    await grant(lossApprover, 'pricing.approve'); await grant(lossApprover, 'loss_sale.approve');
    await grant(pricingReader, 'pricing.read'); await grant(marginReader, 'margin.read'); await grant(overheadReader, 'overhead.read');
    await owner.query('INSERT INTO product_categories(id,code,name) VALUES($1,$2,\'Pricing category\')', [category, `pricing-${category}`]);
    unit = id();
    await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,\'Each\',\'count\')', [unit, `pricing-${unit.slice(0, 8)}`]);
    product = id();
    await owner.query('INSERT INTO product_identities(id,category_id,unit_id,created_by,status) VALUES($1,$2,$3,$4,\'ACTIVE\')', [product, category, unit, creator]);
    await owner.query('INSERT INTO projects(id,company_id,code,name,status,created_by) VALUES($1,$2,\'PRICING\',\'Pricing\',\'ACTIVE\',$3)', [project, partnerCompany, creator]);
    await owner.query('INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,unit_id,need_date,maturity,review_status) VALUES($1,$2,$3,$4,\'MANUAL\',$5,\'pricing need\',10,$6,current_date,\'READY\',\'APPROVED\')', [need, partnerCompany, project, creator, product, unit]);
    await owner.query('INSERT INTO procurement_cycles(id,cycle_code,name,intake_opens_at,intake_closes_at,status) VALUES($1,$2,\'pricing cycle\',now(),now(),\'PROCESSING\')', [cycle, `pricing-${cycle}`]);
    await owner.query('INSERT INTO procurement_executions(id,cycle_id,status,created_by) VALUES($1,$2,\'SOURCING_READY\',$3)', [execution, cycle, creator]);
    await owner.query('INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status) VALUES($1,$2,$3,$4,$5,$6,10,10,$7,current_date,$8,$9,\'SOURCING_READY\')', [executionItem, execution, partnerCompany, project, need, product, unit, id(), creator]);
    await owner.query('INSERT INTO rfqs(id,created_by,status) VALUES($1,$2,\'EVALUATION\')', [rfq, creator]);
    await owner.query('INSERT INTO rfq_items(id,rfq_id,execution_item_id,company_id,project_id,procurement_need_id,product_identity_id,requested_quantity,unit_id) VALUES($1,$2,$3,$4,$5,$6,$7,10,$8)', [rfqItem, rfq, executionItem, partnerCompany, project, need, product, unit]);
    await owner.query('INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,\'SUPPLIER_PARTNERSHIP\',\'ACTIVE\')', [partnership, supplier]);
    const sourceType = (await owner.query('SELECT id FROM purchase_source_type_definitions LIMIT 1')).rows[0].id;
    await owner.query('INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,created_by) VALUES($1,$2,$3,$4,$5,$6)', [source, supplier, partnership, `pricing-${source}`, sourceType, creator]);
    const quote = id(); const revision = id();
    await owner.query('INSERT INTO supplier_quotes(id,rfq_id,purchase_source_id,supplier_company_id,created_by) VALUES($1,$2,$3,$4,$5)', [quote, rfq, source, supplier, creator]);
    await owner.query('INSERT INTO supplier_quote_revisions(id,supplier_quote_id,revision_number,initiated_by,currency_code) VALUES($1,$2,1,$3,\'USD\')', [revision, quote, creator]);
    snapshot = id();
    await owner.query('INSERT INTO approved_purchase_cost_snapshots(id,rfq_item_id,supplier_quote_revision_id,purchase_source_id,supplier_company_id,product_identity_id,approved_quantity,currency_code,unit_purchase_cost,amount_excl_tax,amount_incl_tax,status,approved_by,approved_at,approval_reason,created_by) VALUES($1,$2,$3,$4,$5,$6,5,\'USD\',10,50,50,\'APPROVED\',$7,now(),\'fixture\',$7)', [snapshot, rfqItem, revision, source, supplier, product, creator]);
    internal = new InternalDatabaseService();
    partnerActor = (await createExternalActor('PARTNER')).userId;
    supplierActor = (await createExternalActor('SUPPLIER')).userId;
    dualActor = (await createExternalActor('PARTNER')).userId;
    await createExternalActor('SUPPLIER', dualActor, true);
  });

  afterAll(async () => { await internal?.onModuleDestroy(); await owner.end(); });

  it('creates a draft pricing revision from approved split-award cost allocations with manual FX and direct costs', async () => {
    const secondSnapshot = id();
    const sourceRow = (await owner.query('SELECT purchase_source_id,supplier_company_id,rfq_item_id,product_identity_id FROM approved_purchase_cost_snapshots WHERE id=$1', [snapshot])).rows[0];
    const quote = id(); const revision = id();
    await owner.query('INSERT INTO supplier_quotes(id,rfq_id,purchase_source_id,supplier_company_id,created_by) SELECT $1,r.rfq_id,$2,$3,$4 FROM rfq_items r WHERE r.id=$5', [quote, sourceRow.purchase_source_id, sourceRow.supplier_company_id, creator, sourceRow.rfq_item_id]);
    await owner.query('INSERT INTO supplier_quote_revisions(id,supplier_quote_id,revision_number,initiated_by,currency_code) VALUES($1,$2,1,$3,\'USD\')', [revision, quote, creator]);
    await owner.query('INSERT INTO approved_purchase_cost_snapshots(id,rfq_item_id,supplier_quote_revision_id,purchase_source_id,supplier_company_id,product_identity_id,approved_quantity,currency_code,unit_purchase_cost,amount_excl_tax,amount_incl_tax,status,approved_by,approved_at,approval_reason,created_by) VALUES($1,$2,$3,$4,$5,$6,5,\'USD\',12,60,60,\'APPROVED\',$7,now(),\'fixture\',$7)', [secondSnapshot, sourceRow.rfq_item_id, revision, sourceRow.purchase_source_id, sourceRow.supplier_company_id, sourceRow.product_identity_id, creator]);
    const result = await createPricing(creator, {
      unitSellingPrice: 60,
      quantity: 10,
      allocations: [{ snapshotId: snapshot, quantity: 5, fxRate: 3.75, asOfDate: '2026-09-23' }, { snapshotId: secondSnapshot, quantity: 5, fxRate: 3.75, asOfDate: '2026-09-23' }],
      directCosts: [{ lineNumber: 1, type: 'TRANSPORT', description: 'inbound transport', currency: 'USD', amount: 20, fxRate: 3.75, asOfDate: '2026-09-23' }],
    });
    expect(result.revisionId).toBeTruthy();
    const revisionRow = (await owner.query('SELECT status,direct_cost_basis,selling_total,gross_margin FROM pricing_revisions WHERE id=$1', [result.revisionId])).rows[0];
    expect(revisionRow).toMatchObject({ status: 'DRAFT', direct_cost_basis: '487.500000', selling_total: '600.000000', gross_margin: '112.500000' });
    expect((await owner.query('SELECT 1 FROM pricing_cost_allocations WHERE pricing_line_id=(SELECT id FROM pricing_lines WHERE pricing_revision_id=$1)', [result.revisionId])).rowCount).toBe(2);
    expect((await owner.query('SELECT 1 FROM manual_fx_snapshots WHERE pricing_line_id=(SELECT id FROM pricing_lines WHERE pricing_revision_id=$1)', [result.revisionId])).rowCount).toBe(3);
    expect((await owner.query('SELECT 1 FROM direct_deal_cost_items WHERE pricing_line_id=(SELECT id FROM pricing_lines WHERE pricing_revision_id=$1)', [result.revisionId])).rowCount).toBe(1);
    const fxSnapshot = (await owner.query("SELECT source_currency_code,target_currency_code,manual_rate,as_of_date FROM manual_fx_snapshots WHERE pricing_line_id=(SELECT id FROM pricing_lines WHERE pricing_revision_id=$1) ORDER BY created_at LIMIT 1", [result.revisionId])).rows[0];
    expect(fxSnapshot).toMatchObject({ source_currency_code: 'USD', target_currency_code: 'SAR', manual_rate: '3.750000000000' });
    expect(fxSnapshot.as_of_date.toISOString().slice(0, 10)).toBe('2026-09-23');
    expect((await owner.query("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='pricing.created'", [result.revisionId])).rowCount).toBe(1);
  });

  it('enforces creator separation, independent approval, self-approval reason, and atomic audit', async () => {
    const own = await createPricing(selfWithoutPermission);
    await internal.submitPricing(selfWithoutPermission, own.revisionId, id());
    await expect(internal.decidePricing(selfWithoutPermission, own.revisionId, 'APPROVED', undefined, false, id())).rejects.toThrow('PRICING_APPROVAL_REASON_REQUIRED');
    expect((await owner.query('SELECT 1 FROM pricing_approvals WHERE pricing_revision_id=$1', [own.revisionId])).rowCount).toBe(0);
    expect((await owner.query("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action LIKE 'pricing.%approved'", [own.revisionId])).rowCount).toBe(0);

    const normal = await createPricing();
    await internal.submitPricing(creator, normal.revisionId, id());
    const correlation = id();
    await internal.decidePricing(approver, normal.revisionId, 'APPROVED', undefined, false, correlation);
    expect((await owner.query('SELECT status,approved_by FROM pricing_revisions WHERE id=$1', [normal.revisionId])).rows[0]).toMatchObject({ status: 'APPROVED', approved_by: approver });
    const audit = (await owner.query("SELECT actor_user_id,action,correlation_id FROM audit_logs WHERE entity_id=$1 AND action='pricing.approved'", [normal.revisionId])).rows;
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ actor_user_id: approver, correlation_id: correlation });

    const self = await createPricing(selfApprover);
    await internal.submitPricing(selfApprover, self.revisionId, id());
    await expect(internal.decidePricing(selfApprover, self.revisionId, 'APPROVED', '   ', true, id())).rejects.toThrow('PRICING_APPROVAL_REASON_REQUIRED');
    await internal.decidePricing(selfApprover, self.revisionId, 'APPROVED', 'owner exception', true, id());
    expect((await owner.query("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='pricing.self_approved'", [self.revisionId])).rowCount).toBe(1);
  });

  it('routes direct loss only through loss_sale.approve and keeps overhead-only negative contribution out of that path', async () => {
    const loss = await createPricing(creator, { currency: 'USD', unitSellingPrice: 5, allocations: [{ snapshotId: snapshot, quantity: 5 }] });
    await internal.submitPricing(creator, loss.revisionId, id());
    await expect(internal.decidePricing(approver, loss.revisionId, 'APPROVED', 'normal approval', false, id())).rejects.toThrow('DIRECT_LOSS_APPROVAL_REQUIRED');
    expect((await owner.query('SELECT 1 FROM pricing_approvals WHERE pricing_revision_id=$1', [loss.revisionId])).rowCount).toBe(0);
    await internal.decidePricing(lossApprover, loss.revisionId, 'APPROVED', 'approved direct loss for strategic reason', false, id());
    expect((await owner.query("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='pricing.direct_loss_approved'", [loss.revisionId])).rowCount).toBe(1);

    const overhead = await createPricing(creator, { currency: 'USD', unitSellingPrice: 20, allocations: [{ snapshotId: snapshot, quantity: 5 }], overhead: 150 });
    await internal.submitPricing(creator, overhead.revisionId, id());
    await internal.decidePricing(approver, overhead.revisionId, 'APPROVED', undefined, false, id());
    const row = (await owner.query('SELECT gross_margin,estimated_contribution FROM pricing_revisions WHERE id=$1', [overhead.revisionId])).rows[0];
    expect(row).toMatchObject({ gross_margin: '50.000000', estimated_contribution: '-100.000000' });
    expect((await owner.query("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='pricing.direct_loss_approved'", [overhead.revisionId])).rowCount).toBe(0);
  });

  it('preserves immutable historical revisions and manual FX snapshots when a new revision supersedes an approved revision', async () => {
    const first = await createPricing();
    await internal.submitPricing(creator, first.revisionId, id());
    await internal.decidePricing(approver, first.revisionId, 'APPROVED', undefined, false, id());
    const caseId = (await owner.query('SELECT pricing_case_id FROM pricing_revisions WHERE id=$1', [first.revisionId])).rows[0].pricing_case_id;
    const second = await createPricing(creator, { caseId, unitSellingPrice: 55 });
    expect((await owner.query('SELECT status,superseded_by_revision_id,selling_total FROM pricing_revisions WHERE id=$1', [first.revisionId])).rows[0]).toMatchObject({ status: 'SUPERSEDED', superseded_by_revision_id: second.revisionId, selling_total: '250.000000' });
    for (const setting of [null, 'false', 'unexpected']) {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        await client.query('BEGIN');
        if (setting !== null) await client.query("SELECT set_config('app.pricing_gateway',$1,true)", [setting]);
        await expect(client.query('UPDATE pricing_revisions SET selling_total=1 WHERE id=$1', [first.revisionId])).rejects.toThrow('PRICING_HISTORY_IMMUTABLE');
      } finally { await client.query('ROLLBACK'); await client.end(); }
    }
    const fx = (await owner.query('SELECT id,manual_rate FROM manual_fx_snapshots WHERE pricing_line_id=(SELECT id FROM pricing_lines WHERE pricing_revision_id=$1) LIMIT 1', [second.revisionId])).rows[0];
    await expect(owner.query('UPDATE manual_fx_snapshots SET manual_rate=1 WHERE id=$1', [fx.id])).rejects.toThrow('PRICING_HISTORY_IMMUTABLE');
    expect((await owner.query('SELECT manual_rate FROM manual_fx_snapshots WHERE id=$1', [fx.id])).rows[0].manual_rate).toBe(fx.manual_rate);
  });

  it('makes approved, rejected, and superseded history fail closed while preserving rejection audit atomically', async () => {
    const approved = await createPricing();
    await internal.submitPricing(creator, approved.revisionId, id());
    await internal.decidePricing(approver, approved.revisionId, 'APPROVED', undefined, false, id());
    const rejected = await createPricing();
    await internal.submitPricing(creator, rejected.revisionId, id());
    await expect(internal.decidePricing(approver, rejected.revisionId, 'REJECTED', '  ', false, id())).rejects.toThrow('PRICING_APPROVAL_REASON_REQUIRED');
    expect((await owner.query("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='pricing.rejected'", [rejected.revisionId])).rowCount).toBe(0);
    const correlation = id();
    await internal.decidePricing(approver, rejected.revisionId, 'REJECTED', 'commercial review rejected', false, correlation);
    const rejectionAudit = (await owner.query("SELECT action,actor_user_id,correlation_id,metadata FROM audit_logs WHERE entity_id=$1 AND action='pricing.rejected'", [rejected.revisionId])).rows;
    expect(rejectionAudit).toHaveLength(1); expect(rejectionAudit[0]).toMatchObject({ action: 'pricing.rejected', actor_user_id: approver, correlation_id: correlation });
    expect(rejectionAudit[0].metadata).not.toHaveProperty('purchaseCost');
    const superseded = await createPricing(creator, { caseId: (await owner.query('SELECT pricing_case_id FROM pricing_revisions WHERE id=$1', [approved.revisionId])).rows[0].pricing_case_id });
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      for (const revisionId of [approved.revisionId, rejected.revisionId, superseded.revisionId]) {
        await expect(client.query('UPDATE pricing_revisions SET selling_total=0 WHERE id=$1', [revisionId])).rejects.toThrow('PRICING_HISTORY_IMMUTABLE');
      }
    } finally { await client.end(); }
  });

  it('keeps pricing, purchase-cost, margin, and overhead visibility independently permissioned', async () => {
    const pricing = await createPricing(creator, { overhead: 5 });
    expect(await internal.getPricing(pricingReader, pricing.revisionId)).toMatchObject({ id: pricing.revisionId });
    expect(await internal.getPurchaseCost(pricingReader, snapshot)).toBeNull();
    expect(await internal.getPricingMargin(pricingReader, pricing.revisionId)).toBeNull();
    expect(await internal.getPricingOverhead(pricingReader, pricing.revisionId)).toBeNull();
    expect(await internal.getPricingMargin(marginReader, pricing.revisionId)).toMatchObject({ id: pricing.revisionId });
    expect(await internal.getPricingOverhead(overheadReader, pricing.revisionId)).toMatchObject({ allocated_overhead: '5.000000' });
  });

  it('denies Partner, Supplier, dual-role and known/random UUID probes without revealing pricing internals', async () => {
    for (const actor of [partnerActor, supplierActor, dualActor]) {
      await expect(createPricing(actor)).rejects.toThrow('PRICING_CREATE_FORBIDDEN');
      expect(await internal.getPricing(actor, id())).toBeNull();
    }
    const known = await createPricing();
    expect(await internal.getPricing(partnerActor, known.revisionId)).toBeNull();
  });

  it('enforces RLS, removes direct DML, revokes PUBLIC execution, and ignores runtime app.sco_internal spoofing', async () => {
    const tables = ['pricing_cases','pricing_revisions','pricing_lines','manual_fx_snapshots','pricing_cost_allocations','direct_deal_cost_items','pricing_overhead_assessments','pricing_approvals'];
    const rls = await owner.query('SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])', [tables]);
    expect(rls.rows).toHaveLength(tables.length); expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); const executor = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
    await runtime.connect(); await executor.connect();
    try {
      for (const sql of ['SELECT * FROM pricing_revisions LIMIT 1', 'INSERT INTO pricing_cases(partner_company_id,created_by) VALUES($1,$2)']) {
        await runtime.query('BEGIN'); await runtime.query("SELECT set_config('app.sco_internal','true',true),set_config('app.pricing_gateway','true',true)");
        await expect(runtime.query(sql, sql.startsWith('INSERT') ? [partnerCompany, creator] : [])).rejects.toThrow(/permission denied/i);
        await runtime.query('ROLLBACK');
      }
      await expect(executor.query('SELECT * FROM pricing_revisions LIMIT 1')).rejects.toThrow(/permission denied/i);
      await expect(executor.query('DELETE FROM pricing_cases')).rejects.toThrow(/permission denied/i);
      const publicExecute = await owner.query("SELECT p.proname,has_function_privilege('public',p.oid,'EXECUTE') AS allowed FROM pg_proc p WHERE p.proname = ANY($1::text[])", [['internal_pricing_create','internal_pricing_submit','internal_pricing_decide','internal_pricing_get','internal_pricing_margin_get','internal_pricing_overhead_get']]);
      expect(publicExecute.rows).toHaveLength(6); expect(publicExecute.rows.every((row) => !row.allowed)).toBe(true);
    } finally { await runtime.end(); await executor.end(); }
  });
});
