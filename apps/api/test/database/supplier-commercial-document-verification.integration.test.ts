import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService;
let actor: string, unauthorized: string, po: string, line: string, commercial: string, version: string;
let source: string, product: string, unit: string, quantity: string, cost: string, totalAmount: string, currency: string;

async function principal(permissions: string[]) {
  const sco = (await owner.query(`SELECT id FROM "Company" WHERE type='SCO' LIMIT 1`)).rows[0].id;
  const user = id(), membership = id(), role = id(), code = `verify-${id()}`;
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [user, `${user}@verify.test`]);
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membership, user, sco]);
  await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3)`, [role, sco, code]);
  await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(), sco, membership, role]);
  for (const permission of permissions) await owner.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`, [id(), sco, role, permission]);
  return user;
}

describe('Batch 9.6.3-B supplier commercial document verification', () => {
  beforeAll(async () => {
    internal = new InternalDatabaseService();
    actor = await principal(['supplier_po.commercial_document.read', 'supplier_po.commercial_document.verify', 'supplier_po.commercial_document.register']);
    unauthorized = await principal([]);
    const row = (await owner.query(`
      SELECT p.id, l.id AS line_id, p.purchase_source_id, l.product_identity_id, l.unit_id,
             l.ordered_quantity, l.actual_unit_purchase_cost, (l.ordered_quantity*l.actual_unit_purchase_cost)::text AS total_amount, p.currency_code, pi.category_id
      FROM supplier_purchase_orders p
      JOIN supplier_purchase_order_lines l ON l.supplier_purchase_order_id=p.id
      JOIN product_identities pi ON pi.id=l.product_identity_id
      WHERE p.status='ISSUED'
        AND p.id IN (SELECT supplier_purchase_order_id FROM supplier_purchase_order_lines GROUP BY supplier_purchase_order_id HAVING count(*)=1)
      ORDER BY p.created_at DESC LIMIT 1
    `)).rows[0];
    po=row.id; line=row.line_id; source=row.purchase_source_id; product=row.product_identity_id; unit=row.unit_id;
    quantity=row.ordered_quantity; cost=row.actual_unit_purchase_cost; totalAmount=row.total_amount; currency=row.currency_code;
    await owner.query(`INSERT INTO procurement_engineer_scope_assignments(actor_user_id,purchase_source_id,product_category_id,status,assigned_by) VALUES($1,$2,$3,'ACTIVE',$1) ON CONFLICT DO NOTHING`, [actor, source, row.category_id]);
    const sco=(await owner.query(`SELECT id FROM "Company" WHERE type='SCO' LIMIT 1`)).rows[0].id;
    const document=id(); version=id();
    await owner.query(`INSERT INTO documents(id,company_id,uploader_user_id,filename,detected_mime_type,byte_size,storage_key,sha256,status,access_scope) VALUES($1,$2,$3,'verification.pdf','application/pdf',10,$4,$5,'AVAILABLE','SCO_INTERNAL')`, [document,sco,actor,`verify/${id()}`,id()]);
    await owner.query(`INSERT INTO document_versions(id,company_id,document_id,version,storage_key,sha256) VALUES($1,$2,$3,1,$4,$5)`, [version,sco,document,`verify/version/${id()}`,id()]);
    commercial=await internal.registerSupplierPOCommercialDocument(actor,po,document,version,'SUPPLIER_INVOICE','SCO_INTERNAL_PRIVATE',id());
  });
  afterAll(async()=>{ await internal.onModuleDestroy(); await owner.end(); });
  const facts=()=>({ purchaseSourceId:source, currency, commercialBasis:'PO_PURCHASE_COST', lines:[{ lineId:line, productIdentityId:product, unitId:unit, quantity, unitPurchaseCost:cost, amount:totalAmount }], totalAmount, taxAmount:0 });
  it('returns MATCHED for exact commercial facts', async()=>{ expect((await internal.verifySupplierPOCommercialDocument(actor,commercial,facts(),id())).result).toBe('MATCHED'); });
  it('returns structured MISMATCH for amount currency quantity and product differences', async()=>{ for(const change of [{totalAmount:999},{currency:'USD'},{lines:[{...facts().lines[0],quantity:1}]},{lines:[{...facts().lines[0],productIdentityId:id()}]}]) { const result=await internal.verifySupplierPOCommercialDocument(actor,commercial,{...facts(),...change},id()); expect(result.result).toBe('MISMATCH'); expect(result.mismatch_reasons.length).toBeGreaterThan(0); } });
  it('never returns MATCHED when essential facts are missing', async()=>{ expect((await internal.verifySupplierPOCommercialDocument(actor,commercial,{currency},id())).result).toBe('MISMATCH'); });
  it('preserves immutable verification history and exact document version lineage', async()=>{ const rows=(await owner.query(`SELECT document_version_id FROM supplier_po_commercial_document_verifications WHERE commercial_document_id=$1`,[commercial])).rows; expect(rows.length).toBeGreaterThanOrEqual(1); expect(rows.every(row=>row.document_version_id===version)).toBe(true); await expect(owner.query(`UPDATE supplier_po_commercial_document_verifications SET result='MATCHED' WHERE commercial_document_id=$1`,[commercial])).rejects.toThrow(/IMMUTABLE/i); });
  it('rejects unauthorized verification and keeps PO/source/cost unchanged', async()=>{ await expect(internal.verifySupplierPOCommercialDocument(unauthorized,commercial,facts(),id())).rejects.toThrow('SUPPLIER_PO_COMMERCIAL_DOCUMENT_VERIFY_FORBIDDEN'); const row=(await owner.query(`SELECT status,purchase_source_id,currency_code FROM supplier_purchase_orders WHERE id=$1`,[po])).rows[0]; expect(row.status).toBe('ISSUED'); expect(row.purchase_source_id).toBe(source); });
  it('records verification audit with actor and correlation id', async()=>{ const correlation=id(); const result=await internal.verifySupplierPOCommercialDocument(actor,commercial,facts(),correlation); const audit=(await owner.query(`SELECT actor_user_id,action,entity_id,correlation_id FROM audit_logs WHERE action='supplier_po.commercial_document.verified' AND entity_id=$1 AND correlation_id=$2`,[result.id,correlation])).rows[0]; expect(audit).toMatchObject({actor_user_id:actor,correlation_id:correlation}); });
  it('does not mutate Purchase Coverage or Supplier Confirmation lineage', async()=>{ const before=(await owner.query(`SELECT count(*)::int AS count FROM supplier_po_coverage_bindings b JOIN supplier_po_release_line_allocations a ON a.id=b.supplier_po_release_line_allocation_id JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id WHERE l.supplier_purchase_order_id=$1`,[po])).rows[0].count; await internal.verifySupplierPOCommercialDocument(actor,commercial,facts(),id()); const after=(await owner.query(`SELECT count(*)::int AS count FROM supplier_po_coverage_bindings b JOIN supplier_po_release_line_allocations a ON a.id=b.supplier_po_release_line_allocation_id JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id WHERE l.supplier_purchase_order_id=$1`,[po])).rows[0].count; expect(after).toBe(before); });
});
