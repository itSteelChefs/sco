import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id=()=>randomUUID();
let internal: InternalDatabaseService; let actor:string; let partner:string; let po:string; let line:string; let documentId:string; let versionId:string;
async function newDocument() { const sco=(await owner.query(`SELECT id FROM "Company" WHERE type='SCO' LIMIT 1`)).rows[0].id; const doc=id(); const version=id(); await owner.query(`INSERT INTO documents(id,company_id,uploader_user_id,filename,detected_mime_type,byte_size,storage_key,sha256,status,access_scope) VALUES($1,$2,$3,'supplier-commercial.pdf','application/pdf',10,$4,$5,'AVAILABLE','SCO_INTERNAL')`,[doc,sco,actor,`private/${id()}`,id()]); await owner.query(`INSERT INTO document_versions(id,company_id,document_id,version,storage_key,sha256) VALUES($1,$2,$3,1,$4,$5)`,[version,sco,doc,`private/version/${id()}`,id()]); return {doc,version}; }

async function principal(permission?: string | string[]) {
  const sco=(await owner.query(`SELECT id FROM "Company" WHERE type='SCO' LIMIT 1`)).rows[0].id; const user=id(); const membership=id(); const role=id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`,[user,`${user}@commercial-doc.test`]);
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`,[membership,user,sco]);
  await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3)`,[role,sco,`commercial-${id()}`]);
  await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`,[id(),sco,membership,role]);
  for (const code of (permission ? (Array.isArray(permission) ? permission : [permission]) : [])) await owner.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`,[id(),sco,role,code]);
  return user;
}

describe('Batch 9.6.3-A supplier commercial document foundation',()=>{
  beforeAll(async()=>{
    internal=new InternalDatabaseService(); actor=await principal(['supplier_po.commercial_document.register','supplier_po.commercial_document.read']); partner=await principal('supplier_po.confirm.record');
    const row=(await owner.query(`SELECT p.id,l.id AS line_id,p.supplier_company_id FROM supplier_purchase_orders p JOIN supplier_purchase_order_lines l ON l.supplier_purchase_order_id=p.id WHERE p.status='ISSUED' ORDER BY p.created_at DESC LIMIT 1`)).rows[0]; po=row.id; line=row.line_id;
    const scope=(await owner.query(`SELECT p.purchase_source_id,pi.category_id FROM supplier_purchase_order_lines l JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id JOIN product_identities pi ON pi.id=l.product_identity_id WHERE l.id=$1`,[line])).rows[0];
    await owner.query(`INSERT INTO procurement_engineer_scope_assignments(actor_user_id,purchase_source_id,product_category_id,status,assigned_by) VALUES($1,$2,$3,'ACTIVE',$1) ON CONFLICT DO NOTHING`,[actor,scope.purchase_source_id,scope.category_id]);
    const sco=(await owner.query(`SELECT id FROM "Company" WHERE type='SCO' LIMIT 1`)).rows[0].id; documentId=id(); versionId=id();
    await owner.query(`INSERT INTO documents(id,company_id,uploader_user_id,filename,detected_mime_type,byte_size,storage_key,sha256,status,access_scope) VALUES($1,$2,$3,'supplier-invoice.pdf','application/pdf',10,$4,'hash','AVAILABLE','SCO_INTERNAL')`,[documentId,sco,actor,`private/${id()}`]);
    await owner.query(`INSERT INTO document_versions(id,company_id,document_id,version,storage_key,sha256) VALUES($1,$2,$3,1,$4,'vhash')`,[versionId,sco,documentId,`private/version/${id()}`]);
  });
  afterAll(async()=>{await internal.onModuleDestroy();await owner.end();});

  it('proves document_versions does not leak private parent versions through tenant spoofing',async()=>{
    const runtime=new Client({connectionString:process.env.RUNTIME_DATABASE_URL}); await runtime.connect();
    try { await runtime.query('BEGIN'); await runtime.query(`SELECT set_config('app.tenant_id',$1,true)`,[(await owner.query(`SELECT company_id FROM documents WHERE id=$1`,[documentId])).rows[0].company_id]); expect((await runtime.query(`SELECT storage_key FROM document_versions WHERE id=$1`,[versionId])).rows).toEqual([]); await runtime.query('ROLLBACK'); }
    finally {await runtime.end();}
  });

  it('exposes the commercial document foundation and registers all approved supplier types',async()=>{
    const docs=[] as string[];
    for(const type of ['SUPPLIER_PROFORMA','SUPPLIER_INVOICE','SUPPLIER_COMMERCIAL_SUPPORTING']) { const d=await newDocument(); docs.push(await internal.registerSupplierPOCommercialDocument(actor,po,d.doc,d.version,type,'SCO_INTERNAL_PRIVATE',id())); }
    expect(new Set(docs).size).toBe(3);
    await internal.setSupplierPOCommercialDocumentCoverage(actor,docs[0],line,10,id());
    expect((await internal.getSupplierPOCommercialDocument(actor,docs[0])).document_type).toBe('SUPPLIER_PROFORMA');
  });

  it('preserves multiple documents and exact line coverage without replacing history',async()=>{
    const d1=await newDocument(); const d2=await newDocument();
    const first=await internal.registerSupplierPOCommercialDocument(actor,po,d1.doc,d1.version,'SUPPLIER_PROFORMA','SCO_INTERNAL_PRIVATE',id());
    const second=await internal.registerSupplierPOCommercialDocument(actor,po,d2.doc,d2.version,'SUPPLIER_INVOICE','SCO_INTERNAL_PRIVATE',id());
    expect(first).not.toBe(second);
    await internal.setSupplierPOCommercialDocumentCoverage(actor,first,line,5,id());
    const rows=await owner.query(`SELECT covered_quantity FROM supplier_po_commercial_document_line_coverage WHERE commercial_document_id=$1`,[first]); expect(rows.rows[0].covered_quantity).toBe('5.0000');
  });

  it('denies Supplier Confirmation-only, Partner, and direct runtime access',async()=>{
    await expect(internal.registerSupplierPOCommercialDocument(partner,po,documentId,versionId,'SUPPLIER_INVOICE','SCO_INTERNAL_PRIVATE',id())).rejects.toThrow('SUPPLIER_PO_COMMERCIAL_DOCUMENT_FORBIDDEN');
    const runtime=new Client({connectionString:process.env.RUNTIME_DATABASE_URL}); await runtime.connect(); try { await expect(runtime.query(`SELECT * FROM supplier_po_commercial_documents`)).rejects.toThrow(/permission denied/i); } finally {await runtime.end();}
  });

  it('returns minimum internal metadata and never storage keys',async()=>{
    const d=await newDocument(); const commercial=await internal.registerSupplierPOCommercialDocument(actor,po,d.doc,d.version,'SUPPLIER_INVOICE','SCO_INTERNAL_PRIVATE',id());
    const row=await internal.getSupplierPOCommercialDocument(actor,commercial); expect(row).toHaveProperty('document_id',d.doc); expect(row).not.toHaveProperty('storage_key'); expect(row).not.toHaveProperty('absolute_path');
  });
});
