import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';
import { RuntimeDatabaseService } from '../../src/database/runtime-database.service.js';
import { establishClassDPartnerEligibility } from './class-d-eligibility.fixture.js';
import { createDeliveryIsolationSources } from './delivery-isolation.fixture.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService;
let runtime: RuntimeDatabaseService;
let scheduler: string;
let deliveryRecorder: string;
let partnerActor: string;
let partnerCompany: string;
let base: any;

async function principal(companyId: string, permissions: string[], prefix: string) {
  const userId = id(); const membershipId = id(); const roleId = id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [userId, `${prefix}-${userId}@receipt-acceptance.test`]);
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membershipId, userId, companyId]);
  await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3)`, [roleId, companyId, `${prefix}-${roleId}`]);
  await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(), companyId, membershipId, roleId]);
  for (const permission of permissions) await owner.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`, [id(), companyId, roleId, permission]);
  return userId;
}

async function deliveryEvent(quantity: number) {
  const po = id(); const poLine = id(); const release = id(); const releaseLine = id(); const allocation = id(); const confirmation = id(); const confirmationEvent = id();
  await owner.query(`INSERT INTO supplier_purchase_orders(id,purchase_source_id,supplier_company_id,currency_code,status,created_by) VALUES($1,$2,$3,$4,'DRAFT',$5)`, [po, base.purchase_source_id, base.supplier_company_id, base.currency_code, scheduler]);
  await owner.query(`INSERT INTO supplier_purchase_order_lines(id,supplier_purchase_order_id,demand_origin,product_identity_id,unit_id,ordered_quantity,actual_unit_purchase_cost,currency_code) VALUES($1,$2,'RELEASED_DEMAND',$3,$4,$5,$6,$7)`, [poLine, po, base.product_identity_id, base.unit_id, quantity, base.unit_purchase_cost, base.currency_code]);
  await owner.query(`INSERT INTO procurement_releases(id,commercial_commitment_id,partner_company_id,total_required,currency_code) VALUES($1,$2,$3,$4,$5)`, [release, base.commercial_commitment_id, partnerCompany, quantity, base.currency_code]);
  await owner.query(`INSERT INTO procurement_release_lines(id,release_id,commercial_commitment_line_id,product_identity_id,released_quantity,unit_id,approved_purchase_cost_snapshot_id,purchase_source_id,supplier_company_id,currency_code,unit_purchase_cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [releaseLine, release, base.commercial_commitment_line_id, base.product_identity_id, quantity, base.unit_id, base.approved_purchase_cost_snapshot_id, base.purchase_source_id, base.supplier_company_id, base.currency_code, base.unit_purchase_cost]);
  await owner.query(`INSERT INTO supplier_po_release_line_allocations(id,supplier_purchase_order_line_id,procurement_release_line_id,allocated_quantity,approved_purchase_cost_snapshot_id,original_purchase_source_id,approved_unit_purchase_cost) VALUES($1,$2,$3,$4,$5,$6,$7)`, [allocation, poLine, releaseLine, quantity, base.approved_purchase_cost_snapshot_id, base.purchase_source_id, base.unit_purchase_cost]);
  await owner.query(`INSERT INTO supplier_po_confirmations(id,supplier_purchase_order_id,created_by) VALUES($1,$2,$3)`, [confirmation, po, scheduler]);
  await owner.query(`INSERT INTO supplier_po_line_confirmation_events(id,supplier_po_confirmation_id,supplier_purchase_order_line_id,confirmed_quantity_delta,promised_delivery_date,actor_user_id) VALUES($1,$2,$3,$4,current_date+30,$5)`, [confirmationEvent, confirmation, poLine, quantity, scheduler]);
  const site = await internal.createPartnerDeliverySite(scheduler, partnerCompany, null, 'Concurrency test receiving site', {}, {}, id());
  const tranche = await internal.createSupplierPODeliveryTranche(scheduler, allocation, site, confirmationEvent, quantity, id());
  await owner.query(`UPDATE supplier_po_delivery_tranches SET status='READY_FOR_DELIVERY' WHERE id=$1`, [tranche]);
  await owner.query(`INSERT INTO supplier_po_line_responsibilities(id,supplier_purchase_order_line_id,actor_user_id,assigned_by) VALUES($1,$2,$3,$4)`, [id(), poLine, deliveryRecorder, scheduler]);
  return internal.recordSupplierPODelivery(deliveryRecorder, tranche, { quantity, deliveredAt: '2031-02-03T04:05:06.000Z', idempotencyKey: id() });
}

describe('Batch 11-B receipt and acceptance concurrency repair', () => {
  beforeAll(async () => {
    internal = new InternalDatabaseService(); runtime = new RuntimeDatabaseService();
    const sco = (await owner.query(`SELECT id FROM "Company" WHERE type='SCO' AND status='ACTIVE' LIMIT 1`)).rows[0].id;
    const [source] = await createDeliveryIsolationSources(owner);
    base = {
      commercial_commitment_line_id: source.commitmentLineId,
      product_identity_id: source.productIdentityId,
      unit_id: source.unitId,
      approved_purchase_cost_snapshot_id: source.approvedPurchaseCostSnapshotId,
      purchase_source_id: source.purchaseSourceId,
      supplier_company_id: source.supplierCompanyId,
      currency_code: source.currencyCode,
      unit_purchase_cost: source.unitPurchaseCost,
      commercial_commitment_id: source.commitmentId,
      partner_company_id: source.partnerCompanyId,
    };
    partnerCompany = source.partnerCompanyId;
    scheduler = await principal(sco, ['supplier_po.delivery_schedule.manage', 'supplier_po.delivery_schedule.read_all'], 'scheduler');
    deliveryRecorder = await principal(sco, ['delivery.execution.record'], 'recorder');
    partnerActor = await principal(partnerCompany, ['delivery.receipt.confirm', 'delivery.acceptance.confirm', 'delivery.issue.record', 'partner_delivery_projection.read'], 'partner');
    await establishClassDPartnerEligibility(owner, partnerActor, partnerCompany);
  });

  afterAll(async () => { await runtime.onModuleDestroy(); await internal.onModuleDestroy(); await owner.end(); });

  it('serializes concurrent receipts: one exact remaining allocation succeeds and one safely rejects without a false audit', async () => {
    const event = await deliveryEvent(10); const correlations = [id(), id()];
    const results = await Promise.allSettled([
      runtime.confirmPartnerDeliveryReceipt(partnerActor, partnerCompany, { deliveryEventId: event, quantity: 6, receivedAt: '2031-02-04T04:05:06.000Z', idempotencyKey: id(), correlationId: correlations[0] }),
      runtime.confirmPartnerDeliveryReceipt(partnerActor, partnerCompany, { deliveryEventId: event, quantity: 6, receivedAt: '2031-02-04T04:05:06.000Z', idempotencyKey: id(), correlationId: correlations[1] }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.message).toContain('PARTNER_DELIVERY_RECEIPT_QUANTITY_EXCEEDED');
    const successfulIndex = results.findIndex((result) => result.status === 'fulfilled');
    const failedIndex = results.findIndex((result) => result.status === 'rejected');
    const total = (await owner.query(`SELECT sum(received_quantity)::numeric AS total FROM partner_delivery_receipt_events WHERE delivery_execution_event_id=$1`, [event])).rows[0].total;
    expect(Number(total)).toBeLessThanOrEqual(10);
    expect((await owner.query(`SELECT action,metadata->>'outcome' AS outcome FROM audit_logs WHERE correlation_id=$1`, [correlations[successfulIndex]])).rows).toEqual([{ action: 'delivery.receipt.confirmed', outcome: 'CONFIRMED' }]);
    expect((await owner.query(`SELECT count(*)::int AS count FROM audit_logs WHERE correlation_id=$1`, [correlations[failedIndex]])).rows[0].count).toBe(0);
  });

  it('serializes concurrent acceptances after receipt without exceeding received quantity', async () => {
    const event = await deliveryEvent(10);
    await runtime.confirmPartnerDeliveryReceipt(partnerActor, partnerCompany, { deliveryEventId: event, quantity: 10, receivedAt: '2031-02-04T04:05:06.000Z', idempotencyKey: id() });
    const results = await Promise.allSettled([
      runtime.confirmPartnerDeliveryAcceptance(partnerActor, partnerCompany, { deliveryEventId: event, quantity: 6, acceptedAt: '2031-02-05T04:05:06.000Z', idempotencyKey: id() }),
      runtime.confirmPartnerDeliveryAcceptance(partnerActor, partnerCompany, { deliveryEventId: event, quantity: 6, acceptedAt: '2031-02-05T04:05:06.000Z', idempotencyKey: id() }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.message).toContain('PARTNER_DELIVERY_ACCEPTANCE_QUANTITY_EXCEEDED');
    expect((await owner.query(`SELECT sum(accepted_quantity)::text AS total FROM partner_delivery_acceptance_events WHERE delivery_execution_event_id=$1`, [event])).rows[0].total).toBe('6.0000');
  });

  it('retains retry, idempotency, safe errors, immutable history, and compatible Partner projection behavior', async () => {
    const event = await deliveryEvent(10); const receiptKey = id();
    const receipt = await runtime.confirmPartnerDeliveryReceipt(partnerActor, partnerCompany, { deliveryEventId: event, quantity: 10, receivedAt: '2031-02-04T04:05:06.000Z', idempotencyKey: receiptKey });
    expect(await runtime.confirmPartnerDeliveryReceipt(partnerActor, partnerCompany, { deliveryEventId: event, quantity: 10, receivedAt: '2031-02-04T04:05:06.000Z', idempotencyKey: receiptKey })).toBe(receipt);
    await expect(runtime.confirmPartnerDeliveryAcceptance(partnerActor, partnerCompany, { deliveryEventId: event, quantity: 11, acceptedAt: '2031-02-05T04:05:06.000Z', idempotencyKey: id() })).rejects.toThrow('PARTNER_DELIVERY_ACCEPTANCE_QUANTITY_EXCEEDED');
    await expect(owner.query(`UPDATE partner_delivery_receipt_events SET received_quantity=9 WHERE id=$1`, [receipt])).rejects.toThrow('PARTNER_DELIVERY_FACT_IMMUTABLE');
    const projection = await runtime.getPartnerDeliveryProjection(partnerActor, partnerCompany);
    expect(projection.some((row) => row.delivered_quantity === '10.0000' && row.received_quantity === '10.0000')).toBe(true);
    expect((await owner.query(`SELECT count(*)::int AS count FROM partner_delivery_receipt_events WHERE id=$1`, [receipt])).rows[0].count).toBe(1);
  });
});