import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';
import { RuntimeDatabaseService } from '../../src/database/runtime-database.service.js';
import { TenantTransactionService } from '../../src/database/tenant-transaction.service.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { RfqService } from '../../src/modules/identity/rfq.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService;
let runtime: RuntimeDatabaseService;
let service: RfqService;
let scoCompany: string;
let creator: string;
let product: string;
let unit: string;
let project: string;
const actors: Record<string, string> = {};
const sources: Array<{ sourceId: string; supplierId: string }> = [];

async function addUser(kind: 'SCO' | 'PARTNER' | 'SUPPLIER' = 'SCO') {
  const userId = id();
  const companyId = kind === 'SCO' ? scoCompany : id();
  await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\')', [userId, `${userId}@source-selection.test`]);
  if (kind !== 'SCO') await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,$2,$3)', [companyId, `${kind}-${companyId}`, kind]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
  return userId;
}

async function grant(userId: string, ...codes: string[]) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, scoCompany])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,\'source-selection\')', [role, scoCompany, `source-selection-${role}`]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), scoCompany, membership, role]);
  for (const code of codes) await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), scoCompany, role, code]);
}

async function createRfq(requestedQuantity = 1000) {
  const need = id(), cycle = id(), execution = id(), executionItem = id(), rfqId = id(), rfqItemId = id();
  await owner.query('INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,unit_id,need_date,maturity,review_status) VALUES($1,$2,$3,$4,\'MANUAL\',$5,\'source selection\',$6,$7,current_date,\'READY\',\'APPROVED\')', [need, scoCompany, project, creator, product, requestedQuantity, unit]);
  await owner.query('INSERT INTO procurement_cycles(id,cycle_code,name,intake_opens_at,intake_closes_at,status) VALUES($1,$2,\'source selection\',now(),now(),\'PROCESSING\')', [cycle, `source-${cycle}`]);
  await owner.query('INSERT INTO procurement_executions(id,cycle_id,status,created_by) VALUES($1,$2,\'SOURCING_READY\',$3)', [execution, cycle, creator]);
  await owner.query('INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,current_date,$9,$10,\'SOURCING_READY\')', [executionItem, execution, scoCompany, project, need, product, requestedQuantity, unit, id(), creator]);
  await owner.query('INSERT INTO rfqs(id,created_by,status) VALUES($1,$2,\'EVALUATION\')', [rfqId, creator]);
  await owner.query('INSERT INTO rfq_items(id,rfq_id,execution_item_id,company_id,project_id,procurement_need_id,product_identity_id,requested_quantity,unit_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [rfqItemId, rfqId, executionItem, scoCompany, project, need, product, requestedQuantity, unit]);
  return { rfqId, rfqItemId };
}

async function createRevision(rfqId: string, rfqItemId: string, sourceIndex: number, initiatedBy: string, price: number) {
  const { sourceId, supplierId } = sources[sourceIndex];
  const quoteId = id(), revisionId = id();
  await owner.query('INSERT INTO supplier_quotes(id,rfq_id,purchase_source_id,supplier_company_id,created_by) VALUES($1,$2,$3,$4,$5)', [quoteId, rfqId, sourceId, supplierId, initiatedBy]);
  await owner.query('INSERT INTO supplier_quote_revisions(id,supplier_quote_id,revision_number,initiated_by,currency_code) VALUES($1,$2,1,$3,\'SAR\')', [revisionId, quoteId, initiatedBy]);
  await owner.query('INSERT INTO supplier_quote_items(id,revision_id,rfq_item_id,product_identity_id,quoted_quantity,unit_price_excl_tax) VALUES($1,$2,$3,$4,1000,$5)', [id(), revisionId, rfqItemId, product, price]);
  return { revisionId, sourceId, supplierId, price };
}

async function select(actor: string, fixture: { rfqItemId: string }, revision: Awaited<ReturnType<typeof createRevision>>, quantity: number, selfApprove = false, correlationId = id()) {
  return service.approveCost(actor, { rfqItemId: fixture.rfqItemId, revisionId: revision.revisionId, sourceId: revision.sourceId, supplierCompanyId: revision.supplierId, productIdentityId: product, quantity, currency: 'SAR', unitCost: revision.price, reason: 'human source selection', selfApprove, correlationId });
}

describe('Source selection authorization and audit', () => {
  beforeAll(async () => {
    scoCompany = id(); creator = id();
    await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,\'SCO source selection\',\'SCO\')', [scoCompany]);
    await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\')', [creator, `${creator}@source-selection.test`]);
    for (const name of ['sourceOnly', 'approveOnly', 'both', 'selfBoth', 'selfAll']) actors[name] = await addUser();
    await grant(actors.sourceOnly, 'source.select');
    await grant(actors.approveOnly, 'purchase_cost.approve');
    await grant(actors.both, 'source.select', 'purchase_cost.approve');
    await grant(actors.selfBoth, 'source.select', 'purchase_cost.approve');
    await grant(actors.selfAll, 'source.select', 'purchase_cost.approve', 'purchase_cost.self_approve');
    actors.partner = await addUser('PARTNER'); actors.supplier = await addUser('SUPPLIER'); actors.dual = await addUser('PARTNER');
    const dualSupplier = id(); await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,$2,\'SUPPLIER\')', [dualSupplier, `SUPPLIER-${dualSupplier}`]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), actors.dual, dualSupplier]);
    const category = id(); unit = id(); product = id(); project = id();
    await owner.query('INSERT INTO product_categories(id,code,name) VALUES($1,$2,\'Source selection\')', [category, `source-${category}`]);
    await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,\'Unit\',\'count\')', [unit, `source-${unit.slice(0, 8)}`]);
    await owner.query('INSERT INTO product_identities(id,category_id,unit_id,created_by,status) VALUES($1,$2,$3,$4,\'ACTIVE\')', [product, category, unit, creator]);
    await owner.query('INSERT INTO projects(id,company_id,code,name,status,created_by) VALUES($1,$2,$3,\'Source project\',\'ACTIVE\',$4)', [project, scoCompany, `source-${project}`, creator]);
    const sourceType = (await owner.query('SELECT id FROM purchase_source_type_definitions LIMIT 1')).rows[0].id;
    for (let index = 0; index < 2; index++) {
      const supplierId = id(), partnership = id(), sourceId = id();
      await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,$2,\'SUPPLIER\')', [supplierId, `Source supplier ${index}`]);
      await owner.query('INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,\'SUPPLIER_PARTNERSHIP\',\'ACTIVE\')', [partnership, supplierId]);
      await owner.query('INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,status,created_by) VALUES($1,$2,$3,$4,$5,\'ACTIVE\',$6)', [sourceId, supplierId, partnership, `source-${sourceId}`, sourceType, creator]);
      sources.push({ sourceId, supplierId });
    }
    internal = new InternalDatabaseService(); runtime = new RuntimeDatabaseService();
    service = new RfqService(internal);
  });

  afterAll(async () => { await internal.onModuleDestroy(); await runtime.onModuleDestroy(); await owner.end(); });

  it('requires source.select and purchase_cost.approve together', async () => {
    for (const [actor, error] of [[actors.sourceOnly, 'PURCHASE_COST_APPROVAL_FORBIDDEN'], [actors.approveOnly, 'SOURCE_SELECTION_FORBIDDEN']] as const) {
      const fixture = await createRfq(), revision = await createRevision(fixture.rfqId, fixture.rfqItemId, 0, creator, 10);
      await expect(select(actor, fixture, revision, 1)).rejects.toThrow(error);
      expect((await owner.query('SELECT 1 FROM approved_purchase_cost_snapshots WHERE supplier_quote_revision_id=$1', [revision.revisionId])).rowCount).toBe(0);
    }
    const fixture = await createRfq(), revision = await createRevision(fixture.rfqId, fixture.rfqItemId, 0, creator, 10);
    await expect(select(actors.both, fixture, revision, 1)).resolves.toHaveProperty('id');
  });

  it('keeps self-approval as an additional permission', async () => {
    const deniedFixture = await createRfq(), deniedRevision = await createRevision(deniedFixture.rfqId, deniedFixture.rfqItemId, 0, actors.selfBoth, 10);
    await expect(select(actors.selfBoth, deniedFixture, deniedRevision, 1, true)).rejects.toThrow('SEPARATION_OF_DUTIES_REQUIRED');
    const allowedFixture = await createRfq(), allowedRevision = await createRevision(allowedFixture.rfqId, allowedFixture.rfqItemId, 0, actors.selfAll, 10);
    await expect(select(actors.selfAll, allowedFixture, allowedRevision, 1, true)).resolves.toHaveProperty('id');
  });

  it('denies Partner, Supplier, and dual Buyer/Supplier actors', async () => {
    for (const name of ['partner', 'supplier', 'dual']) {
      const fixture = await createRfq(), revision = await createRevision(fixture.rfqId, fixture.rfqItemId, 0, creator, 10);
      await expect(select(actors[name], fixture, revision, 1)).rejects.toThrow('SOURCE_SELECTION_FORBIDDEN');
      expect((await owner.query('SELECT 1 FROM approved_purchase_cost_snapshots WHERE supplier_quote_revision_id=$1', [revision.revisionId])).rowCount).toBe(0);
    }
  });

  it('persists independent 600/400 split-award selections and audit evidence', async () => {
    const fixture = await createRfq(1000);
    const a = await createRevision(fixture.rfqId, fixture.rfqItemId, 0, creator, 10), b = await createRevision(fixture.rfqId, fixture.rfqItemId, 1, creator, 11);
    const first = await select(actors.both, fixture, a, 600), second = await select(actors.both, fixture, b, 400);
    const rows = await owner.query('SELECT id,purchase_source_id,supplier_quote_revision_id,approved_quantity FROM approved_purchase_cost_snapshots WHERE id=ANY($1::uuid[]) ORDER BY approved_quantity DESC', [[first.id, second.id]]);
    expect(rows.rows).toEqual([{ id: first.id, purchase_source_id: a.sourceId, supplier_quote_revision_id: a.revisionId, approved_quantity: '600.0000' }, { id: second.id, purchase_source_id: b.sourceId, supplier_quote_revision_id: b.revisionId, approved_quantity: '400.0000' }]);
    expect((await owner.query('SELECT count(*)::int AS count FROM audit_logs WHERE entity_id=ANY($1::uuid[])', [[first.id, second.id]])).rows[0].count).toBe(2);
  });

  it('persists complete source-selection audit and immutable history', async () => {
    const fixture = await createRfq(), revision = await createRevision(fixture.rfqId, fixture.rfqItemId, 0, creator, 10), correlationId = id();
    const selected = await select(actors.both, fixture, revision, 5, false, correlationId);
    const audit = (await owner.query('SELECT actor_user_id,action,entity_type,entity_id,metadata,correlation_id,created_at FROM audit_logs WHERE entity_id=$1', [selected.id])).rows[0];
    expect(audit).toMatchObject({ actor_user_id: actors.both, action: 'purchase_cost.approved', entity_type: 'ApprovedPurchaseCostSnapshot', entity_id: selected.id, correlation_id: correlationId });
    expect(audit.metadata).toMatchObject({ sourceSelection: true, purchaseSourceId: revision.sourceId, rfqItemId: fixture.rfqItemId, supplierQuoteRevisionId: revision.revisionId, approvedQuantity: 5, reason: 'human source selection' });
    expect(audit.created_at).toBeTruthy();
    await expect(owner.query('UPDATE approved_purchase_cost_snapshots SET purchase_source_id=$1 WHERE id=$2', [sources[1].sourceId, selected.id])).rejects.toThrow('APPROVED_PURCHASE_COST_SNAPSHOT_IMMUTABLE');
    await expect(owner.query('DELETE FROM approved_purchase_cost_snapshots WHERE id=$1', [selected.id])).rejects.toThrow('APPROVED_PURCHASE_COST_SNAPSHOT_IMMUTABLE');
    expect((await owner.query('SELECT purchase_source_id FROM approved_purchase_cost_snapshots WHERE id=$1', [selected.id])).rows[0].purchase_source_id).toBe(revision.sourceId);
  });

  it('does not select a winner from quote price or ranking', async () => {
    const fixture = await createRfq(), cheap = await createRevision(fixture.rfqId, fixture.rfqItemId, 0, creator, 1), expensive = await createRevision(fixture.rfqId, fixture.rfqItemId, 1, creator, 100);
    expect((await owner.query('SELECT 1 FROM approved_purchase_cost_snapshots WHERE supplier_quote_revision_id=ANY($1::uuid[])', [[cheap.revisionId, expensive.revisionId]])).rowCount).toBe(0);
    const selected = await select(actors.both, fixture, expensive, 1);
    const row = (await owner.query('SELECT purchase_source_id,supplier_quote_revision_id FROM approved_purchase_cost_snapshots WHERE id=$1', [selected.id])).rows[0];
    expect(row).toEqual({ purchase_source_id: expensive.sourceId, supplier_quote_revision_id: expensive.revisionId });
  });
});
