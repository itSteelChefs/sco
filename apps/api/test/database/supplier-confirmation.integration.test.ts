import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService;
let po: string;
let line: string;
let actor: string;
let plainActor: string;
let readOnlyActor: string;

async function externalActor(type: string) {
  const company=(await owner.query(`SELECT id FROM "Company" WHERE type=$1 LIMIT 1`,[type])).rows[0].id;
  const user=id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`,[user,`${user}@external-confirmation.test`]);
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`,[id(),user,company]);
  return user;
}

async function freshLine(exclude?: string) {
  let row = (await owner.query(`SELECT p.id,l.id AS line_id,p.purchase_source_id,pi.category_id FROM supplier_purchase_orders p JOIN supplier_purchase_order_lines l ON l.supplier_purchase_order_id=p.id JOIN product_identities pi ON pi.id=l.product_identity_id WHERE p.status='ISSUED' AND l.ordered_quantity >= 100 AND ($1::uuid IS NULL OR l.id<>$1) AND NOT EXISTS (SELECT 1 FROM supplier_po_line_confirmation_events e WHERE e.supplier_purchase_order_line_id=l.id) ORDER BY p.created_at DESC LIMIT 1`,[exclude ?? null])).rows[0];
  if (!row) {
    const base = (await owner.query(`SELECT p.purchase_source_id,p.supplier_company_id,l.product_identity_id,l.unit_id FROM supplier_purchase_orders p JOIN supplier_purchase_order_lines l ON l.supplier_purchase_order_id=p.id LIMIT 1`)).rows[0];
    const newPo=id(); const newLine=id();
    await owner.query(`INSERT INTO supplier_purchase_orders(id,purchase_source_id,supplier_company_id,currency_code,status,created_by,issued_by,issued_at) VALUES($1,$2,$3,'SAR','ISSUED',$4,$4,now())`, [newPo,base.purchase_source_id,base.supplier_company_id,actor]);
    await owner.query(`INSERT INTO supplier_purchase_order_lines(id,supplier_purchase_order_id,demand_origin,product_identity_id,unit_id,ordered_quantity,actual_unit_purchase_cost,currency_code) VALUES($1,$2,'RELEASED_DEMAND',$3,$4,100,1,'SAR')`, [newLine,newPo,base.product_identity_id,base.unit_id]);
    row={ id:newPo, line_id:newLine, purchase_source_id:base.purchase_source_id, category_id:(await owner.query(`SELECT category_id FROM product_identities WHERE id=$1`,[base.product_identity_id])).rows[0].category_id };
  }
  await owner.query(`INSERT INTO procurement_engineer_scope_assignments(actor_user_id,purchase_source_id,product_category_id,status,assigned_by) VALUES($1,$2,$3,'ACTIVE',$1) ON CONFLICT DO NOTHING`, [actor, row.purchase_source_id, row.category_id]);
  return row;
}

async function principal(permissions: string[]) {
  const sco = (await owner.query(`SELECT id FROM "Company" WHERE type='SCO' LIMIT 1`)).rows[0].id;
  const user = id(); const membership = id(); const role = id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [user, `${user}@confirmation.test`]);
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membership, user, sco]);
  await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3)`, [role, sco, `confirmation-${id()}`]);
  await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(), sco, membership, role]);
  for (const permission of permissions) await owner.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`, [id(), sco, role, permission]);
  return user;
}

describe('Batch 9.6.2 supplier confirmation', () => {
  beforeAll(async () => {
    internal = new InternalDatabaseService();
    actor = await principal(['supplier_po.confirm.record','supplier_po.confirm.read','supplier_po.confirm.date_change','supplier_po.confirm.reference_correct']);
    plainActor = await principal([]);
    readOnlyActor = await principal(['supplier_po.confirm.read']);
    const row = (await owner.query(`SELECT p.id,l.id AS line_id FROM supplier_purchase_orders p JOIN supplier_purchase_order_lines l ON l.supplier_purchase_order_id=p.id WHERE p.status='ISSUED' ORDER BY p.created_at DESC LIMIT 1`)).rows[0];
    po = row.id; line = row.line_id;
    const scope = (await owner.query(`SELECT p.purchase_source_id,pi.category_id FROM supplier_purchase_order_lines l JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id JOIN product_identities pi ON pi.id=l.product_identity_id WHERE l.id=$1`, [line])).rows[0];
    await owner.query(`INSERT INTO procurement_engineer_scope_assignments(actor_user_id,purchase_source_id,product_category_id,status,assigned_by) VALUES($1,$2,$3,'ACTIVE',$1) ON CONFLICT DO NOTHING`, [actor, scope.purchase_source_id, scope.category_id]);
  });
  afterAll(async () => { await internal.onModuleDestroy(); await owner.end(); });

  it('exposes immutable confirmation structures and purpose-built gateways', async () => {
    const tables = (await owner.query(`SELECT to_regclass('public.supplier_po_confirmations') AS header, to_regclass('public.supplier_po_line_confirmation_events') AS line_events, to_regclass('public.supplier_po_delivery_date_change_events') AS date_events, to_regclass('public.supplier_po_reference_correction_events') AS reference_events`)).rows[0];
    expect(tables).toEqual({ header: 'supplier_po_confirmations', line_events: 'supplier_po_line_confirmation_events', date_events: 'supplier_po_delivery_date_change_events', reference_events: 'supplier_po_reference_correction_events' });
    const gateways = (await owner.query(`SELECT to_regprocedure('public.internal_supplier_po_confirmation_record(uuid,uuid,numeric,date,text,text,text)') AS record_gateway, to_regprocedure('public.internal_supplier_po_confirmation_date_change(uuid,uuid,date,date,text,text)') AS date_gateway, to_regprocedure('public.internal_supplier_po_confirmation_reference_correct(uuid,uuid,text,text,text,text)') AS reference_gateway`)).rows[0];
    expect(gateways.record_gateway).toBe('internal_supplier_po_confirmation_record(uuid,uuid,numeric,date,text,text,text)');
    expect(gateways.date_gateway).toBe('internal_supplier_po_confirmation_date_change(uuid,uuid,date,date,text,text)');
    expect(gateways.reference_gateway).toBe('internal_supplier_po_confirmation_reference_correct(uuid,uuid,text,text,text,text)');
  });

  it('records a partial confirmation as an immutable delta with derived status', async () => {
    line = (await freshLine()).line_id;
    const correlation = id();
    await internal.recordSupplierPOConfirmation(actor, line, 40, '2026-10-15', 'SUP-1', 'partial', correlation);
    const row = (await owner.query(`SELECT confirmed_quantity,status,remaining_quantity FROM public.internal_supplier_po_confirmation_line_get($1,$2)`, [actor, line])).rows[0];
    expect(row).toMatchObject({ confirmed_quantity: '40.0000', status: 'PARTIALLY_CONFIRMED', remaining_quantity: '60.0000' });
  });

  it('supports multiple partial dates and reaches exact confirmation without overwriting history', async () => {
    line = (await freshLine()).line_id;
    await internal.recordSupplierPOConfirmation(actor, line, 40, '2026-10-15', 'SUP-1', 'first tranche', id());
    await internal.recordSupplierPOConfirmation(actor, line, 60, '2026-10-20', 'SUP-2', 'final tranche', id());
    const rows = (await owner.query(`SELECT confirmed_quantity_delta,promised_delivery_date FROM supplier_po_line_confirmation_events WHERE supplier_purchase_order_line_id=$1 ORDER BY created_at`, [line])).rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.confirmed_quantity_delta)).toEqual(['40.0000', '60.0000']);
    const status = (await owner.query(`SELECT status,confirmed_quantity,remaining_quantity FROM public.internal_supplier_po_confirmation_line_get($1,$2)`, [actor, line])).rows[0];
    expect(status).toMatchObject({ status: 'CONFIRMED', confirmed_quantity: '100.0000', remaining_quantity: '0.0000' });
  });

  it('rejects over-confirmation atomically', async () => {
    line = (await freshLine()).line_id;
    await internal.recordSupplierPOConfirmation(actor, line, 100, '2026-10-15', 'SUP-1', 'full', id());
    const before = (await owner.query(`SELECT count(*)::int AS count FROM supplier_po_line_confirmation_events WHERE supplier_purchase_order_line_id=$1`, [line])).rows[0].count;
    await expect(internal.recordSupplierPOConfirmation(actor, line, 1, '2026-10-21', 'SUP-3', 'too much', id())).rejects.toThrow('SUPPLIER_PO_CONFIRMATION_QUANTITY_EXCEEDED');
    const after = (await owner.query(`SELECT count(*)::int AS count FROM supplier_po_line_confirmation_events WHERE supplier_purchase_order_line_id=$1`, [line])).rows[0].count;
    expect(after).toBe(before);
  });

  it('preserves date changes and supplier reference corrections as immutable events', async () => {
    line = (await freshLine()).line_id;
    await internal.recordSupplierPOConfirmation(actor, line, 40, '2026-10-15', 'SUP-2', 'initial', id());
    await internal.changeSupplierPOConfirmationDate(actor, line, '2026-10-15', '2026-10-18', 'supplier update', id());
    await internal.correctSupplierPOConfirmationReference(actor, line, 'SUP-2', 'SUP-2-CORRECTED', 'supplier typo', id());
    expect((await owner.query(`SELECT previous_date,new_date,reason FROM supplier_po_delivery_date_change_events WHERE supplier_purchase_order_line_id=$1`, [line])).rows).toHaveLength(1);
    expect((await owner.query(`SELECT previous_reference,corrected_reference,reason FROM supplier_po_reference_correction_events WHERE supplier_purchase_order_line_id=$1`, [line])).rows).toHaveLength(1);
  });

  it('rejects confirmation on a DRAFT PO and unauthorized actors', async () => {
    const base = (await owner.query(`SELECT p.purchase_source_id,p.supplier_company_id,l.product_identity_id,l.unit_id,pi.category_id FROM supplier_purchase_orders p JOIN supplier_purchase_order_lines l ON l.supplier_purchase_order_id=p.id JOIN product_identities pi ON pi.id=l.product_identity_id LIMIT 1`)).rows[0];
    const draft=id(), draftLine=id();
    await owner.query(`INSERT INTO supplier_purchase_orders(id,purchase_source_id,supplier_company_id,currency_code,status,created_by) VALUES($1,$2,$3,'SAR','DRAFT',$4)`,[draft,base.purchase_source_id,base.supplier_company_id,actor]);
    await owner.query(`INSERT INTO supplier_purchase_order_lines(id,supplier_purchase_order_id,demand_origin,product_identity_id,unit_id,ordered_quantity,actual_unit_purchase_cost,currency_code) VALUES($1,$2,'RELEASED_DEMAND',$3,$4,100,1,'SAR')`,[draftLine,draft,base.product_identity_id,base.unit_id]);
    await expect(internal.recordSupplierPOConfirmation(actor,draftLine,10,'2026-11-01','DRAFT','draft',id())).rejects.toThrow('SUPPLIER_PO_CONFIRMATION_PO_NOT_ISSUED');
    await expect(internal.recordSupplierPOConfirmation(plainActor,line,1,'2026-11-01','NO','unauthorized',id())).rejects.toThrow('SUPPLIER_PO_CONFIRMATION_FORBIDDEN');
  });

  it('keeps confirmation history immutable and denies direct runtime DML', async () => {
    const event=(await owner.query(`SELECT id FROM supplier_po_line_confirmation_events ORDER BY created_at DESC LIMIT 1`)).rows[0].id;
    await expect(owner.query(`UPDATE supplier_po_line_confirmation_events SET operational_note='tampered' WHERE id=$1`,[event])).rejects.toThrow('SUPPLIER_PO_CONFIRMATION_HISTORY_IMMUTABLE');
    await expect(owner.query(`DELETE FROM supplier_po_line_confirmation_events WHERE id=$1`,[event])).rejects.toThrow('SUPPLIER_PO_CONFIRMATION_HISTORY_IMMUTABLE');
    const runtime=new Client({connectionString:process.env.RUNTIME_DATABASE_URL});
    await runtime.connect();
    try { await expect(runtime.query('INSERT INTO supplier_po_line_confirmation_events(id,supplier_po_confirmation_id,supplier_purchase_order_line_id,confirmed_quantity_delta,promised_delivery_date,actor_user_id) VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,current_date,gen_random_uuid())')).rejects.toThrow(/permission denied/i); }
    finally { await runtime.end(); }
  });

  it('derives PO confirmation visibility through the purpose-built gateway', async () => {
    const rows=await internal.getSupplierPOConfirmation(actor,po);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('status');
  });

  it('requires active operational scope in addition to confirmation read capability', async () => {
    expect(await internal.getSupplierPOConfirmationLine(readOnlyActor,line)).toEqual(null);
    const scopedLine=(await freshLine()).line_id;
    await owner.query(`INSERT INTO supplier_po_line_responsibilities(supplier_purchase_order_line_id,actor_user_id,assigned_by) VALUES($1,$2,$3)`,[scopedLine,readOnlyActor,actor]);
    expect(await internal.getSupplierPOConfirmationLine(readOnlyActor,scopedLine)).toBeTruthy();
  });

  it('denies Partner and Supplier actors and ignores spoofed internal context', async () => {
    const partner=await externalActor('PARTNER');
    const supplier=await externalActor('SUPPLIER');
    expect(await internal.getSupplierPOConfirmationLine(partner,line)).toEqual(null);
    expect(await internal.getSupplierPOConfirmationLine(supplier,line)).toEqual(null);
    const executor=new Client({connectionString:process.env.SCO_INTERNAL_DATABASE_URL});
    await executor.connect();
    try {
      await executor.query(`SELECT set_config('app.sco_internal','true',false), set_config('app.actor_id',$1,false)`,[actor]);
      expect((await executor.query(`SELECT * FROM public.internal_supplier_po_confirmation_line_get($1,$2)`,[plainActor,line])).rows).toEqual([]);
    } finally { await executor.end(); }
  });

  it('does not grant global visibility from Lead Engineer or record capability alone', async () => {
    const leadOnly=await principal(['supplier_po.confirm.record']);
    expect(await internal.getSupplierPOConfirmationLine(leadOnly,line)).toEqual(null);
    expect(await internal.getSupplierPOConfirmationLine(actor,line)).toBeTruthy();
  });

  it('serializes concurrent confirmation deltas without exceeding ordered quantity', async () => {
    const target=(await freshLine()).line_id;
    const results=await Promise.allSettled([
      internal.recordSupplierPOConfirmation(actor,target,70,'2026-12-01','C-A','concurrent',id()),
      internal.recordSupplierPOConfirmation(actor,target,70,'2026-12-02','C-B','concurrent',id()),
    ]);
    expect(results.filter((r)=>r.status==='fulfilled')).toHaveLength(1);
    const sum=(await owner.query(`SELECT COALESCE(sum(confirmed_quantity_delta),0) AS quantity FROM supplier_po_line_confirmation_events WHERE supplier_purchase_order_line_id=$1`,[target])).rows[0].quantity;
    expect(Number(sum)).toBe(70);
  });

  it('does not alter release allocations, Purchase Coverage, price, or source', async () => {
    const before=(await owner.query(`SELECT p.purchase_source_id,l.actual_unit_purchase_cost,a.procurement_release_line_id,COALESCE(sum(b.bound_amount),0) AS bound FROM supplier_purchase_order_lines l JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id LEFT JOIN supplier_po_release_line_allocations a ON a.supplier_purchase_order_line_id=l.id LEFT JOIN supplier_po_coverage_bindings b ON b.supplier_po_release_line_allocation_id=a.id WHERE l.id=$1 GROUP BY p.purchase_source_id,l.actual_unit_purchase_cost,a.procurement_release_line_id`,[line])).rows[0];
    await internal.recordSupplierPOConfirmation(actor,line,0.1,'2026-12-03','NOOP','check',id()).catch(()=>undefined);
    const after=(await owner.query(`SELECT p.purchase_source_id,l.actual_unit_purchase_cost,a.procurement_release_line_id,COALESCE(sum(b.bound_amount),0) AS bound FROM supplier_purchase_order_lines l JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id LEFT JOIN supplier_po_release_line_allocations a ON a.supplier_purchase_order_line_id=l.id LEFT JOIN supplier_po_coverage_bindings b ON b.supplier_po_release_line_allocation_id=a.id WHERE l.id=$1 GROUP BY p.purchase_source_id,l.actual_unit_purchase_cost,a.procurement_release_line_id`,[line])).rows[0];
    expect(after).toEqual(before);
  });

  it('persists confirmation audit with actor and correlation id', async () => {
    const target=(await freshLine()).line_id; const correlation=id();
    await internal.recordSupplierPOConfirmation(actor,target,10,'2027-01-01','AUDIT-1','audit',correlation);
    const audit=(await owner.query(`SELECT actor_user_id,action,entity_id,correlation_id,created_at FROM audit_logs WHERE action='supplier_po.confirmation.recorded' AND entity_id=$1 AND correlation_id=$2`,[target,correlation])).rows[0];
    expect(audit).toMatchObject({actor_user_id:actor,action:'supplier_po.confirmation.recorded',entity_id:target,correlation_id:correlation});
    expect(audit.created_at).toBeTruthy();
  });

  it('returns only minimum scoped confirmation fields', async () => {
    const row=await internal.getSupplierPOConfirmationLine(actor,line);
    expect(Object.keys(row).sort()).toEqual(['confirmed_quantity','remaining_quantity','status']);
  });

  it('denies a read-capable engineer with no source/category relationship', async () => {
    const target=(await freshLine()).line_id;
    expect(await internal.getSupplierPOConfirmationLine(readOnlyActor,target)).toEqual(null);
  });

  it('keeps line responsibility limited to the assigned line', async () => {
    const first=(await freshLine()).line_id; const second=(await freshLine(first)).line_id;
    await owner.query(`INSERT INTO supplier_po_line_responsibilities(supplier_purchase_order_line_id,actor_user_id,assigned_by) VALUES($1,$2,$3)`,[first,readOnlyActor,actor]);
    expect(await internal.getSupplierPOConfirmationLine(readOnlyActor,first)).toBeTruthy();
    expect(await internal.getSupplierPOConfirmationLine(readOnlyActor,second)).toEqual(null);
  });

  it('denies confirmation reads after membership revocation', async () => {
    const revoked=await principal(['supplier_po.confirm.read']);
    await owner.query(`UPDATE "CompanyMembership" SET status='REVOKED' WHERE "userId"=$1`,[revoked]);
    expect(await internal.getSupplierPOConfirmationLine(revoked,line)).toEqual(null);
  });

  it('does not mutate Supplier PO commercial state when confirmation is recorded', async () => {
    const target=(await freshLine()).line_id;
    const before=(await owner.query(`SELECT p.status,p.purchase_source_id,l.actual_unit_purchase_cost FROM supplier_purchase_order_lines l JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id WHERE l.id=$1`,[target])).rows[0];
    await internal.recordSupplierPOConfirmation(actor,target,5,'2027-02-01','STATE-1','state',id());
    const after=(await owner.query(`SELECT p.status,p.purchase_source_id,l.actual_unit_purchase_cost FROM supplier_purchase_order_lines l JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id WHERE l.id=$1`,[target])).rows[0];
    expect(after).toEqual(before);
  });

  it('preserves original promised date and reference correction lineage', async () => {
    const target=(await freshLine()).line_id;
    await internal.recordSupplierPOConfirmation(actor,target,20,'2027-03-10','ORIGINAL-REF','original',id());
    await internal.changeSupplierPOConfirmationDate(actor,target,'2027-03-10','2027-03-20','supplier delay',id());
    await internal.correctSupplierPOConfirmationReference(actor,target,'ORIGINAL-REF','CORRECTED-REF','supplier typo',id());
    const firstEvent=(await owner.query(`SELECT promised_delivery_date,supplier_reference FROM supplier_po_line_confirmation_events WHERE supplier_purchase_order_line_id=$1 ORDER BY created_at LIMIT 1`,[target])).rows[0];
    expect(firstEvent.supplier_reference).toBe('ORIGINAL-REF');
    expect(new Date(firstEvent.promised_delivery_date).toISOString().slice(0,10)).toBe('2027-03-10');
    const dateChange=(await owner.query(`SELECT previous_date,new_date FROM supplier_po_delivery_date_change_events WHERE supplier_purchase_order_line_id=$1 ORDER BY created_at DESC LIMIT 1`,[target])).rows[0];
    expect(new Date(dateChange.previous_date).toISOString().slice(0,10)).toBe('2027-03-10');
    expect(new Date(dateChange.new_date).toISOString().slice(0,10)).toBe('2027-03-20');
    expect((await owner.query(`SELECT previous_reference,corrected_reference FROM supplier_po_reference_correction_events WHERE supplier_purchase_order_line_id=$1 ORDER BY created_at DESC LIMIT 1`,[target])).rows[0]).toEqual({previous_reference:'ORIGINAL-REF',corrected_reference:'CORRECTED-REF'});
  });
});
