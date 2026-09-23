import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';
import { DevelopmentStorageProvider } from '../../src/modules/documents/development-storage.provider.js';
import { SupplierQuoteDocumentService } from '../../src/modules/documents/supplier-quote-document.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService;
let storage: DevelopmentStorageProvider;
let service: SupplierQuoteDocumentService;
let internalUser: string;
let partnerUser: string;
let supplierAUser: string;
let supplierBUser: string;
let dualUser: string;
let partnerCompany: string;
let documentId: string;
const filename = 'synthetic-supplier-quote-private.pdf';

async function companyWithUser(type: 'SCO' | 'PARTNER' | 'SUPPLIER') {
  const companyId = id(); const userId = id();
  await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,$2,$3)', [companyId, `${type} quote document`, type]);
  await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\')', [userId, `${userId}@quote-document.test`]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
  return { companyId, userId };
}

async function grant(companyId: string, userId: string, code: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, companyId])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, companyId, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), companyId, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), companyId, role, code]);
}

async function forbiddenResult(actor: string, requestedDocumentId: string) {
  try { await service.metadata(actor, requestedDocumentId); throw new Error('EXPECTED_FORBIDDEN'); }
  catch (error: any) { return error.getResponse?.(); }
}

describe('Supplier quote private document isolation', () => {
  beforeAll(async () => {
    const sco = await companyWithUser('SCO');
    const partner = await companyWithUser('PARTNER');
    const supplierA = await companyWithUser('SUPPLIER');
    const supplierB = await companyWithUser('SUPPLIER');
    const dual = await companyWithUser('PARTNER');
    internalUser = sco.userId; partnerUser = partner.userId; supplierAUser = supplierA.userId; supplierBUser = supplierB.userId; dualUser = dual.userId; partnerCompany = partner.companyId;
    await grant(sco.companyId, internalUser, 'quote.document.read');
    await owner.query('INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,\'BUYER_PARTNERSHIP\',\'ACTIVE\'),($3,$2,\'SUPPLIER_PARTNERSHIP\',\'ACTIVE\')', [id(), dual.companyId, id()]);
    const rfqId = id(); const quoteId = id(); const revisionId = id();
    await owner.query('INSERT INTO rfqs(id,created_by,status) VALUES($1,$2,\'EVALUATION\')', [rfqId, internalUser]);
    const supplierPartnership = id();
    await owner.query('INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,\'SUPPLIER_PARTNERSHIP\',\'ACTIVE\')', [supplierPartnership, supplierA.companyId]);
    const sourceType = (await owner.query('SELECT id FROM purchase_source_type_definitions LIMIT 1')).rows[0].id;
    const source = id();
    await owner.query('INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,created_by) VALUES($1,$2,$3,$4,$5,$6)', [source, supplierA.companyId, supplierPartnership, `quote-doc-${source}`, sourceType, internalUser]);
    await owner.query('INSERT INTO supplier_quotes(id,rfq_id,purchase_source_id,supplier_company_id,created_by) VALUES($1,$2,$3,$4,$5)', [quoteId, rfqId, source, supplierA.companyId, internalUser]);
    await owner.query('INSERT INTO supplier_quote_revisions(id,supplier_quote_id,revision_number,initiated_by,currency_code) VALUES($1,$2,1,$3,\'SAR\')', [revisionId, quoteId, internalUser]);
    storage = new DevelopmentStorageProvider();
    const staged = await storage.stage({ storageKey: `quote-documents/${id()}`, content: new TextEncoder().encode('private quote content') });
    documentId = id();
    await owner.query('INSERT INTO documents(id,company_id,uploader_user_id,filename,detected_mime_type,byte_size,storage_key,sha256,status,access_scope) VALUES($1,$2,$3,$4,\'application/pdf\',$5,$6,$7,\'AVAILABLE\',\'SCO_INTERNAL\')', [documentId, sco.companyId, internalUser, filename, staged.byteSize, staged.storageKey, staged.sha256]);
    await owner.query('INSERT INTO supplier_quote_documents(supplier_quote_revision_id,document_id,linked_by) VALUES($1,$2,$3)', [revisionId, documentId, internalUser]);
    internal = new InternalDatabaseService();
    service = new SupplierQuoteDocumentService(internal, storage);
  });

  afterAll(async () => { await internal.onModuleDestroy(); await owner.end(); });

  it('allows only authorized SCO Internal metadata and content without a storage URL', async () => {
    await expect(service.metadata(internalUser, documentId)).resolves.toEqual({ filename, mimeType: 'application/pdf', byteSize: 21 });
    const content = await service.content(internalUser, documentId);
    expect(new TextDecoder().decode(content.content)).toBe('private quote content');
    expect(content).not.toHaveProperty('storageKey'); expect(content).not.toHaveProperty('absolutePath'); expect(content).not.toHaveProperty('url');
  });

  it('denies partner, supplier A, supplier B, and dual buyer/supplier users without an existence oracle', async () => {
    for (const actor of [partnerUser, supplierAUser, supplierBUser, dualUser]) {
      await expect(forbiddenResult(actor, documentId)).resolves.toEqual({ error: { code: 'FORBIDDEN' } });
      await expect(forbiddenResult(actor, id())).resolves.toEqual({ error: { code: 'FORBIDDEN' } });
      await expect(service.content(actor, documentId)).rejects.toMatchObject({ response: { error: { code: 'FORBIDDEN' } } });
    }
  });

  it('RLS hides private document metadata from runtime tenant and spoofed internal settings', async () => {
    const client = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
    await client.connect(); await client.query('BEGIN');
    try {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [partnerCompany]);
      expect((await client.query('SELECT filename,storage_key FROM documents WHERE id=$1', [documentId])).rowCount).toBe(0);
      await client.query("SELECT set_config('app.sco_internal','true',true)");
      expect((await client.query('SELECT filename,storage_key FROM documents WHERE id=$1', [documentId])).rowCount).toBe(0);
      await expect(client.query('SELECT * FROM supplier_quote_documents WHERE document_id=$1', [documentId])).rejects.toThrow(/permission denied/i);
    } finally { await client.query('ROLLBACK'); await client.end(); }
  });
});
