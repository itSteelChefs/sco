import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';
import { RuntimeDatabaseService } from '../../src/database/runtime-database.service.js';
import { TenantTransactionService } from '../../src/database/tenant-transaction.service.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { AlternativeProductService } from '../../src/modules/identity/alternative-product.service.js';
import { RfqService } from '../../src/modules/identity/rfq.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService;
let runtime: RuntimeDatabaseService;
let rfqs: RfqService;
let alternatives: AlternativeProductService;
let scoCompany: string;
let operator: string;
let costApprover: string;
let category: string;
let unit: string;
let product: string;
let project: string;
let supplier: string;
let source: string;
let positiveRfq: string;
const external: Array<{ userId: string; companyId: string; kind: string }> = [];

async function addUser(companyId: string, label: string) {
  const userId = id();
  await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\')', [userId, `${userId}@audit-coverage.test`]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
  return userId;
}

async function grant(userId: string, codes: string[]) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, scoCompany])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, scoCompany, `audit-${role}`, 'Audit coverage']);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), scoCompany, membership, role]);
  for (const code of codes) await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), scoCompany, role, code]);
}

async function executionItem() {
  const need = id(), cycle = id(), execution = id(), item = id();
  await owner.query('INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,unit_id,need_date,maturity,review_status) VALUES($1,$2,$3,$4,\'MANUAL\',$5,\'audit coverage\',100,$6,current_date,\'READY\',\'APPROVED\')', [need, scoCompany, project, operator, product, unit]);
  await owner.query('INSERT INTO procurement_cycles(id,cycle_code,name,intake_opens_at,intake_closes_at,status) VALUES($1,$2,\'audit coverage\',now(),now(),\'PROCESSING\')', [cycle, `audit-${cycle}`]);
  await owner.query('INSERT INTO procurement_executions(id,cycle_id,status,created_by) VALUES($1,$2,\'SOURCING_READY\',$3)', [execution, cycle, operator]);
  await owner.query('INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status) VALUES($1,$2,$3,$4,$5,$6,100,100,$7,current_date,$8,$9,\'SOURCING_READY\')', [item, execution, scoCompany, project, need, product, unit, id(), operator]);
  return { item, need };
}

async function rawRfq(status = 'DRAFT') {
  const chain = await executionItem(), rfqId = id(), itemId = id();
  await owner.query('INSERT INTO rfqs(id,created_by,status) VALUES($1,$2,$3)', [rfqId, operator, status]);
  await owner.query('INSERT INTO rfq_items(id,rfq_id,execution_item_id,company_id,project_id,procurement_need_id,product_identity_id,requested_quantity,unit_id) VALUES($1,$2,$3,$4,$5,$6,$7,100,$8)', [itemId, rfqId, chain.item, scoCompany, project, chain.need, product, unit]);
  return { rfqId, itemId };
}

async function rawQuote(rfqId: string, itemId: string, initiatedBy = operator) {
  const quoteId = id(), revisionId = id();
  await owner.query('INSERT INTO supplier_quotes(id,rfq_id,purchase_source_id,supplier_company_id,created_by) VALUES($1,$2,$3,$4,$5)', [quoteId, rfqId, source, supplier, initiatedBy]);
  await owner.query('INSERT INTO supplier_quote_revisions(id,supplier_quote_id,revision_number,initiated_by,currency_code) VALUES($1,$2,1,$3,\'SAR\')', [revisionId, quoteId, initiatedBy]);
  await owner.query('INSERT INTO supplier_quote_items(id,revision_id,rfq_item_id,product_identity_id,quoted_quantity,unit_price_excl_tax) VALUES($1,$2,$3,$4,100,10)', [id(), revisionId, itemId, product]);
  return { quoteId, revisionId };
}

function itemInput(itemId: string, unitPrice = 10) {
  return [{ rfqItemId: itemId, productIdentityId: product, quantity: 100, unitPrice }];
}

describe('Stage 003 Batch 8 broad audit coverage', () => {
  beforeAll(async () => {
    scoCompany = id(); operator = id(); costApprover = id(); category = id(); unit = id(); product = id(); project = id(); supplier = id();
    await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,\'SCO audit coverage\',\'SCO\'),($2,\'Supplier audit coverage\',\'SUPPLIER\')', [scoCompany, supplier]);
    await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\'),($3,$4,\'x\')', [operator, `${operator}@audit-coverage.test`, costApprover, `${costApprover}@audit-coverage.test`]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\'),($4,$5,$3,\'ACTIVE\')', [id(), operator, scoCompany, id(), costApprover]);
    await grant(operator, ['rfq.create', 'rfq.manage', 'quote.record', 'quote.revise', 'negotiation.manage', 'alternative_product.review']);
    await grant(costApprover, ['source.select', 'purchase_cost.approve', 'purchase_cost.self_approve']);
    await owner.query('INSERT INTO product_categories(id,code,name) VALUES($1,$2,\'Audit category\')', [category, `audit-${category}`]);
    await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,\'Unit\',\'count\')', [unit, `audit-${unit.slice(0, 8)}`]);
    await owner.query('INSERT INTO product_identities(id,category_id,unit_id,created_by,status) VALUES($1,$2,$3,$4,\'ACTIVE\')', [product, category, unit, operator]);
    await owner.query('INSERT INTO projects(id,company_id,code,name,status,created_by) VALUES($1,$2,$3,\'Audit project\',\'ACTIVE\',$4)', [project, scoCompany, `audit-${project}`, operator]);
    const partnership = id(), sourceType = (await owner.query('SELECT id FROM purchase_source_type_definitions LIMIT 1')).rows[0].id; source = id();
    await owner.query('INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,\'SUPPLIER_PARTNERSHIP\',\'ACTIVE\')', [partnership, supplier]);
    await owner.query('INSERT INTO supplier_qualifications(id,company_id,supplier_partnership_id,status,created_by) VALUES($1,$2,$3,\'ACTIVE\',$4)', [id(), scoCompany, partnership, operator]);
    await owner.query('INSERT INTO supplier_category_capabilities(id,company_id,supplier_partnership_id,category_id,status) VALUES($1,$2,$3,$4,\'ACTIVE\')', [id(), scoCompany, partnership, category]);
    await owner.query('INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,status,created_by) VALUES($1,$2,$3,$4,$5,\'ACTIVE\',$6)', [source, supplier, partnership, `audit-${source}`, sourceType, operator]);
    for (const kind of ['PARTNER', 'SUPPLIER'] as const) {
      const companyId = id(); await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,$2,$3)', [companyId, `${kind} audit`, kind]);
      external.push({ userId: await addUser(companyId, kind), companyId, kind });
    }
    const partnerCompany = id(), supplierCompany = id();
    await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,\'Dual buyer\',\'PARTNER\'),($2,\'Dual supplier\',\'SUPPLIER\')', [partnerCompany, supplierCompany]);
    const dual = await addUser(partnerCompany, 'DUAL'); await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), dual, supplierCompany]);
    external.push({ userId: dual, companyId: partnerCompany, kind: 'DUAL' });
    internal = new InternalDatabaseService(); runtime = new RuntimeDatabaseService();
    rfqs = new RfqService(internal); alternatives = new AlternativeProductService(internal);
  });

  afterAll(async () => { await internal.onModuleDestroy(); await runtime.onModuleDestroy(); await owner.end(); });

  it('writes exactly one minimized SCO_INTERNAL audit row for every implemented material mutation', async () => {
    const chain = await executionItem();
    const correlations = Array.from({ length: 9 }, id);
    const created = await rfqs.create(operator, { executionItemIds: [chain.item], internalNotes: 'must not enter audit' }, correlations[0]); positiveRfq = created.id;
    const rfqItem = (await owner.query('SELECT id FROM rfq_items WHERE rfq_id=$1', [created.id])).rows[0].id;
    await rfqs.transition(operator, created.id, 'READY_TO_SEND', 'ready after review', correlations[1]);
    const recipient = await rfqs.addRecipient(operator, created.id, source, correlations[2]);
    const quote = await rfqs.recordQuote(operator, { rfqId: created.id, purchaseSourceId: source, supplierCompanyId: supplier, quoteReference: 'PROTECTED-REF', currency: 'SAR', items: itemInput(rfqItem) }, correlations[3]);
    const revision = await rfqs.reviseQuote(operator, quote.quoteId, { currency: 'SAR', reason: 'supplier revision', items: itemInput(rfqItem, 9) }, correlations[4]);
    const negotiation = await rfqs.recordNegotiation(operator, { rfqId: created.id, revisionId: revision.id, direction: 'INBOUND', eventType: 'COUNTER', reason: 'commercial discussion', metadata: { discount: 'must not enter audit', terms: 'must not enter audit' } }, correlations[5]);
    const proposal = id(); await owner.query('INSERT INTO alternative_product_proposals(id,rfq_item_id,reason,created_by) VALUES($1,$2,\'supplier proposal\',$3)', [proposal, rfqItem, operator]);
    await alternatives.review(operator, proposal, 'APPROVED', 'technically accepted', correlations[6]);
    const selected = await rfqs.approveCost(costApprover, { rfqItemId: rfqItem, revisionId: revision.id, sourceId: source, supplierCompanyId: supplier, productIdentityId: product, quantity: 10, currency: 'SAR', unitCost: 9, reason: 'human commercial decision', correlationId: correlations[7] });
    const selfQuote = await rawQuote(created.id, rfqItem, costApprover);
    const selfSelected = await rfqs.approveCost(costApprover, { rfqItemId: rfqItem, revisionId: selfQuote.revisionId, sourceId: source, supplierCompanyId: supplier, productIdentityId: product, quantity: 5, currency: 'SAR', unitCost: 10, reason: 'explicit self-approval reason', selfApprove: true, correlationId: correlations[8] });
    const rows = await owner.query('SELECT actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id,created_at FROM audit_logs WHERE correlation_id=ANY($1::uuid[]) ORDER BY correlation_id', [correlations]);
    expect(rows.rowCount).toBe(9);
    for (const correlation of correlations) expect(rows.rows.filter(row => row.correlation_id === correlation)).toHaveLength(1);
    expect(rows.rows.every(row => row.scope === 'SCO_INTERNAL' && row.actor_user_id && row.entity_id && row.created_at)).toBe(true);
    expect(rows.rows.map(row => row.action).sort()).toEqual(['alternative_product.approved','negotiation.event_recorded','purchase_cost.approved','purchase_cost.self_approved','quote.recorded','quote.revised','rfq.created','rfq.ready_to_send','rfq.recipient_added'].sort());
    expect(rows.rows.find(row => row.action === 'rfq.created')?.metadata).toEqual({ executionItemCount: 1 });
    expect(rows.rows.find(row => row.action === 'rfq.ready_to_send')?.metadata).toMatchObject({ fromStatus: 'DRAFT', toStatus: 'READY_TO_SEND', reason: 'ready after review' });
    expect(rows.rows.find(row => row.action === 'rfq.recipient_added')?.metadata).toMatchObject({ rfqId: created.id, purchaseSourceId: source });
    expect(rows.rows.find(row => row.action === 'quote.recorded')?.metadata).toMatchObject({ rfqId: created.id, revisionId: quote.revisionId, purchaseSourceId: source, itemCount: 1 });
    expect(rows.rows.find(row => row.action === 'quote.revised')?.metadata).toMatchObject({ quoteId: quote.quoteId, revisionNumber: 2, reason: 'supplier revision', itemCount: 1 });
    expect(rows.rows.find(row => row.action === 'negotiation.event_recorded')?.metadata).toMatchObject({ rfqId: created.id, revisionId: revision.id, eventType: 'COUNTER', direction: 'INBOUND', reason: 'commercial discussion', sessionCreated: true });
    expect(rows.rows.find(row => row.action === 'alternative_product.approved')?.metadata).toEqual({ decision: 'APPROVED', reason: 'technically accepted' });
    expect(rows.rows.find(row => row.action === 'purchase_cost.approved')).toMatchObject({ entity_id: selected.id });
    expect(rows.rows.find(row => row.action === 'purchase_cost.self_approved')).toMatchObject({ entity_id: selfSelected.id, metadata: expect.objectContaining({ selfApproval: true, reason: 'explicit self-approval reason' }) });
    expect(recipient.id).toBeTruthy(); expect(negotiation.id).toBeTruthy();
    const serialized = JSON.stringify(rows.rows.map(row => row.metadata));
    expect(serialized).not.toMatch(/PROTECTED-REF|must not enter audit|unitPrice|unit_purchase_cost|storage|path|signed|url|token|secret|credential/i);
  });

  it('rolls back mutations when their atomic audit row cannot be persisted', async () => {
    const invalidCorrelation = 'not-a-uuid', chain = await executionItem(), createMarker = `atomic-create-${id()}`;
    await expect(rfqs.create(operator, { executionItemIds: [chain.item], internalNotes: createMarker }, invalidCorrelation)).rejects.toThrow(/uuid|syntax/i);
    expect((await owner.query('SELECT 1 FROM rfqs WHERE internal_notes=$1', [createMarker])).rowCount).toBe(0);
    const fixture = await rawRfq();
    await expect(rfqs.transition(operator, fixture.rfqId, 'READY_TO_SEND', 'atomic transition', invalidCorrelation)).rejects.toThrow(/uuid|syntax/i);
    expect((await owner.query('SELECT status FROM rfqs WHERE id=$1', [fixture.rfqId])).rows[0].status).toBe('DRAFT');
    await expect(rfqs.addRecipient(operator, fixture.rfqId, source, invalidCorrelation)).rejects.toThrow(/uuid|syntax/i);
    expect((await owner.query('SELECT 1 FROM rfq_recipients WHERE rfq_id=$1', [fixture.rfqId])).rowCount).toBe(0);
    await expect(rfqs.recordQuote(operator, { rfqId: fixture.rfqId, purchaseSourceId: source, supplierCompanyId: supplier, currency: 'SAR', items: itemInput(fixture.itemId) }, invalidCorrelation)).rejects.toThrow(/uuid|syntax/i);
    expect((await owner.query('SELECT 1 FROM supplier_quotes WHERE rfq_id=$1', [fixture.rfqId])).rowCount).toBe(0);
    const raw = await rawQuote(fixture.rfqId, fixture.itemId);
    await expect(rfqs.reviseQuote(operator, raw.quoteId, { currency: 'SAR', reason: 'atomic revision', items: itemInput(fixture.itemId, 9) }, invalidCorrelation)).rejects.toThrow(/uuid|syntax/i);
    expect((await owner.query('SELECT count(*)::int AS count FROM supplier_quote_revisions WHERE supplier_quote_id=$1', [raw.quoteId])).rows[0].count).toBe(1);
    await expect(rfqs.approveCost(costApprover, { rfqItemId: fixture.itemId, revisionId: raw.revisionId, sourceId: source, supplierCompanyId: supplier, productIdentityId: product, quantity: 1, currency: 'SAR', unitCost: 10, reason: 'atomic source selection', correlationId: invalidCorrelation })).rejects.toThrow(/uuid|syntax/i);
    expect((await owner.query('SELECT 1 FROM approved_purchase_cost_snapshots WHERE supplier_quote_revision_id=$1', [raw.revisionId])).rowCount).toBe(0);
    await expect(rfqs.recordNegotiation(operator, { rfqId: fixture.rfqId, revisionId: raw.revisionId, direction: 'INBOUND', eventType: 'COUNTER', reason: 'atomic negotiation' }, invalidCorrelation)).rejects.toThrow(/uuid|syntax/i);
    expect((await owner.query('SELECT 1 FROM negotiation_sessions WHERE rfq_id=$1', [fixture.rfqId])).rowCount).toBe(0);
    const proposal = id(); await owner.query('INSERT INTO alternative_product_proposals(id,rfq_item_id,reason,created_by) VALUES($1,$2,\'atomic proposal\',$3)', [proposal, fixture.itemId, operator]);
    await expect(alternatives.review(operator, proposal, 'APPROVED', 'atomic review', invalidCorrelation)).rejects.toThrow(/uuid|syntax/i);
    expect((await owner.query('SELECT status FROM alternative_product_proposals WHERE id=$1', [proposal])).rows[0].status).toBe('PENDING_REVIEW');
  });

  it('denies external identities without an existence oracle and hides SCO_INTERNAL audit', async () => {
    for (const actor of external) {
      for (const target of [positiveRfq, id()]) await expect(rfqs.transition(actor.userId, target, 'READY_TO_SEND', undefined, id())).rejects.toThrow('RFQ_MANAGE_FORBIDDEN');
      expect((await owner.query('SELECT 1 FROM audit_logs WHERE actor_user_id=$1', [actor.userId])).rowCount).toBe(0);
      const client = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); await client.connect();
      try {
        await client.query('BEGIN'); await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.sco_internal','true',true)", [actor.companyId]);
        expect((await client.query('SELECT 1 FROM audit_logs WHERE entity_id=$1', [positiveRfq])).rowCount).toBe(0);
        expect((await client.query('SELECT 1 FROM audit_logs WHERE entity_id=$1', [id()])).rowCount).toBe(0);
        await client.query('ROLLBACK');
      } finally { await client.end(); }
    }
  });
});
