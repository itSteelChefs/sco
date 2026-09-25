import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService;

async function principal(permission: string) {
  const actor=id(); const sco=(await owner.query(`SELECT id FROM "Company" WHERE type='SCO' LIMIT 1`)).rows[0].id; const membership=id(); const role=id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`,[actor,`${actor}@scoped-po.test`]);
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`,[membership,actor,sco]);
  await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3)`,[role,sco,`scoped-${id()}`]);
  await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`,[id(),sco,membership,role]);
  await owner.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`,[id(),sco,role,permission]);
  return actor;
}

describe('Batch 9.6.1 Supplier PO scoped visibility', () => {
  beforeAll(async () => { internal=new InternalDatabaseService(); });
  afterAll(async () => { await internal.onModuleDestroy(); await owner.end(); });

  it('provides only purpose-built scoped visibility and responsibility gateways', async () => {
    const rows = (await owner.query(`SELECT to_regprocedure('public.internal_supplier_po_scoped_get(uuid,uuid)') AS scoped_get, to_regprocedure('public.internal_supplier_po_line_responsibility_set(uuid,uuid,uuid,text)') AS responsibility_set, to_regprocedure('public.internal_supplier_po_lead_set(uuid,uuid,uuid,text)') AS lead_set`)).rows[0];
    expect(rows).toEqual({ scoped_get: 'internal_supplier_po_scoped_get(uuid,uuid)', responsibility_set: 'internal_supplier_po_line_responsibility_set(uuid,uuid,uuid,text)', lead_set: 'internal_supplier_po_lead_set(uuid,uuid,uuid,text)' });
  });

  it('requires both read permission and a valid source/category assignment', async () => {
    const po=(await owner.query(`SELECT p.id,l.id AS line_id,p.purchase_source_id,pi.category_id FROM supplier_purchase_orders p JOIN supplier_purchase_order_lines l ON l.supplier_purchase_order_id=p.id JOIN product_identities pi ON pi.id=l.product_identity_id WHERE p.status='ISSUED' AND (SELECT count(*) FROM supplier_purchase_order_lines lx WHERE lx.supplier_purchase_order_id=p.id)=1 ORDER BY p.created_at DESC LIMIT 1`)).rows[0];
    const engineer=await principal('supplier_po.read_assigned');
    expect(await internal.getScopedSupplierPurchaseOrder(engineer,po.id)).toEqual([]);
    await owner.query(`INSERT INTO procurement_engineer_scope_assignments(actor_user_id,purchase_source_id,product_category_id,status,assigned_by) VALUES($1,$2,$3,'ACTIVE',$1)`,[engineer,po.purchase_source_id,po.category_id]);
    const visible=await internal.getScopedSupplierPurchaseOrder(engineer,po.id);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ po_id: po.id, line_id: po.line_id, purchase_source_id: po.purchase_source_id });
  });

  it('prevents direct table reads for runtime and executor roles', async () => {
    const runtime=new Client({connectionString:process.env.RUNTIME_DATABASE_URL}); const executor=new Client({connectionString:process.env.SCO_INTERNAL_DATABASE_URL});
    await runtime.connect(); await executor.connect();
    try {
      await expect(runtime.query('SELECT * FROM supplier_purchase_orders')).rejects.toThrow(/permission denied/i);
      await expect(executor.query('SELECT * FROM supplier_purchase_orders')).rejects.toThrow(/permission denied/i);
    } finally { await runtime.end(); await executor.end(); }
  });

  it('allows only scoped procurement management to assign line responsibility and Lead Engineer', async () => {
    const po=(await owner.query(`SELECT p.id,l.id AS line_id,p.purchase_source_id,pi.category_id FROM supplier_purchase_orders p JOIN supplier_purchase_order_lines l ON l.supplier_purchase_order_id=p.id JOIN product_identities pi ON pi.id=l.product_identity_id WHERE p.status='ISSUED' ORDER BY p.created_at DESC LIMIT 1`)).rows[0];
    const engineer=await principal('supplier_po.read_assigned');
    await owner.query(`INSERT INTO procurement_engineer_scope_assignments(actor_user_id,purchase_source_id,product_category_id,status,assigned_by) VALUES($1,$2,$3,'ACTIVE',$1)`,[engineer,po.purchase_source_id,po.category_id]);
    await expect(internal.setSupplierPurchaseOrderLineResponsibility(engineer,po.line_id,engineer,id())).rejects.toThrow('SUPPLIER_PO_RESPONSIBILITY_FORBIDDEN');
    await expect(internal.setSupplierPurchaseOrderLead(engineer,po.id,engineer,id())).rejects.toThrow('SUPPLIER_PO_LEAD_FORBIDDEN');
    const manager=await principal('supplier_po.lead.manage');
    await internal.setSupplierPurchaseOrderLineResponsibility(manager,po.line_id,engineer,id());
    await internal.setSupplierPurchaseOrderLead(manager,po.id,engineer,id());
    expect((await owner.query(`SELECT actor_user_id FROM supplier_po_line_responsibilities WHERE supplier_purchase_order_line_id=$1 AND actor_user_id=$2`,[po.line_id,engineer])).rows).toHaveLength(1);
    expect((await owner.query(`SELECT lead_procurement_engineer_id FROM supplier_purchase_orders WHERE id=$1`,[po.id])).rows[0].lead_procurement_engineer_id).toBe(engineer);
  });
});
