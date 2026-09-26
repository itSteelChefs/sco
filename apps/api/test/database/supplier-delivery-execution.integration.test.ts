import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService;
let sco: string;
let scheduler: string;
let recordActor: string;
let readAllActor: string;
let unauthorizedActor: string;
let jobTitleActor: string;
let partnerActor: string;
let supplierActor: string;
let partnerCompany: string;
let supplierCompany: string;
let partnerB: string;
let baseA: any;
let baseB: any;

async function principal(companyId: string, permissions: string[], roleName = 'delivery-test') {
  const user = id();
  const membership = id();
  const role = id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [user, `${user}@delivery-execution.test`]);
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membership, user, companyId]);
  await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)`, [role, companyId, `${roleName}-${role}`, roleName]);
  await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(), companyId, membership, role]);
  for (const permission of permissions) {
    await owner.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`, [id(), companyId, role, permission]);
  }
  return user;
}

async function createFixture(base: any, ready = true, assignRecord = true) {
  const po = id();
  const poLine = id();
  const release = id();
  const releaseLine = id();
  const allocation = id();
  const confirmation = id();
  const confirmationEvent = id();
  await owner.query(`INSERT INTO supplier_purchase_orders(id,purchase_source_id,supplier_company_id,currency_code,status,created_by) VALUES($1,$2,$3,$4,'DRAFT',$5)`, [po, base.purchase_source_id, base.supplier_company_id, base.currency_code, scheduler]);
  await owner.query(`INSERT INTO supplier_purchase_order_lines(id,supplier_purchase_order_id,demand_origin,product_identity_id,unit_id,ordered_quantity,actual_unit_purchase_cost,currency_code) VALUES($1,$2,'RELEASED_DEMAND',$3,$4,20,$5,$6)`, [poLine, po, base.product_identity_id, base.unit_id, base.unit_purchase_cost, base.currency_code]);
  await owner.query(`INSERT INTO procurement_releases(id,commercial_commitment_id,partner_company_id,total_required,currency_code) VALUES($1,$2,$3,20,$4)`, [release, base.commercial_commitment_id, base.partner_company_id, base.currency_code]);
  await owner.query(`INSERT INTO procurement_release_lines(id,release_id,commercial_commitment_line_id,product_identity_id,released_quantity,unit_id,approved_purchase_cost_snapshot_id,purchase_source_id,supplier_company_id,currency_code,unit_purchase_cost) VALUES($1,$2,$3,$4,20,$5,$6,$7,$8,$9,$10)`, [releaseLine, release, base.commercial_commitment_line_id, base.product_identity_id, base.unit_id, base.approved_purchase_cost_snapshot_id, base.purchase_source_id, base.supplier_company_id, base.currency_code, base.unit_purchase_cost]);
  await owner.query(`INSERT INTO supplier_po_release_line_allocations(id,supplier_purchase_order_line_id,procurement_release_line_id,allocated_quantity,approved_purchase_cost_snapshot_id,original_purchase_source_id,approved_unit_purchase_cost) VALUES($1,$2,$3,20,$4,$5,$6)`, [allocation, poLine, releaseLine, base.approved_purchase_cost_snapshot_id, base.purchase_source_id, base.unit_purchase_cost]);
  await owner.query(`INSERT INTO supplier_po_confirmations(id,supplier_purchase_order_id,created_by) VALUES($1,$2,$3)`, [confirmation, po, scheduler]);
  await owner.query(`INSERT INTO supplier_po_line_confirmation_events(id,supplier_po_confirmation_id,supplier_purchase_order_line_id,confirmed_quantity_delta,promised_delivery_date,actor_user_id) VALUES($1,$2,$3,20,current_date+30,$4)`, [confirmationEvent, confirmation, poLine, scheduler]);
  const site = await internal.createPartnerDeliverySite(scheduler, base.partner_company_id, null, 'Execution Site', {}, {}, id());
  const tranche = await internal.createSupplierPODeliveryTranche(scheduler, allocation, site, confirmationEvent, 20, id());
  if (ready) await owner.query(`UPDATE supplier_po_delivery_tranches SET status='READY_FOR_DELIVERY' WHERE id=$1`, [tranche]);
  if (assignRecord) await owner.query(`INSERT INTO supplier_po_line_responsibilities(id,supplier_purchase_order_line_id,actor_user_id,assigned_by) VALUES($1,$2,$3,$4)`, [id(), poLine, recordActor, scheduler]);
  return { po, poLine, release, releaseLine, allocation, confirmationEvent, site, tranche };
}

async function record(actor: string, tranche: string, quantity: number, key = id(), deliveredAt = '2030-04-05T12:30:00.000Z', reference?: string, correlationId?: string) {
  return internal.recordSupplierPODelivery(actor, tranche, { quantity, idempotencyKey: key, deliveredAt, operationalReference: reference }, correlationId);
}

describe('Batch 11-A physical delivery execution foundation', () => {
  beforeAll(async () => {
    internal = new InternalDatabaseService();
    sco = (await owner.query(`SELECT id FROM "Company" WHERE type='SCO' AND status='ACTIVE' LIMIT 1`)).rows[0].id;
    scheduler = await principal(sco, ['supplier_po.delivery_schedule.manage', 'supplier_po.delivery_schedule.read_all'], 'delivery-scheduler');
    recordActor = await principal(sco, ['delivery.execution.record', 'delivery.execution.read_assigned']);
    readAllActor = await principal(sco, ['delivery.execution.read_all']);
    unauthorizedActor = await principal(sco, []);
    jobTitleActor = await principal(sco, [], 'Delivery Execution Recorder');
    partnerCompany = id();
    supplierCompany = id();
    await owner.query(`INSERT INTO "Company"(id,name,type) VALUES($1,'Delivery execution partner','PARTNER'),($2,'Delivery execution supplier','SUPPLIER')`, [partnerCompany, supplierCompany]);
    partnerActor = await principal(partnerCompany, ['delivery.execution.record', 'delivery.execution.read_all']);
    supplierActor = await principal(supplierCompany, ['delivery.execution.record', 'delivery.execution.read_all']);
    const sources = (await owner.query(`
      SELECT rl.commercial_commitment_line_id,rl.product_identity_id,rl.unit_id,
             rl.approved_purchase_cost_snapshot_id,rl.purchase_source_id,
             rl.supplier_company_id,rl.currency_code,rl.unit_purchase_cost,
             r.commercial_commitment_id,r.partner_company_id
        FROM procurement_release_lines rl
        JOIN procurement_releases r ON r.id=rl.release_id
       WHERE rl.released_quantity>=20
       ORDER BY rl.created_at DESC LIMIT 250
    `)).rows;
    baseA = sources[0];
    baseB = sources.find((row: any) => row.partner_company_id !== baseA.partner_company_id);
    if (!baseA || !baseB) throw new Error('no deterministic multi-partner release-line fixtures');
    partnerB = baseB.partner_company_id;
  });

  afterAll(async () => { await internal.onModuleDestroy(); await owner.end(); });

  it('records a physical fact only for a READY_FOR_DELIVERY tranche and returns its event ID', async () => {
    const fixture = await createFixture(baseA);
    const event = await record(recordActor, fixture.tranche, 6, id(), '2030-04-05T12:30:00.000Z', 'dock-1');
    expect(event).toMatch(/^[0-9a-f-]{36}$/i);
    const row = (await owner.query(`SELECT tranche_id,delivered_quantity,delivered_at,operational_reference,actor_user_id FROM supplier_po_delivery_execution_events WHERE id=$1`, [event])).rows[0];
    expect(row).toMatchObject({ tranche_id: fixture.tranche, delivered_quantity: '6.0000', operational_reference: 'dock-1', actor_user_id: recordActor });
    expect(new Date(row.delivered_at).toISOString()).toBe('2030-04-05T12:30:00.000Z');
  });

  it('rejects delivery against a non-ready tranche without recording a fact', async () => {
    const fixture = await createFixture(baseA, false);
    await expect(record(recordActor, fixture.tranche, 1)).rejects.toThrow('DELIVERY_EXECUTION_NOT_READY');
    expect((await owner.query(`SELECT count(*)::int AS count FROM supplier_po_delivery_execution_events WHERE tranche_id=$1`, [fixture.tranche])).rows[0].count).toBe(0);
  });

  it.each([0, -1])('rejects non-positive delivery quantity %s', async (quantity) => {
    const fixture = await createFixture(baseA);
    await expect(record(recordActor, fixture.tranche, quantity)).rejects.toThrow('DELIVERY_EXECUTION_INVALID');
  });

  it('rejects quantities more precise than the scheduled quantity scale', async () => {
    const fixture = await createFixture(baseA);
    await expect(record(recordActor, fixture.tranche, 0.00001)).rejects.toThrow('DELIVERY_EXECUTION_INVALID');
  });

  it('derives scheduled, delivered, remaining, count, and latest timestamp from immutable events', async () => {
    const fixture = await createFixture(baseA);
    await record(recordActor, fixture.tranche, 6, id(), '2030-04-05T12:30:00.000Z');
    await record(recordActor, fixture.tranche, 7, id(), '2030-04-06T12:30:00.000Z');
    const progress = await internal.getSupplierPODeliveryExecution(readAllActor, fixture.tranche);
    expect(progress).toMatchObject({ tranche_id: fixture.tranche, scheduled_quantity: '20.0000', delivered_quantity: '13.0000', remaining_quantity: '7.0000', delivery_event_count: 2 });
    expect(new Date(progress.latest_delivered_at).toISOString()).toBe('2030-04-06T12:30:00.000Z');
  });

  it('allows a final partial delivery to complete the tranche exactly', async () => {
    const fixture = await createFixture(baseA);
    await record(recordActor, fixture.tranche, 6);
    await record(recordActor, fixture.tranche, 7);
    await record(recordActor, fixture.tranche, 7);
    const progress = await internal.getSupplierPODeliveryExecution(readAllActor, fixture.tranche);
    expect(progress).toMatchObject({ scheduled_quantity: '20.0000', delivered_quantity: '20.0000', remaining_quantity: '0.0000', delivery_event_count: 3 });
  });

  it('rejects over-delivery without changing prior events or writing success audit', async () => {
    const fixture = await createFixture(baseA);
    await record(recordActor, fixture.tranche, 13);
    const correlation = id();
    await expect(record(recordActor, fixture.tranche, 8, id(), undefined, undefined, correlation)).rejects.toThrow('DELIVERY_EXECUTION_OVER_DELIVERY');
    const after = (await owner.query(`SELECT COALESCE(sum(delivered_quantity),0)::text AS total,count(*)::int AS count FROM supplier_po_delivery_execution_events WHERE tranche_id=$1`, [fixture.tranche])).rows[0];
    expect(after).toEqual({ total: '13.0000', count: 1 });
    expect((await owner.query(`SELECT count(*)::int AS count FROM audit_logs WHERE action='supplier_po.delivery.execution_recorded' AND correlation_id=$1`, [correlation])).rows[0].count).toBe(0);
  });

  it('returns the original event on an identical idempotent retry without double counting', async () => {
    const fixture = await createFixture(baseA);
    const key = id();
    const timestamp = '2030-04-05T12:30:00.000Z';
    const first = await record(recordActor, fixture.tranche, 5, key, timestamp, 'receipt-ref');
    const retry = await record(recordActor, fixture.tranche, 5, key, timestamp, 'receipt-ref');
    expect(retry).toBe(first);
    expect((await owner.query(`SELECT count(*)::int AS count,sum(delivered_quantity)::text AS total FROM supplier_po_delivery_execution_events WHERE tranche_id=$1`, [fixture.tranche])).rows[0]).toEqual({ count: 1, total: '5.0000' });
    expect((await owner.query(`SELECT count(*)::int AS count FROM audit_logs WHERE action='supplier_po.delivery.execution_recorded' AND entity_id=$1`, [first])).rows[0].count).toBe(1);
  });

  it('rejects an idempotency key reused with a different payload', async () => {
    const fixture = await createFixture(baseA);
    const key = id();
    await record(recordActor, fixture.tranche, 5, key, '2030-04-05T12:30:00.000Z', 'ref-a');
    await expect(record(recordActor, fixture.tranche, 6, key, '2030-04-05T12:30:00.000Z', 'ref-a')).rejects.toThrow('DELIVERY_EXECUTION_IDEMPOTENCY_CONFLICT');
    await expect(record(recordActor, fixture.tranche, 5, key, '2030-04-06T12:30:00.000Z', 'ref-a')).rejects.toThrow('DELIVERY_EXECUTION_IDEMPOTENCY_CONFLICT');
    await expect(record(recordActor, fixture.tranche, 5, key, '2030-04-05T12:30:00.000Z', 'ref-b')).rejects.toThrow('DELIVERY_EXECUTION_IDEMPOTENCY_CONFLICT');
  });

  it('serializes concurrent partial deliveries so their sum cannot exceed the tranche', async () => {
    const fixture = await createFixture(baseA);
    const results = await Promise.allSettled([
      record(recordActor, fixture.tranche, 12, id(), '2030-04-05T12:30:00.000Z'),
      record(recordActor, fixture.tranche, 12, id(), '2030-04-05T12:31:00.000Z'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await owner.query(`SELECT sum(delivered_quantity)::text AS total FROM supplier_po_delivery_execution_events WHERE tranche_id=$1`, [fixture.tranche])).rows[0].total).toBe('12.0000');
  });

  it('returns the same safe denial for a foreign tranche and an unknown tranche', async () => {
    const own = await createFixture(baseA);
    const foreign = await createFixture(baseB, true, false);
    await expect(record(recordActor, foreign.tranche, 1)).rejects.toThrow('DELIVERY_EXECUTION_FORBIDDEN');
    await expect(record(recordActor, id(), 1)).rejects.toThrow('DELIVERY_EXECUTION_FORBIDDEN');
    expect((await owner.query(`SELECT count(*)::int AS count FROM supplier_po_delivery_execution_events WHERE tranche_id=$1`, [foreign.tranche])).rows[0].count).toBe(0);
    expect(own.tranche).not.toBe(foreign.tranche);
  });

  it('keeps assigned reads separate from record authorization and scopes them to assigned lines', async () => {
    const own = await createFixture(baseA);
    const foreign = await createFixture(baseB, true, false);
    await record(recordActor, own.tranche, 4);
    expect(await internal.getSupplierPODeliveryExecution(recordActor, own.tranche)).toMatchObject({ delivered_quantity: '4.0000' });
    expect(await internal.getSupplierPODeliveryExecution(recordActor, foreign.tranche)).toBeNull();
    expect(await internal.getSupplierPODeliveryExecution(unauthorizedActor, own.tranche)).toBeNull();
    expect(await internal.getSupplierPODeliveryExecution(recordActor, id())).toBeNull();
  });

  it('does not let delivery-record capability alone grant internal reads', async () => {
    const fixture = await createFixture(baseA);
    await record(recordActor, fixture.tranche, 1);
    expect(await internal.getSupplierPODeliveryExecution(unauthorizedActor, fixture.tranche)).toBeNull();
    const recordOnly = await principal(sco, ['delivery.execution.record']);
    await owner.query(`INSERT INTO supplier_po_line_responsibilities(id,supplier_purchase_order_line_id,actor_user_id,assigned_by) VALUES($1,$2,$3,$4)`, [id(), fixture.poLine, recordOnly, scheduler]);
    expect(await internal.getSupplierPODeliveryExecution(recordOnly, fixture.tranche)).toBeNull();
  });

  it('rejects users with no capability even if their role is named like a job title', async () => {
    const fixture = await createFixture(baseA);
    expect(jobTitleActor).toBeTruthy();
    await expect(record(jobTitleActor, fixture.tranche, 1)).rejects.toThrow('DELIVERY_EXECUTION_FORBIDDEN');
  });

  it('rejects Partner and Supplier actors regardless of assigned permission rows', async () => {
    const fixture = await createFixture(baseA);
    await expect(record(partnerActor, fixture.tranche, 1)).rejects.toThrow('DELIVERY_EXECUTION_FORBIDDEN');
    await expect(record(supplierActor, fixture.tranche, 1)).rejects.toThrow('DELIVERY_EXECUTION_FORBIDDEN');
  });

  it('rejects spoofed actor context and does not trust app.sco_internal', async () => {
    const fixture = await createFixture(baseA);
    const executor = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
    await executor.connect();
    try {
      await executor.query('BEGIN');
      await executor.query(`SELECT set_config('app.actor_id',$1,true),set_config('app.sco_internal','true',true)`, [unauthorizedActor]);
      await expect(executor.query(`SELECT public.internal_supplier_po_delivery_execution_record($1,$2,1,'2030-04-05T12:30:00Z',NULL,$3,NULL)`, [recordActor, fixture.tranche, id()])).rejects.toThrow('DELIVERY_EXECUTION_FORBIDDEN');
      await executor.query('ROLLBACK');
    } finally { await executor.end(); }
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
    await runtime.connect();
    try {
      await runtime.query('BEGIN');
      await runtime.query(`SELECT set_config('app.actor_id',$1,true),set_config('app.sco_internal','true',true)`, [recordActor]);
      await expect(runtime.query(`SELECT public.internal_supplier_po_delivery_execution_record($1,$2,1,'2030-04-05T12:30:00Z',NULL,$3,NULL)`, [recordActor, fixture.tranche, id()])).rejects.toThrow(/permission denied/i);
      await runtime.query('ROLLBACK');
    } finally { await runtime.end(); }
  });

  it('prevents event update and delete even when attempted by the database owner', async () => {
    const fixture = await createFixture(baseA);
    const event = await record(recordActor, fixture.tranche, 2);
    await expect(owner.query(`UPDATE supplier_po_delivery_execution_events SET delivered_quantity=3 WHERE id=$1`, [event])).rejects.toThrow('DELIVERY_EXECUTION_IMMUTABLE');
    await expect(owner.query(`DELETE FROM supplier_po_delivery_execution_events WHERE id=$1`, [event])).rejects.toThrow('DELIVERY_EXECUTION_IMMUTABLE');
    expect((await owner.query(`SELECT delivered_quantity::text FROM supplier_po_delivery_execution_events WHERE id=$1`, [event])).rows[0].delivered_quantity).toBe('2.0000');
  });

  it('denies direct internal-executor and runtime table access and DML', async () => {
    const fixture = await createFixture(baseA);
    const executor = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
    await executor.connect();
    try {
      await expect(executor.query(`SELECT * FROM supplier_po_delivery_execution_events WHERE tranche_id=$1`, [fixture.tranche])).rejects.toThrow(/permission denied/i);
      await expect(executor.query(`UPDATE supplier_po_delivery_execution_events SET delivered_quantity=1 WHERE tranche_id=$1`, [fixture.tranche])).rejects.toThrow(/permission denied/i);
      await expect(executor.query(`DELETE FROM supplier_po_delivery_execution_events WHERE tranche_id=$1`, [fixture.tranche])).rejects.toThrow(/permission denied/i);
    } finally { await executor.end(); }
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
    await runtime.connect();
    try {
      for (const [company, actor] of [[partnerCompany, partnerActor], [supplierCompany, supplierActor]]) {
        await runtime.query(`SELECT set_config('app.tenant_id',$1,false),set_config('app.actor_id',$2,false),set_config('app.sco_internal','true',false)`, [company, actor]);
        await expect(runtime.query(`SELECT * FROM supplier_po_delivery_execution_events WHERE tranche_id=$1`, [fixture.tranche])).rejects.toThrow(/permission denied/i);
        await expect(runtime.query(`INSERT INTO supplier_po_delivery_execution_events(tranche_id,delivered_quantity,delivered_at,actor_user_id,idempotency_key) VALUES($1,1,now(),$2,$3)`, [fixture.tranche, actor, id()])).rejects.toThrow(/permission denied/i);
        await expect(runtime.query(`SELECT public.internal_supplier_po_delivery_execution_record($1,$2,1,'2030-04-05T12:30:00Z',NULL,$3,NULL)`, [actor, fixture.tranche, id()])).rejects.toThrow(/permission denied/i);
      }
    } finally { await runtime.end(); }
  });

  it('writes one audit fact with actor, correlation, quantity, timestamp, key, and outcome', async () => {
    const fixture = await createFixture(baseA);
    const correlation = id();
    const timestamp = '2030-04-05T12:30:00.000Z';
    const key = id();
    const event = await record(recordActor, fixture.tranche, 3, key, timestamp, 'dock-ref', correlation);
    const audit = (await owner.query(`SELECT actor_user_id,action,entity_id,correlation_id,metadata FROM audit_logs WHERE action='supplier_po.delivery.execution_recorded' AND entity_id=$1`, [event])).rows[0];
    expect(audit).toMatchObject({ actor_user_id: recordActor, action: 'supplier_po.delivery.execution_recorded', entity_id: event, correlation_id: correlation });
    expect(audit.metadata).toMatchObject({ trancheId: fixture.tranche, quantity: 3, operationalReference: 'dock-ref', idempotencyKey: key, outcome: 'RECORDED' });
    expect(new Date(audit.metadata.deliveredAt).toISOString()).toBe(timestamp);
  });

  it('rolls back both event and success audit when the calling transaction rolls back', async () => {
    const fixture = await createFixture(baseA);
    const executor = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
    const key = id();
    const correlation = id();
    await executor.connect();
    try {
      await executor.query('BEGIN');
      await executor.query(`SELECT public.internal_supplier_po_delivery_execution_record($1,$2,3,'2030-04-05T12:30:00Z',NULL,$3,$4)`, [recordActor, fixture.tranche, key, correlation]);
      await executor.query('ROLLBACK');
    } finally { await executor.end(); }
    expect((await owner.query(`SELECT count(*)::int AS count FROM supplier_po_delivery_execution_events WHERE tranche_id=$1 AND idempotency_key=$2`, [fixture.tranche, key])).rows[0].count).toBe(0);
    expect((await owner.query(`SELECT count(*)::int AS count FROM audit_logs WHERE action='supplier_po.delivery.execution_recorded' AND correlation_id=$1`, [correlation])).rows[0].count).toBe(0);
  });

  it('leaves PO, allocation, commitment, release, coverage, and scheduled tranche quantity unchanged', async () => {
    const fixture = await createFixture(baseA);
    const readState = async () => (await owner.query(`
      SELECT t.quantity AS scheduled_quantity, po.status AS po_status, po.total_actual_purchase_cost,
             a.allocated_quantity, rl.released_quantity, ccl.quantity AS commitment_quantity,
             (SELECT count(*)::int FROM supplier_po_coverage_bindings b WHERE b.supplier_po_release_line_allocation_id=a.id) AS coverage_count
        FROM supplier_po_delivery_tranches t
        JOIN supplier_po_release_line_allocations a ON a.id=t.supplier_po_release_line_allocation_id
        JOIN supplier_purchase_order_lines pol ON pol.id=t.supplier_purchase_order_line_id
        JOIN supplier_purchase_orders po ON po.id=pol.supplier_purchase_order_id
        JOIN procurement_release_lines rl ON rl.id=a.procurement_release_line_id
        JOIN commercial_commitment_lines ccl ON ccl.id=rl.commercial_commitment_line_id
       WHERE t.id=$1
    `, [fixture.tranche])).rows[0];
    const before = await readState();
    await record(recordActor, fixture.tranche, 4);
    expect(await readState()).toEqual(before);
  });

  it('keeps supplier confirmation facts and partner/supplier projections unchanged', async () => {
    const fixture = await createFixture(baseA);
    const confirmationBefore = (await owner.query(`SELECT confirmed_quantity_delta,promised_delivery_date FROM supplier_po_line_confirmation_events WHERE id=$1`, [fixture.confirmationEvent])).rows[0];
    const trancheBefore = (await owner.query(`SELECT quantity,status FROM supplier_po_delivery_tranches WHERE id=$1`, [fixture.tranche])).rows[0];
    await record(recordActor, fixture.tranche, 4);
    expect((await owner.query(`SELECT confirmed_quantity_delta,promised_delivery_date FROM supplier_po_line_confirmation_events WHERE id=$1`, [fixture.confirmationEvent])).rows[0]).toEqual(confirmationBefore);
    expect((await owner.query(`SELECT quantity,status FROM supplier_po_delivery_tranches WHERE id=$1`, [fixture.tranche])).rows[0]).toEqual(trancheBefore);
  });

  it('enforces RLS, FORCE RLS, narrow grants, and fixed SECURITY DEFINER search paths', async () => {
    const table = (await owner.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.supplier_po_delivery_execution_events'::regclass`)).rows[0];
    expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const grants = (await owner.query(`SELECT has_table_privilege('sco_runtime','public.supplier_po_delivery_execution_events','SELECT') runtime_select,has_table_privilege('sco_internal_executor','public.supplier_po_delivery_execution_events','SELECT') internal_select,has_function_privilege('public','public.internal_supplier_po_delivery_execution_record(uuid,uuid,numeric,timestamp with time zone,text,text,text)','EXECUTE') public_record,has_function_privilege('sco_runtime','public.internal_supplier_po_delivery_execution_record(uuid,uuid,numeric,timestamp with time zone,text,text,text)','EXECUTE') runtime_record,has_function_privilege('sco_internal_executor','public.internal_supplier_po_delivery_execution_record(uuid,uuid,numeric,timestamp with time zone,text,text,text)','EXECUTE') internal_record`)).rows[0];
    expect(grants).toEqual({ runtime_select: false, internal_select: false, public_record: false, runtime_record: false, internal_record: true });
    const functions = (await owner.query(`SELECT p.proname,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('internal_supplier_po_delivery_execution_record','internal_supplier_po_delivery_execution_get')`)).rows;
    expect(functions).toHaveLength(2);
    expect(functions.every((fn: any) => fn.prosecdef && fn.proconfig?.some((value: string) => value.replace(/\s/g,'') === 'search_path=pg_catalog,public'))).toBe(true);
  });

  it('keeps the event ledger limited to 11-A physical facts without downstream state', async () => {
    const fixture = await createFixture(baseA);
    await record(recordActor, fixture.tranche, 1);
    const columns = (await owner.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_po_delivery_execution_events' ORDER BY ordinal_position`)).rows.map((row: any) => row.column_name);
    expect(columns).toEqual(['id', 'tranche_id', 'delivered_quantity', 'delivered_at', 'operational_reference', 'actor_user_id', 'idempotency_key', 'correlation_id', 'created_at']);
  });

  it('does not expose delivered progress through the Partner projection in 11-A', async () => {
    const fixture = await createFixture(baseA);
    await record(recordActor, fixture.tranche, 3);
    const projectionColumns = (await owner.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_po_delivery_execution_events'`)).rows.map((row: any) => row.column_name);
    expect(projectionColumns).not.toContain('partner_company_id');
    expect(projectionColumns).not.toContain('purchase_source_id');
  });
});