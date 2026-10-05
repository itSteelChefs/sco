import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';
import { RuntimeDatabaseService } from '../../src/database/runtime-database.service.js';
import { establishClassDPartnerEligibility } from './class-d-eligibility.fixture.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService;
let runtime: RuntimeDatabaseService;
let base: any;
let partnerCompany: string;
let creator: string;
let partnerActor: string;
let otherPartnerCompany: string;
let otherPartnerActor: string;
let deniedActor: string;

async function principal(companyId: string, permissions: string[], prefix: string) {
  const userId = id(); const membershipId = id(); const roleId = id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [userId, `${prefix}-${userId}@warranty.test`]);
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membershipId, userId, companyId]);
  await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3)`, [roleId, companyId, `${prefix}-${roleId}`]);
  await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(), companyId, membershipId, roleId]);
  for (const permission of permissions) await owner.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`, [id(), companyId, roleId, permission]);
  return userId;
}

async function deliveryEvent(quantity = 10) {
  const po = id(); const poLine = id(); const release = id(); const releaseLine = id(); const allocation = id(); const confirmation = id(); const confirmationEvent = id();
  await owner.query(`INSERT INTO supplier_purchase_orders(id,purchase_source_id,supplier_company_id,currency_code,status,created_by) VALUES($1,$2,$3,$4,'DRAFT',$5)`, [po, base.purchase_source_id, base.supplier_company_id, base.currency_code, creator]);
  await owner.query(`INSERT INTO supplier_purchase_order_lines(id,supplier_purchase_order_id,demand_origin,product_identity_id,unit_id,ordered_quantity,actual_unit_purchase_cost,currency_code) VALUES($1,$2,'RELEASED_DEMAND',$3,$4,$5,$6,$7)`, [poLine, po, base.product_identity_id, base.unit_id, quantity, base.unit_purchase_cost, base.currency_code]);
  await owner.query(`INSERT INTO procurement_releases(id,commercial_commitment_id,partner_company_id,total_required,currency_code) VALUES($1,$2,$3,$4,$5)`, [release, base.commercial_commitment_id, partnerCompany, quantity, base.currency_code]);
  await owner.query(`INSERT INTO procurement_release_lines(id,release_id,commercial_commitment_line_id,product_identity_id,released_quantity,unit_id,approved_purchase_cost_snapshot_id,purchase_source_id,supplier_company_id,currency_code,unit_purchase_cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [releaseLine, release, base.commercial_commitment_line_id, base.product_identity_id, quantity, base.unit_id, base.approved_purchase_cost_snapshot_id, base.purchase_source_id, base.supplier_company_id, base.currency_code, base.unit_purchase_cost]);
  await owner.query(`INSERT INTO supplier_po_release_line_allocations(id,supplier_purchase_order_line_id,procurement_release_line_id,allocated_quantity,approved_purchase_cost_snapshot_id,original_purchase_source_id,approved_unit_purchase_cost) VALUES($1,$2,$3,$4,$5,$6,$7)`, [allocation, poLine, releaseLine, quantity, base.approved_purchase_cost_snapshot_id, base.purchase_source_id, base.unit_purchase_cost]);
  await owner.query(`INSERT INTO supplier_po_confirmations(id,supplier_purchase_order_id,created_by) VALUES($1,$2,$3)`, [confirmation, po, creator]);
  await owner.query(`INSERT INTO supplier_po_line_confirmation_events(id,supplier_po_confirmation_id,supplier_purchase_order_line_id,confirmed_quantity_delta,promised_delivery_date,actor_user_id) VALUES($1,$2,$3,$4,current_date+30,$5)`, [confirmationEvent, confirmation, poLine, quantity, creator]);
  await owner.query(`INSERT INTO supplier_po_line_responsibilities(id,supplier_purchase_order_line_id,actor_user_id,assigned_by) VALUES($1,$2,$3,$4)`, [id(), poLine, creator, creator]);
  const site = await internal.createPartnerDeliverySite(creator, partnerCompany, null, `Warranty receiving ${id()}`, {}, {}, id());
  const tranche = await internal.createSupplierPODeliveryTranche(creator, allocation, site, confirmationEvent, quantity, id());
  await owner.query(`UPDATE supplier_po_delivery_tranches SET status='READY_FOR_DELIVERY' WHERE id=$1`, [tranche]);
  return internal.recordSupplierPODelivery(creator, tranche, { quantity, deliveredAt: '2031-02-03T04:05:06.000Z', idempotencyKey: id() });
}

async function evidence() {
  const documentId = id(); const versionId = id();
  await owner.query(`INSERT INTO documents(id,company_id,uploader_user_id,filename,detected_mime_type,byte_size,storage_key,sha256,status,access_scope) VALUES($1,$2,$3,'warranty.pdf','application/pdf',100,$4,'sha','AVAILABLE','TENANT')`, [documentId, partnerCompany, partnerActor, `warranty/${documentId}`]);
  await owner.query(`INSERT INTO document_versions(id,company_id,document_id,version,storage_key,sha256) VALUES($1,$2,$3,1,$4,'sha')`, [versionId, partnerCompany, documentId, `warranty/${versionId}`]);
  return { documentId, versionId };
}

function input(event: string, overrides: Record<string, unknown> = {}) {
  return { deliveryEventId: event, coveredQuantity: 10, startTrigger: 'DELIVERY' as const, startDate: '2031-02-03', endDate: '2032-02-03', providerType: 'SUPPLIER' as const, providerCompanyId: base.supplier_company_id, idempotencyKey: id(), ...overrides };
}

describe('Batch 11-C warranty entitlement foundation', () => {
  beforeAll(async () => {
    internal = new InternalDatabaseService(); runtime = new RuntimeDatabaseService();
    base = (await owner.query(`SELECT rl.commercial_commitment_line_id,rl.product_identity_id,rl.unit_id,rl.approved_purchase_cost_snapshot_id,rl.purchase_source_id,rl.supplier_company_id,rl.currency_code,rl.unit_purchase_cost,r.commercial_commitment_id,r.partner_company_id FROM procurement_release_lines rl JOIN procurement_releases r ON r.id=rl.release_id WHERE rl.released_quantity>=10 ORDER BY rl.created_at DESC LIMIT 1`)).rows[0];
    if (!base) throw new Error('no deterministic warranty fixture source');
    partnerCompany = base.partner_company_id;
    const sco = (await owner.query(`SELECT id FROM "Company" WHERE type='SCO' AND status='ACTIVE' LIMIT 1`)).rows[0].id;
    creator = await principal(sco, ['supplier_po.delivery_schedule.manage', 'delivery.execution.record', 'warranty.entitlement.register', 'warranty.entitlement.read_assigned'], 'warranty-internal');
    partnerActor = await principal(partnerCompany, ['warranty.entitlement.read', 'delivery.receipt.confirm', 'delivery.acceptance.confirm'], 'warranty-partner');
    await establishClassDPartnerEligibility(owner, partnerActor, partnerCompany);
    const otherPartner = (await owner.query(`SELECT id FROM "Company" WHERE type='PARTNER' AND status='ACTIVE' AND id<>$1 LIMIT 1`, [partnerCompany])).rows[0];
    otherPartnerCompany = otherPartner?.id ?? id();
    if (!otherPartner) await owner.query(`INSERT INTO "Company"(id,name,type) VALUES($1,'Warranty Partner B','PARTNER')`, [otherPartnerCompany]);
    otherPartnerActor = await principal(otherPartnerCompany, ['warranty.entitlement.read'], 'warranty-other-partner');
    deniedActor = await principal(sco, [], 'warranty-denied');
  });

  afterAll(async () => { await runtime.onModuleDestroy(); await internal.onModuleDestroy(); await owner.end(); });

  it('registers immutable delivery-based entitlement with private evidence and a Partner-safe projection', async () => {
    const event = await deliveryEvent(); const document = await evidence();
    const entitlement = await internal.registerWarrantyEntitlement(creator, input(event, { evidenceDocumentId: document.documentId, evidenceVersionId: document.versionId }));
    const internalView: any = await internal.getWarrantyEntitlement(creator, entitlement);
    expect(internalView).toMatchObject({ id: entitlement, product_identity_id: base.product_identity_id, start_trigger: 'DELIVERY', evidence_document_id: document.documentId });
    const projection: any[] = await runtime.getPartnerWarrantyEntitlements(partnerActor, partnerCompany);
    expect(projection.find((row) => row.id === entitlement)).toMatchObject({ product_identity_id: base.product_identity_id, covered_quantity: '10.0000', status: 'ACTIVE', evidence_count: 1 });
    expect(Object.keys(projection.find((row) => row.id === entitlement))).not.toEqual(expect.arrayContaining(['supplier_purchase_order_id', 'purchase_source_id', 'purchase_cost', 'margin', 'provider_reference']));
    const files: any[] = await runtime.getPartnerWarrantyEntitlementEvidence(partnerActor, partnerCompany, entitlement);
    expect(files).toEqual([expect.objectContaining({ document_id: document.documentId, document_version_id: document.versionId, filename: 'warranty.pdf' })]);
    expect(Object.keys(files[0])).not.toContain('storage_key');
    expect((await runtime.getPartnerWarrantyEntitlements(otherPartnerActor, otherPartnerCompany) as any[]).some((row) => row.id === entitlement)).toBe(false);
    expect(await runtime.getPartnerWarrantyEntitlementEvidence(otherPartnerActor, otherPartnerCompany, entitlement)).toEqual([]);
    await expect(owner.query(`UPDATE warranty_entitlements SET end_date='2033-02-03' WHERE id=$1`, [entitlement])).rejects.toThrow('WARRANTY_ENTITLEMENT_IMMUTABLE');
    await expect(owner.query(`DELETE FROM warranty_entitlement_evidence WHERE warranty_entitlement_id=$1`, [entitlement])).rejects.toThrow('WARRANTY_ENTITLEMENT_IMMUTABLE');
  });

  it('requires scoped internal authority and keeps Partner and supplier actors from registering', async () => {
    const event = await deliveryEvent();
    await expect(internal.registerWarrantyEntitlement(deniedActor, input(event))).rejects.toThrow('WARRANTY_ENTITLEMENT_FORBIDDEN');
    await expect(internal.registerWarrantyEntitlement(partnerActor, input(event))).rejects.toThrow('WARRANTY_ENTITLEMENT_FORBIDDEN');
    const supplierActor = await principal(base.supplier_company_id, [], 'warranty-supplier');
    await expect(internal.registerWarrantyEntitlement(supplierActor, input(event))).rejects.toThrow('WARRANTY_ENTITLEMENT_FORBIDDEN');
  });

  it('validates receipt and acceptance lineage, explicit dates, and external trigger provenance', async () => {
    const receiptEvent = await deliveryEvent(); const receiptId = await runtime.confirmPartnerDeliveryReceipt(partnerActor, partnerCompany, { deliveryEventId: receiptEvent, quantity: 10, receivedAt: '2031-02-04T04:05:06.000Z', idempotencyKey: id() });
    const receiptEntitlement = await internal.registerWarrantyEntitlement(creator, input(receiptEvent, { startTrigger: 'RECEIPT', startDate: '2031-02-04', receiptEventId: receiptId }));
    expect(receiptEntitlement).toEqual(expect.any(String));
    const acceptanceEvent = await deliveryEvent(); const acceptedReceipt = await runtime.confirmPartnerDeliveryReceipt(partnerActor, partnerCompany, { deliveryEventId: acceptanceEvent, quantity: 10, receivedAt: '2031-02-04T04:05:06.000Z', idempotencyKey: id() });
    const acceptanceId = await runtime.confirmPartnerDeliveryAcceptance(partnerActor, partnerCompany, { deliveryEventId: acceptanceEvent, quantity: 10, acceptedAt: '2031-02-05T04:05:06.000Z', idempotencyKey: id() });
    expect(await internal.registerWarrantyEntitlement(creator, input(acceptanceEvent, { startTrigger: 'ACCEPTANCE', startDate: '2031-02-05', acceptanceEventId: acceptanceId }))).toEqual(expect.any(String));
    await expect(internal.registerWarrantyEntitlement(creator, input(acceptanceEvent, { startTrigger: 'RECEIPT', startDate: '2031-02-05', receiptEventId: acceptedReceipt }))).rejects.toThrow('WARRANTY_ENTITLEMENT_REFERENCE_INVALID');
    await expect(internal.registerWarrantyEntitlement(creator, input(await deliveryEvent(), { startTrigger: 'RECEIPT', startDate: '2031-02-04', receiptEventId: acceptedReceipt }))).rejects.toThrow('WARRANTY_ENTITLEMENT_REFERENCE_INVALID');
    const externalEvent = await deliveryEvent();
    expect(await internal.registerWarrantyEntitlement(creator, input(externalEvent, { startTrigger: 'INSTALLATION', startDate: '2031-02-10', startReference: 'installation-provider-reference', coveredQuantity: 5 }))).toEqual(expect.any(String));
    await expect(internal.registerWarrantyEntitlement(creator, input(await deliveryEvent(), { startTrigger: 'CONTRACTUAL', startDate: '2031-02-10', startReference: '' }))).rejects.toThrow('WARRANTY_ENTITLEMENT_REFERENCE_INVALID');
  });

  it('enforces deterministic dates, quantity coverage, idempotency, concurrency, and derived expiry', async () => {
    await expect(internal.registerWarrantyEntitlement(creator, input(await deliveryEvent(), { endDate: '2031-02-03' }))).rejects.toThrow('WARRANTY_ENTITLEMENT_INVALID');
    const retryEvent = await deliveryEvent(); const retryInput = input(retryEvent); const first = await internal.registerWarrantyEntitlement(creator, retryInput);
    expect(await internal.registerWarrantyEntitlement(creator, retryInput)).toBe(first);
    await expect(internal.registerWarrantyEntitlement(creator, { ...retryInput, endDate: '2033-02-03' })).rejects.toThrow('WARRANTY_ENTITLEMENT_IDEMPOTENCY_CONFLICT');
    const raceEvent = await deliveryEvent();
    const race = await Promise.allSettled([internal.registerWarrantyEntitlement(creator, input(raceEvent, { coveredQuantity: 6 })), internal.registerWarrantyEntitlement(creator, input(raceEvent, { coveredQuantity: 6 }))]);
    expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((race.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.message).toContain('WARRANTY_ENTITLEMENT_QUANTITY_EXCEEDED');
    const expired = await internal.registerWarrantyEntitlement(creator, input(await deliveryEvent(), { startTrigger: 'PROVIDER_DEFINED', startDate: '2020-01-01', endDate: '2021-01-01', startReference: 'provider-certificate', coveredQuantity: 1 }));
    expect((await runtime.getPartnerWarrantyEntitlements(partnerActor, partnerCompany) as any[]).find((row) => row.id === expired)?.status).toBe('EXPIRED');
  });

  it('enforces safe tenant/actor boundaries, gateway ACLs, audit, RLS, and domain isolation', async () => {
    const event = await deliveryEvent(); const correlation = id();
    const before = await owner.query(`SELECT (SELECT count(*)::int FROM commercial_commitments) commitments,(SELECT count(*)::int FROM procurement_releases) releases,(SELECT count(*)::int FROM supplier_po_coverage_bindings) coverage,(SELECT count(*)::int FROM supplier_purchase_orders) pos,(SELECT count(*)::int FROM partner_delivery_receipt_events) receipts,(SELECT count(*)::int FROM partner_delivery_acceptance_events) acceptances,(SELECT count(*)::int FROM partner_delivery_discrepancy_events) discrepancies`);
    await expect(internal.registerWarrantyEntitlement(creator, input(event, { correlationId: correlation, coveredQuantity: 11 }))).rejects.toThrow('WARRANTY_ENTITLEMENT_QUANTITY_EXCEEDED');
    expect((await owner.query(`SELECT count(*)::int count FROM audit_logs WHERE correlation_id=$1`, [correlation])).rows[0].count).toBe(0);
    const entitlement = await internal.registerWarrantyEntitlement(creator, input(event));
    expect((await owner.query(`SELECT action,metadata->>'outcome' outcome FROM audit_logs WHERE entity_id=$1`, [entitlement])).rows[0]).toEqual({ action: 'warranty.entitlement.registered', outcome: 'REGISTERED' });
    const after = await owner.query(`SELECT (SELECT count(*)::int FROM commercial_commitments) commitments,(SELECT count(*)::int FROM procurement_releases) releases,(SELECT count(*)::int FROM supplier_po_coverage_bindings) coverage,(SELECT count(*)::int FROM supplier_purchase_orders) pos,(SELECT count(*)::int FROM partner_delivery_receipt_events) receipts,(SELECT count(*)::int FROM partner_delivery_acceptance_events) acceptances,(SELECT count(*)::int FROM partner_delivery_discrepancy_events) discrepancies`);
    expect(after.rows[0]).toEqual(before.rows[0]);
    const tables = await owner.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN('warranty_entitlements','warranty_entitlement_evidence')`);
    expect(tables.rows).toHaveLength(2); expect(tables.rows.every((row: any) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const grants = await owner.query(`SELECT has_table_privilege('sco_runtime','public.warranty_entitlements','SELECT') runtime_select,has_function_privilege('public','public.internal_warranty_entitlement_register(uuid,uuid,numeric,"WarrantyStartTrigger",date,uuid,uuid,text,date,"WarrantyProviderType",uuid,text,uuid,uuid,text,text)','EXECUTE') public_register,has_function_privilege('sco_runtime','public.internal_warranty_entitlement_register(uuid,uuid,numeric,"WarrantyStartTrigger",date,uuid,uuid,text,date,"WarrantyProviderType",uuid,text,uuid,uuid,text,text)','EXECUTE') runtime_register`);
    expect(grants.rows[0]).toEqual({ runtime_select: false, public_register: false, runtime_register: false });
    const functions = await owner.query(`SELECT prosecdef,proconfig FROM pg_proc WHERE oid='public.internal_warranty_entitlement_register(uuid,uuid,numeric,"WarrantyStartTrigger",date,uuid,uuid,text,date,"WarrantyProviderType",uuid,text,uuid,uuid,text,text)'::regprocedure`);
    expect(functions.rows[0].prosecdef).toBe(true); expect(functions.rows[0].proconfig).toContain('search_path=pg_catalog, public');
    const partnerGateway = await owner.query(`SELECT has_function_privilege('public','public.partner_warranty_entitlement_list(uuid,uuid)','EXECUTE') public_list,has_function_privilege('sco_internal_executor','public.partner_warranty_entitlement_list(uuid,uuid)','EXECUTE') internal_list,has_function_privilege('sco_runtime','public.partner_warranty_entitlement_list(uuid,uuid)','EXECUTE') runtime_list,prosecdef,proconfig FROM pg_proc WHERE oid='public.partner_warranty_entitlement_list(uuid,uuid)'::regprocedure`);
    expect(partnerGateway.rows[0]).toMatchObject({ public_list: false, internal_list: false, runtime_list: true, prosecdef: true });
    expect(partnerGateway.rows[0].proconfig).toContain('search_path=pg_catalog, public');
    const runtimeClient = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); await runtimeClient.connect();
    try { await expect(runtimeClient.query(`SELECT public.internal_warranty_entitlement_register($1,$2,$3,'DELIVERY',$4,NULL,NULL,NULL,$5,'SUPPLIER',$6,NULL,NULL,NULL,$7,NULL)`, [creator, event, 1, '2031-02-03', '2032-02-03', base.supplier_company_id, id()])).rejects.toThrow(/permission denied/i); } finally { await runtimeClient.end(); }
    await owner.query('BEGIN');
    try {
      await owner.query(`SELECT set_config('app.actor_id',$1,true),set_config('app.sco_internal','true',true)`, [deniedActor]);
      await expect(owner.query(`SELECT public.internal_warranty_entitlement_register($1,$2,1,'DELIVERY','2031-02-03',NULL,NULL,NULL,'2032-02-03','SUPPLIER',$3,NULL,NULL,NULL,$4,NULL)`, [creator, event, base.supplier_company_id, id()])).rejects.toThrow('WARRANTY_ENTITLEMENT_FORBIDDEN');
    } finally { await owner.query('ROLLBACK'); }
  });
});