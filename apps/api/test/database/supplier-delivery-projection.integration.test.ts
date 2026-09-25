import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';
import { RuntimeDatabaseService } from '../../src/database/runtime-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService;
let runtime: RuntimeDatabaseService;
let scoActor: string;
let readAllActor: string;
let assignedActor: string;
let wrongScopeActor: string;
let lineResponsibilityActor: string;
let partnerAActor: string;
let partnerBActor: string;
let dualActor: string;
let supplierActor: string;
let poId: string;
let trancheA: string;
let trancheB: string;
let partnerA: string;
let partnerB: string;
let supplier: string;
let commitmentA: string;
let commitmentB: string;
let source: string;
let lineA: string;
let lineB: string;

async function principal(companyId: string, permissions: string[], emailPrefix: string) {
  const user = id();
  const membership = id();
  const role = id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [user, `${emailPrefix}-${user}@delivery-b.test`]);
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membership, user, companyId]);
  await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3)`, [role, companyId, `${emailPrefix}-${role}`]);
  await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(), companyId, membership, role]);
  for (const permission of permissions) {
    await owner.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`, [id(), companyId, role, permission]);
  }
  return user;
}

async function createMultiPartnerFixture() {
  const rows = (await owner.query(`
    SELECT rl.commercial_commitment_line_id, rl.product_identity_id, rl.unit_id,
           rl.approved_purchase_cost_snapshot_id, rl.purchase_source_id,
           rl.supplier_company_id, rl.currency_code, rl.unit_purchase_cost,
           r.commercial_commitment_id, r.partner_company_id,
           cc.id commitment_id, pi.category_id
    FROM procurement_release_lines rl
    JOIN procurement_releases r ON r.id=rl.release_id
    JOIN commercial_commitments cc ON cc.id=r.commercial_commitment_id
    JOIN product_identities pi ON pi.id=rl.product_identity_id
    WHERE rl.released_quantity>=20
    ORDER BY rl.created_at DESC
    LIMIT 250
  `)).rows;
  let first: any;
  let second: any;
  for (const row of rows) {
    if (!first) { first = row; continue; }
    if (row.partner_company_id !== first.partner_company_id) { second = row; break; }
  }
  if (!first || !second) throw new Error('no deterministic multi-partner source fixture');
  partnerA = first.partner_company_id;
  partnerB = second.partner_company_id;
  source = first.purchase_source_id;
  supplier = first.supplier_company_id;
  commitmentA = first.commitment_id;
  commitmentB = second.commitment_id;
  const po = id();
  poId = po;
  const poLineA = id();
  const poLineB = id();
  lineA = id();
  lineB = id();
  const releaseA = id();
  const releaseB = id();
  const allocationA = id();
  const allocationB = id();
  const confirmationA = id();
  const eventA = id();
  const eventB = id();
  await owner.query(`INSERT INTO supplier_purchase_orders(id,purchase_source_id,supplier_company_id,currency_code,status,created_by) VALUES($1,$2,$3,$4,'DRAFT',$5)`, [po, source, supplier, first.currency_code, scoActor]);
  await owner.query(`INSERT INTO supplier_purchase_order_lines(id,supplier_purchase_order_id,demand_origin,product_identity_id,unit_id,ordered_quantity,actual_unit_purchase_cost,currency_code) VALUES($1,$2,'RELEASED_DEMAND',$3,$4,20,$5,$6),($7,$2,'RELEASED_DEMAND',$8,$9,20,$10,$6)`, [poLineA, po, first.product_identity_id, first.unit_id, first.unit_purchase_cost, first.currency_code, poLineB, second.product_identity_id, second.unit_id, second.unit_purchase_cost]);
  await owner.query(`INSERT INTO procurement_releases(id,commercial_commitment_id,partner_company_id,total_required,currency_code) VALUES($1,$2,$3,20,$4),($5,$6,$7,20,$4)`, [releaseA, commitmentA, partnerA, first.currency_code, releaseB, commitmentB, partnerB]);
  await owner.query(`INSERT INTO procurement_release_lines(id,release_id,commercial_commitment_line_id,product_identity_id,released_quantity,unit_id,approved_purchase_cost_snapshot_id,purchase_source_id,supplier_company_id,currency_code,unit_purchase_cost) VALUES($1,$2,$3,$4,20,$5,$6,$7,$8,$9,$10),($11,$12,$13,$14,20,$15,$16,$17,$18,$19,$20)`, [lineA, releaseA, first.commercial_commitment_line_id, first.product_identity_id, first.unit_id, first.approved_purchase_cost_snapshot_id, first.purchase_source_id, first.supplier_company_id, first.currency_code, first.unit_purchase_cost, lineB, releaseB, second.commercial_commitment_line_id, second.product_identity_id, second.unit_id, second.approved_purchase_cost_snapshot_id, second.purchase_source_id, second.supplier_company_id, second.currency_code, second.unit_purchase_cost]);
  await owner.query(`INSERT INTO supplier_po_release_line_allocations(id,supplier_purchase_order_line_id,procurement_release_line_id,allocated_quantity,approved_purchase_cost_snapshot_id,original_purchase_source_id,approved_unit_purchase_cost) VALUES($1,$2,$3,20,$4,$5,$6),($7,$8,$9,20,$10,$11,$12)`, [allocationA, poLineA, lineA, first.approved_purchase_cost_snapshot_id, source, first.unit_purchase_cost, allocationB, poLineB, lineB, second.approved_purchase_cost_snapshot_id, source, second.unit_purchase_cost]);
  await owner.query(`INSERT INTO supplier_po_confirmations(id,supplier_purchase_order_id,created_by) VALUES($1,$2,$3)`, [confirmationA, po, scoActor]);
  await owner.query(`INSERT INTO supplier_po_line_confirmation_events(id,supplier_po_confirmation_id,supplier_purchase_order_line_id,confirmed_quantity_delta,promised_delivery_date,actor_user_id) VALUES($1,$2,$3,20,current_date+20,$4),($5,$2,$6,20,current_date+25,$4)`, [eventA, confirmationA, poLineA, scoActor, eventB, poLineB]);
  const siteA = await internal.createPartnerDeliverySite(scoActor, partnerA, null, 'Partner A Gate', { city: 'A-City', street: 'A-Street' }, { name: 'A Receiver' }, id());
  const siteB = await internal.createPartnerDeliverySite(scoActor, partnerB, null, 'Partner B Gate', { city: 'B-City', street: 'B-Street' }, { name: 'B Receiver' }, id());
  trancheA = await internal.createSupplierPODeliveryTranche(scoActor, allocationA, siteA, eventA, 20, id());
  trancheB = await internal.createSupplierPODeliveryTranche(scoActor, allocationB, siteB, eventB, 20, id());
  return { allocationA, allocationB, poLineA, poLineB, eventA, eventB, siteA, siteB, categoryA: first.category_id, categoryB: second.category_id };
}

describe('Batch 9.6.4-B delivery projections and disclosure boundaries', () => {
  let fixture: any;
  beforeAll(async () => {
    internal = new InternalDatabaseService();
    runtime = new RuntimeDatabaseService();
    const sco = (await owner.query(`SELECT id FROM "Company" WHERE type='SCO' LIMIT 1`)).rows[0].id;
    scoActor = await principal(sco, ['supplier_po.delivery_schedule.manage', 'supplier_po.delivery_schedule.read_all'], 'b-sco');
    fixture = await createMultiPartnerFixture();
    readAllActor = await principal(sco, ['supplier_po.delivery_schedule.read_all'], 'b-read-all');
    assignedActor = await principal(sco, ['supplier_po.delivery_schedule.read_assigned'], 'b-assigned');
    wrongScopeActor = await principal(sco, ['supplier_po.delivery_schedule.read_assigned'], 'b-wrong');
    lineResponsibilityActor = await principal(sco, ['supplier_po.delivery_schedule.read_assigned'], 'b-line');
    await owner.query(`INSERT INTO supplier_po_line_responsibilities(id,supplier_purchase_order_line_id,actor_user_id,assigned_by) VALUES($1,$2,$3,$4)`, [id(), fixture.poLineB, lineResponsibilityActor, scoActor]);
    await owner.query(`INSERT INTO procurement_engineer_scope_assignments(id,actor_user_id,purchase_source_id,product_category_id,status,assigned_by) VALUES($1,$2,$3,$4,'ACTIVE',$5)`, [id(), assignedActor, source, fixture.categoryA, scoActor]);
    const otherSource = (await owner.query(`SELECT id FROM purchase_sources WHERE id<>$1 LIMIT 1`, [source])).rows[0]?.id;
    const otherCategory = (await owner.query(`SELECT id FROM product_categories WHERE id<>$1 LIMIT 1`, [fixture.categoryA])).rows[0]?.id;
    if (otherSource && otherCategory) await owner.query(`INSERT INTO procurement_engineer_scope_assignments(id,actor_user_id,purchase_source_id,product_category_id,status,assigned_by) VALUES($1,$2,$3,$4,'ACTIVE',$5)`, [id(), wrongScopeActor, otherSource, otherCategory, scoActor]);
    partnerAActor = await principal(partnerA, ['partner_delivery_projection.read'], 'b-partner-a');
    partnerBActor = await principal(partnerB, ['partner_delivery_projection.read'], 'b-partner-b');
    dualActor = await principal(partnerA, ['partner_delivery_projection.read'], 'b-dual');
    const dualMembership = id();
    await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [dualMembership, dualActor, supplier]);
    const dualRole = id();
    await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3),($4,$5,$6,$6)`, [dualRole, supplier, `b-dual-supplier-${dualRole}`, id(), partnerA, `b-dual-partner-${dualRole}`]);
    await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(), supplier, dualMembership, dualRole]);
    await owner.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code='supplier_po.delivery_schedule.read_assigned'`, [id(), supplier, dualRole]);
    supplierActor = await principal(supplier, ['supplier_po.delivery_schedule.read_assigned'], 'b-supplier');
  });
  afterAll(async () => { await internal.onModuleDestroy(); await runtime.onModuleDestroy(); await owner.end(); });

  it('read_all sees the complete internal delivery view while read_assigned is line-scoped', async () => {
    const all = await internal.listSupplierPODeliverySchedule(readAllActor, poId);
    expect(all).toHaveLength(2);
    expect(all.map((row) => row.tranche_id)).toEqual(expect.arrayContaining([trancheA, trancheB]));
    const internalKeys = Object.keys(all[0]);
    expect(internalKeys).not.toEqual(expect.arrayContaining(['purchase_cost', 'selling_price', 'margin', 'payment_terms', 'storage_key', 'supplier_payment_schedule', 'commercial_document_id']));
    const assigned = await internal.listSupplierPODeliverySchedule(assignedActor, poId);
    expect(assigned).toHaveLength(1);
    expect(assigned[0].tranche_id).toBe(trancheA);
    expect(assigned[0]).toHaveProperty('purchase_source_id', source);
    expect(assigned[0]).toHaveProperty('delivery_alias');
    const lineOnly = await internal.listSupplierPODeliverySchedule(lineResponsibilityActor, poId);
    expect(lineOnly).toHaveLength(1);
    expect(lineOnly[0].tranche_id).toBe(trancheB);
  });

  it('denies wrong source/category scope and does not grant manage users read access', async () => {
    expect(await internal.listSupplierPODeliverySchedule(wrongScopeActor, poId)).toEqual([]);
    const manageOnly = await principal((await owner.query(`SELECT id FROM "Company" WHERE type='SCO' LIMIT 1`)).rows[0].id, ['supplier_po.lead.manage'], 'b-lead-only');
    expect(await internal.listSupplierPODeliverySchedule(manageOnly, poId)).toEqual([]);
    const manageOnlyDelivery = await principal((await owner.query(`SELECT id FROM "Company" WHERE type='SCO' LIMIT 1`)).rows[0].id, ['supplier_po.delivery_schedule.manage'], 'b-manage-delivery-only');
    expect(await internal.listSupplierPODeliverySchedule(manageOnlyDelivery, poId)).toEqual([]);
  });

  it('projects only Partner A or Partner B from their own commercial commitment', async () => {
    const a = await runtime.getPartnerDeliveryProjection(partnerAActor, partnerA, commitmentA);
    const b = await runtime.getPartnerDeliveryProjection(partnerBActor, partnerB, commitmentB);
    expect(a.some((row) => row.tranche_id === trancheA)).toBe(true);
    expect(b.some((row) => row.tranche_id === trancheB)).toBe(true);
    expect(a.every((row) => row.tranche_id !== trancheB)).toBe(true);
    expect(b.every((row) => row.tranche_id !== trancheA)).toBe(true);
    const forbiddenPartnerFields = ['supplier_purchase_order_id','purchase_order_id','purchase_source_id','supplier_company_id','supplier_identity','supplier_payment_terms','payment_schedule','purchase_cost','margin','selling_price','internal_notes','negotiation_notes','storage_key','supplier_confirmation_id','aggregate_quantity','other_partner_quantity'];
    for (const row of a) for (const field of forbiddenPartnerFields) expect(row).not.toHaveProperty(field);
    expect(a.find((row) => row.tranche_id === trancheA).site_label).toBe('Partner A Gate');
    expect(b.find((row) => row.tranche_id === trancheB).site_label).toBe('Partner B Gate');
  });

  it('rejects cross-tenant, tenant-spoofed and dual-role projection access', async () => {
    expect(await runtime.getPartnerDeliveryProjection(partnerAActor, partnerB, commitmentB)).toEqual([]);
    expect(await runtime.getPartnerDeliveryProjection(partnerBActor, partnerA, commitmentA)).toEqual([]);
    expect(await runtime.getPartnerDeliveryProjection(partnerAActor, partnerA, commitmentB)).toEqual([]);
    const dual = await runtime.getPartnerDeliveryProjection(dualActor, partnerA, commitmentA);
    expect(dual.some((row) => row.tranche_id === trancheA)).toBe(true);
    expect(dual.every((row) => row.tranche_id !== trancheB)).toBe(true);
  });

  it('derives current expected date from immutable tranche history without mutating confirmation', async () => {
    const before = (await owner.query(`SELECT confirmed_quantity_delta,promised_delivery_date FROM supplier_po_line_confirmation_events WHERE id=$1`, [fixture.eventA])).rows[0];
    const beforeProjection = await runtime.getPartnerDeliveryProjection(partnerAActor, partnerA, commitmentA);
    const original = beforeProjection.find((row) => row.tranche_id === trancheA).original_promised_date;
    await internal.changeSupplierPODeliveryTrancheDate(scoActor, trancheA, original, '2031-01-02', 'B delay', id());
    const after = (await runtime.getPartnerDeliveryProjection(partnerAActor, partnerA, commitmentA)).find((row) => row.tranche_id === trancheA);
    expect(new Date(after.original_promised_date).toISOString()).toBe(new Date(original).toISOString());
    expect(new Date(after.current_expected_date).toISOString()).toBe('2031-01-02T00:00:00.000Z');
    expect(after.date_changed).toBe(true);
    expect((await owner.query(`SELECT confirmed_quantity_delta,promised_delivery_date FROM supplier_po_line_confirmation_events WHERE id=$1`, [fixture.eventA])).rows[0]).toEqual(before);
  });

  it('returns minimum supplier disclosure before READY and location/contact only at READY', async () => {
    const before = await runtime.getSupplierDeliveryDisclosure(supplierActor, supplier, trancheA);
    expect(before).toMatchObject({ tranche_id: trancheA, destination_alias: expect.stringMatching(/^SCO-DST-/), quantity: '20.0000' });
    expect(before.location_details).toBeNull();
    expect(before.receiving_contact).toBeNull();
    expect(before).not.toHaveProperty('partner_company_id');
    expect(before).not.toHaveProperty('supplier_purchase_order_id');
    expect(before).not.toHaveProperty('partner_company_id');
    expect(before).not.toHaveProperty('partner_name');
    expect(before).not.toHaveProperty('payment_terms');
    expect(before).not.toHaveProperty('purchase_cost');
    expect(before).not.toHaveProperty('margin');
    expect(Object.keys(before).sort()).toEqual(['date_changed','destination_alias','expected_date','location_details','product_identity_id','quantity','receiving_contact','tranche_id','tranche_status'].sort());
    await owner.query(`UPDATE supplier_po_delivery_tranches SET status='READY_FOR_DELIVERY' WHERE id=$1`, [trancheA]);
    const ready = await runtime.getSupplierDeliveryDisclosure(supplierActor, supplier, trancheA);
    expect(ready.location_details).toEqual({ city: 'A-City', street: 'A-Street' });
    expect(ready.receiving_contact).toEqual({ name: 'A Receiver' });
    expect(ready).not.toHaveProperty('partner_company_id');
    expect(ready).not.toHaveProperty('partner_name');
    expect(ready).not.toHaveProperty('payment_terms');
    expect(ready).not.toHaveProperty('purchase_cost');
    expect(ready).not.toHaveProperty('margin');
  });

  it('keeps aliases non-authoritative and blocks direct Partner/runtime access to internal tables', async () => {
    const runtimeClient = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
    await runtimeClient.connect();
    try {
      await expect(runtimeClient.query(`SELECT * FROM supplier_po_delivery_tranches WHERE id=$1`, [trancheA])).rejects.toThrow(/permission denied/i);
      await expect(runtimeClient.query(`SELECT * FROM partner_delivery_sites WHERE delivery_alias=(SELECT delivery_alias FROM partner_delivery_sites LIMIT 1)`)).rejects.toThrow(/permission denied/i);
      await expect(runtimeClient.query(`SELECT public.partner_delivery_projection_list($1,$2,$3)`, [partnerAActor, partnerB, commitmentB])).resolves.toBeTruthy();
      await runtimeClient.query('BEGIN');
      await runtimeClient.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true),set_config('app.sco_internal','true',true)", [partnerB, partnerAActor]);
      expect((await runtimeClient.query(`SELECT * FROM public.partner_delivery_projection_list($1,$2,$3)`, [partnerAActor, partnerB, commitmentB])).rows).toEqual([]);
      await runtimeClient.query('ROLLBACK');
    } finally { await runtimeClient.end(); }
  });

  it('proves read-only projections do not mutate protected domain state', async () => {
    const before = {
      confirmation: (await owner.query(`SELECT confirmed_quantity_delta,promised_delivery_date FROM supplier_po_line_confirmation_events WHERE id=$1`, [fixture.eventA])).rows[0],
      tranche: (await owner.query(`SELECT quantity,status FROM supplier_po_delivery_tranches WHERE id=$1`, [trancheA])).rows[0],
      po: (await owner.query(`SELECT status,total_actual_purchase_cost,payment_terms_snapshot FROM supplier_purchase_orders WHERE id=$1`, [poId])).rows[0],
      commitment: (await owner.query(`SELECT total_excl_tax,total_incl_tax FROM commercial_commitments WHERE id=$1`, [commitmentA])).rows[0],
      cost: (await owner.query(`SELECT count(*)::int count FROM approved_purchase_cost_snapshots WHERE id IN (SELECT approved_purchase_cost_snapshot_id FROM procurement_release_lines WHERE id=$1)`, [lineA])).rows[0].count,
      paymentSchedule: (await owner.query(`SELECT count(*)::int count FROM supplier_payment_schedules WHERE po_id=$1`, [poId])).rows[0].count,
      coverage: (await owner.query(`SELECT count(*)::int count FROM supplier_po_coverage_bindings b JOIN supplier_po_release_line_allocations a ON a.id=b.supplier_po_release_line_allocation_id WHERE a.supplier_purchase_order_line_id IN (SELECT id FROM supplier_purchase_order_lines WHERE supplier_purchase_order_id=$1)`, [poId])).rows[0].count,
      documents: (await owner.query(`SELECT count(*)::int count FROM supplier_commercial_documents WHERE po_id=$1`, [poId])).rows[0].count,
    };
    await runtime.getPartnerDeliveryProjection(partnerAActor, partnerA, commitmentA);
    await runtime.getSupplierDeliveryDisclosure(supplierActor, supplier, trancheA);
    const after = {
      confirmation: (await owner.query(`SELECT confirmed_quantity_delta,promised_delivery_date FROM supplier_po_line_confirmation_events WHERE id=$1`, [fixture.eventA])).rows[0],
      tranche: (await owner.query(`SELECT quantity,status FROM supplier_po_delivery_tranches WHERE id=$1`, [trancheA])).rows[0],
      po: (await owner.query(`SELECT status,total_actual_purchase_cost,payment_terms_snapshot FROM supplier_purchase_orders WHERE id=$1`, [poId])).rows[0],
      commitment: (await owner.query(`SELECT total_excl_tax,total_incl_tax FROM commercial_commitments WHERE id=$1`, [commitmentA])).rows[0],
      cost: (await owner.query(`SELECT count(*)::int count FROM approved_purchase_cost_snapshots WHERE id IN (SELECT approved_purchase_cost_snapshot_id FROM procurement_release_lines WHERE id=$1)`, [lineA])).rows[0].count,
      paymentSchedule: (await owner.query(`SELECT count(*)::int count FROM supplier_payment_schedules WHERE po_id=$1`, [poId])).rows[0].count,
      coverage: (await owner.query(`SELECT count(*)::int count FROM supplier_po_coverage_bindings b JOIN supplier_po_release_line_allocations a ON a.id=b.supplier_po_release_line_allocation_id WHERE a.supplier_purchase_order_line_id IN (SELECT id FROM supplier_purchase_order_lines WHERE supplier_purchase_order_id=$1)`, [poId])).rows[0].count,
      documents: (await owner.query(`SELECT count(*)::int count FROM supplier_commercial_documents WHERE po_id=$1`, [poId])).rows[0].count,
    };
    expect(after).toEqual(before);
  });

  it('enforces RLS, FORCE RLS, grants and no physical or payment execution state', async () => {
    const rls = (await owner.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN('partner_delivery_sites','supplier_po_delivery_tranches','supplier_po_delivery_tranche_change_events')`)).rows;
    expect(rls).toHaveLength(3);
    expect(rls.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const grants = (await owner.query(`SELECT has_function_privilege('public','public.partner_delivery_projection_list(uuid,uuid,uuid)','EXECUTE') partner_public,has_function_privilege('sco_runtime','public.partner_delivery_projection_list(uuid,uuid,uuid)','EXECUTE') partner_runtime,has_function_privilege('public','public.supplier_delivery_disclosure_projection(uuid,uuid)','EXECUTE') supplier_public,has_function_privilege('public','public.internal_supplier_po_delivery_schedule_list(uuid,uuid)','EXECUTE') internal_public`)).rows[0];
    expect(grants).toEqual({ partner_public: false, partner_runtime: true, supplier_public: false, internal_public: false });
    const config = (await owner.query(`SELECT p.proname,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('internal_supplier_po_delivery_schedule_list','partner_delivery_projection_list','supplier_delivery_disclosure_projection')`)).rows;
    expect(config.every((row) => row.proconfig?.some((value: string) => value.replace(/\s/g,'')==='search_path=pg_catalog,public'))).toBe(true);
    const roles = (await owner.query(`SELECT rolname,rolbypassrls FROM pg_roles WHERE rolname IN('sco_runtime','sco_internal_executor') ORDER BY rolname`)).rows;
    expect(roles.every((row) => row.rolbypassrls===false)).toBe(true);
    expect((await owner.query(`SELECT count(*)::int AS count FROM supplier_po_delivery_tranches WHERE id IN($1,$2)`, [trancheA, trancheB])).rows[0].count).toBe(2);
  });
});
