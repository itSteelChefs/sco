import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const a = '80000000-0000-4000-8000-000000000001';
const b = '80000000-0000-4000-8000-000000000002';
const u = '80000000-0000-4000-8000-000000000010';

describe('Procurement document extraction foundation', () => {
  beforeAll(async () => {
    await owner.query('DELETE FROM procurement_documents WHERE company_id IN ($1,$2)', [a,b]);
    await owner.query('DELETE FROM documents WHERE company_id IN ($1,$2)', [a,b]);
    await owner.query('DELETE FROM "User" WHERE id=$1', [u]);
    await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2)', [a,b]);
    await owner.query(`INSERT INTO "Company" (id,name,type) VALUES ($1,'Doc A','PARTNER'),($2,'Doc B','PARTNER')`, [a,b]);
    await owner.query(`INSERT INTO "User" (id,email,"passwordHash") VALUES ($1,'doc@sco.test','test')`, [u]);
  });
  afterAll(async () => { await owner.query('DELETE FROM procurement_documents WHERE company_id IN ($1,$2)', [a,b]); await owner.query('DELETE FROM documents WHERE company_id IN ($1,$2)', [a,b]); await owner.query('DELETE FROM "User" WHERE id=$1', [u]); await owner.query('DELETE FROM "Company" WHERE id IN ($1,$2)', [a,b]); await owner.end(); await runtime.end(); });

  it('isolates documents and lines by tenant context', async () => {
    const client = await runtime.connect();
    try { await client.query('BEGIN'); await client.query("SELECT set_config('app.tenant_id',$1,true)",[a]); const d=await client.query(`INSERT INTO documents (company_id,uploader_user_id,filename,detected_mime_type,byte_size,storage_key,sha256,status) VALUES ($1,$2,'a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1,'a-key','hash','AVAILABLE') RETURNING id`,[a,u]); const pd=await client.query(`INSERT INTO procurement_documents (company_id,uploader_user_id,document_id,filename,document_type) VALUES ($1,$2,$3,'a.xlsx','BOQ') RETURNING id`,[a,u,d.rows[0].id]); await client.query(`INSERT INTO procurement_document_lines (company_id,document_id,raw_value,description,quantity,unit) VALUES ($1,$2,'{"raw":"Gree 20TR"}'::jsonb,'Gree 20TR',2,'EA')`,[a,pd.rows[0].id]); await client.query("SELECT set_config('app.tenant_id',$1,true)",[b]); expect((await client.query('SELECT id FROM procurement_documents WHERE id=$1',[pd.rows[0].id])).rowCount).toBe(0); expect((await client.query('SELECT id FROM procurement_document_lines WHERE document_id=$1',[pd.rows[0].id])).rowCount).toBe(0); await client.query('ROLLBACK'); } finally { client.release(); }
  });

  it('preserves raw extraction values and provider metadata', async () => {
    const client = await runtime.connect();
    try { await client.query('BEGIN'); await client.query("SELECT set_config('app.tenant_id',$1,true)",[a]); const d=await client.query(`INSERT INTO documents (company_id,uploader_user_id,filename,detected_mime_type,byte_size,storage_key,sha256,status) VALUES ($1,$2,'b.pdf','application/pdf',1,'b-key','hash','AVAILABLE') RETURNING id`,[a,u]); const pd=await client.query(`INSERT INTO procurement_documents (company_id,uploader_user_id,document_id,filename,document_type,extraction_status) VALUES ($1,$2,$3,'b.pdf','BOQ','READY_FOR_REVIEW') RETURNING id`,[a,u,d.rows[0].id]); await client.query(`INSERT INTO procurement_document_lines (company_id,document_id,raw_value,description,normalized_value,extraction_metadata) VALUES ($1,$2,'{"raw":" Gree 20TR "}'::jsonb,'Gree 20TR','{"brand":"Gree"}'::jsonb,'{"provider":"deterministic-test"}'::jsonb)`,[a,pd.rows[0].id]); const row=await client.query(`SELECT raw_value,normalized_value,extraction_metadata FROM procurement_document_lines WHERE document_id=$1`,[pd.rows[0].id]); expect(row.rows[0].raw_value.raw).toBe(' Gree 20TR '); expect(row.rows[0].normalized_value.brand).toBe('Gree'); expect(row.rows[0].extraction_metadata.provider).toBe('deterministic-test'); await client.query('ROLLBACK'); } finally { client.release(); }
  });
});
