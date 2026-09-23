import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { RuntimeDatabaseService } from '../../src/database/runtime-database.service.js';
import { ScoInternalTransactionService } from '../../src/database/sco-internal-transaction.service.js';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';
import { TenantTransactionService } from '../../src/database/tenant-transaction.service.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { RfqService } from '../../src/modules/identity/rfq.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let service: RfqService;
let company: string;
let creator: string;
let approver: string;
let product: string;
let unit: string;
let project: string;
let supplier: string;
let source: string;

type RfqFixture = { rfqId: string; rfqItemId: string };

async function createRfqFixture(requestedQuantity = 1000): Promise<RfqFixture> {
  const need = id();
  const cycle = id();
  const execution = id();
  const executionItem = id();
  const rfqId = id();
  const rfqItemId = id();
  await owner.query('INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,unit_id,need_date,maturity,review_status) VALUES($1,$2,$3,$4,\'MANUAL\',$5,\'split award\',$6,$7,current_date,\'READY\',\'APPROVED\')', [need, company, project, creator, product, requestedQuantity, unit]);
  await owner.query('INSERT INTO procurement_cycles(id,cycle_code,name,intake_opens_at,intake_closes_at,status) VALUES($1,$2,\'split cycle\',now(),now(),\'PROCESSING\')', [cycle, `split-${cycle}`]);
  await owner.query('INSERT INTO procurement_executions(id,cycle_id,status,created_by) VALUES($1,$2,\'SOURCING_READY\',$3)', [execution, cycle, creator]);
  await owner.query('INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,current_date,$9,$10,\'SOURCING_READY\')', [executionItem, execution, company, project, need, product, requestedQuantity, unit, id(), creator]);
  await owner.query('INSERT INTO rfqs(id,created_by,status) VALUES($1,$2,\'EVALUATION\')', [rfqId, creator]);
  await owner.query('INSERT INTO rfq_items(id,rfq_id,execution_item_id,company_id,project_id,procurement_need_id,product_identity_id,requested_quantity,unit_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [rfqItemId, rfqId, executionItem, company, project, need, product, requestedQuantity, unit]);
  return { rfqId, rfqItemId };
}

async function createRevision(rfqId: string) {
  const quote = id();
  const revision = id();
  await owner.query('INSERT INTO supplier_quotes(id,rfq_id,purchase_source_id,supplier_company_id,created_by) VALUES($1,$2,$3,$4,$5)', [quote, rfqId, source, supplier, creator]);
  await owner.query('INSERT INTO supplier_quote_revisions(id,supplier_quote_id,revision_number,initiated_by,currency_code) VALUES($1,$2,1,$3,\'SAR\')', [revision, quote, creator]);
  await owner.query('INSERT INTO supplier_quote_items(id,revision_id,rfq_item_id,product_identity_id,quoted_quantity,unit_price_excl_tax) VALUES($1,$2,$3,$4,1000,10)', [id(), revision, (await owner.query('SELECT id FROM rfq_items WHERE rfq_id=$1', [rfqId])).rows[0].id, product]);
  return revision;
}

async function approve(fixture: RfqFixture, quantity: number) {
  const revisionId = await createRevision(fixture.rfqId);
  return service.approveCost(approver, {
    rfqItemId: fixture.rfqItemId,
    revisionId,
    sourceId: source,
    supplierCompanyId: supplier,
    productIdentityId: product,
    quantity,
    currency: 'SAR',
    unitCost: 10,
    reason: 'sequential split award verification',
    correlationId: id(),
  });
}

async function totals(rfqItemId: string) {
  return (await owner.query('SELECT count(*)::int AS snapshots, COALESCE(sum(approved_quantity),0)::text AS total FROM approved_purchase_cost_snapshots WHERE rfq_item_id=$1 AND status=\'APPROVED\'', [rfqItemId])).rows[0];
}

describe('Purchase cost sequential split award', () => {
  beforeAll(async () => {
    company = id(); creator = id(); approver = id(); supplier = id();
    const category = id();
    const partnership = id();
    await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,\'SCO split award\',\'SCO\'),($2,\'Supplier split award\',\'SUPPLIER\')', [company, supplier]);
    await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\'),($3,$4,\'x\')', [creator, `${creator}@split.test`, approver, `${approver}@split.test`]);
    const membership = id(); const role = id();
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [membership, approver, company]);
    await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,\'purchase-cost-approve\')', [role, company, `purchase-cost-approve-${role}`]);
    await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), company, membership, role]);
    await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=\'purchase_cost.approve\'', [id(), company, role]);
    await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=\'source.select\'', [id(), company, role]);
    await owner.query('INSERT INTO product_categories(id,code,name) VALUES($1,$2,\'Split category\')', [category, `split-${category}`]);
    unit = id();
    await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,\'Unit\',\'count\')', [unit, `split-${unit.slice(0, 8)}`]);
    product = id();
    await owner.query('INSERT INTO product_identities(id,category_id,unit_id,created_by,status) VALUES($1,$2,$3,$4,\'ACTIVE\')', [product, category, unit, creator]);
    project = id();
    await owner.query('INSERT INTO projects(id,company_id,code,name,status,created_by) VALUES($1,$2,$3,\'Split project\',\'ACTIVE\',$4)', [project, company, `split-${project}`, creator]);
    await owner.query('INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,\'SUPPLIER_PARTNERSHIP\',\'ACTIVE\')', [partnership, supplier]);
    const sourceType = (await owner.query('SELECT id FROM purchase_source_type_definitions LIMIT 1')).rows[0].id;
    source = id();
    await owner.query('INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,created_by) VALUES($1,$2,$3,$4,$5,$6)', [source, supplier, partnership, `split-${source}`, sourceType, creator]);
    const database = new RuntimeDatabaseService();
    service = new RfqService(new InternalDatabaseService());
  });

  afterAll(async () => { await owner.end(); });

  it('approves 600 then 400 and preserves a total of 1000', async () => {
    const fixture = await createRfqFixture();
    await expect(approve(fixture, 600)).resolves.toBeTruthy();
    await expect(approve(fixture, 400)).resolves.toBeTruthy();
    await expect(totals(fixture.rfqItemId)).resolves.toEqual({ snapshots: 2, total: '1000.0000' });
    await expect(approve(fixture, 1)).rejects.toThrow('APPROVED_QUANTITY_EXCEEDED');
    await expect(totals(fixture.rfqItemId)).resolves.toEqual({ snapshots: 2, total: '1000.0000' });
  });

  it('rejects 500 after 600 and leaves the second item at 600', async () => {
    const fixture = await createRfqFixture();
    await expect(approve(fixture, 600)).resolves.toBeTruthy();
    await expect(approve(fixture, 500)).rejects.toThrow('APPROVED_QUANTITY_EXCEEDED');
    await expect(totals(fixture.rfqItemId)).resolves.toEqual({ snapshots: 1, total: '600.0000' });
  });

  it.each([0, -1])('rejects quantity %s through the snapshot quantity constraint without persistence', async quantity => {
    const fixture = await createRfqFixture();
    await expect(approve(fixture, quantity)).rejects.toThrow(/approved_purchase_cost_snapshots_approved_quantity_check/i);
    await expect(totals(fixture.rfqItemId)).resolves.toEqual({ snapshots: 0, total: '0' });
  });
});
