import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const ids = { buyer: randomUUID(), supplier: randomUUID(), user: randomUUID(), partnership: randomUUID(), source: randomUUID(), rfq: randomUUID(), quote: randomUUID(), v1: randomUUID(), v2: randomUUID(), category: randomUUID(), unit: randomUUID(), product: randomUUID(), project: randomUUID(), need: randomUUID(), cycle: randomUUID(), execution: randomUUID(), executionItem: randomUUID(), rfqItem: randomUUID(), v1Item: randomUUID(), v2Item: randomUUID() };

describe('SupplierQuote persisted revision immutability', () => {
  beforeAll(async () => {
    const sourceType = (await owner.query('SELECT id FROM purchase_source_type_definitions LIMIT 1')).rows[0].id;
    await owner.query('INSERT INTO "User" (id,email,"passwordHash") VALUES($1,$2,$3)', [ids.user, `${ids.user}@sco.test`, 'test']);
    await owner.query('INSERT INTO "Company" (id,name,type) VALUES($1,$2,\'PARTNER\'),($3,$4,\'SUPPLIER\')', [ids.buyer, 'Quote Buyer', ids.supplier, 'Quote Supplier']);
    await owner.query('INSERT INTO product_categories(id,code,name) VALUES($1,$2,$3)', [ids.category, `q-${ids.category}`, 'Quote Category']);
    await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,$3,$4)', [ids.unit, `U-${ids.unit.slice(0,8)}`, 'Unit', 'count']);
    await owner.query('INSERT INTO product_identities(id,category_id,unit_id,created_by,status) VALUES($1,$2,$3,$4,\'ACTIVE\')', [ids.product,ids.category,ids.unit,ids.user]);
    await owner.query('INSERT INTO projects(id,company_id,code,name,status,created_by) VALUES($1,$2,$3,$4,\'ACTIVE\',$5)', [ids.project,ids.buyer,`P-${ids.project.slice(0,8)}`,'Quote Project',ids.user]);
    await owner.query('INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,unit_id,need_date,maturity,review_status) VALUES($1,$2,$3,$4,\'MANUAL\',$5,\'Quote need\',10,$6,current_date,\'READY\',\'APPROVED\')', [ids.need,ids.buyer,ids.project,ids.user,ids.product,ids.unit]);
    await owner.query('INSERT INTO procurement_cycles(id,cycle_code,name,intake_opens_at,intake_closes_at,status) VALUES($1,$2,$3,now(),now(),\'PROCESSING\')', [ids.cycle,`C-${ids.cycle.slice(0,8)}`,'Quote Cycle']);
    await owner.query('INSERT INTO procurement_executions(id,cycle_id,status,created_by) VALUES($1,$2,\'SOURCING_READY\',$3)', [ids.execution,ids.cycle,ids.user]);
    await owner.query('INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status) VALUES($1,$2,$3,$4,$5,$6,10,10,$7,current_date,$8,$9,\'SOURCING_READY\')', [ids.executionItem,ids.execution,ids.buyer,ids.project,ids.need,ids.product,ids.unit,`K-${ids.executionItem}`,ids.user]);
    await owner.query('INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,\'SUPPLIER_PARTNERSHIP\',\'ACTIVE\')', [ids.partnership, ids.supplier]);
    await owner.query('INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,created_by) VALUES($1,$2,$3,$4,$5,$6)', [ids.source, ids.supplier, ids.partnership, `SRC-${ids.source}`, sourceType, ids.user]);
    await owner.query('INSERT INTO rfqs(id,created_by,status) VALUES($1,$2,\'EVALUATION\')', [ids.rfq, ids.user]);
    await owner.query('INSERT INTO rfq_items(id,rfq_id,execution_item_id,company_id,project_id,procurement_need_id,product_identity_id,requested_quantity,unit_id) VALUES($1,$2,$3,$4,$5,$6,$7,10,$8)', [ids.rfqItem,ids.rfq,ids.executionItem,ids.buyer,ids.project,ids.need,ids.product,ids.unit]);
    await owner.query('INSERT INTO supplier_quotes(id,rfq_id,purchase_source_id,supplier_company_id,quote_reference,created_by) VALUES($1,$2,$3,$4,\'Quote V1\',$5)', [ids.quote, ids.rfq, ids.source, ids.supplier, ids.user]);
    await owner.query('INSERT INTO supplier_quote_revisions(id,supplier_quote_id,revision_number,initiated_by,currency_code,valid_until,original_terms_text) VALUES($1,$2,1,$3,\'SAR\',current_date+10,\'V1 terms\')', [ids.v1, ids.quote, ids.user]);
    await owner.query('INSERT INTO supplier_quote_items(id,revision_id,rfq_item_id,product_identity_id,quoted_quantity,unit_price_excl_tax,tax_amount,amount_incl_tax,notes) VALUES($1,$2,$3,$4,10,100,15,115,\'V1 item\')', [ids.v1Item,ids.v1,ids.rfqItem,ids.product]);
  });
  afterAll(async () => owner.end());
  it('creates V2 without changing V1 and rejects historical mutations', async () => {
    const before = await owner.query('SELECT id,revision_number,currency_code,valid_until,original_terms_text FROM supplier_quote_revisions WHERE id=$1', [ids.v1]);
    const itemBefore = await owner.query('SELECT id,revision_id,quoted_quantity,unit_price_excl_tax,tax_amount,amount_incl_tax,notes FROM supplier_quote_items WHERE id=$1', [ids.v1Item]);
    await owner.query('INSERT INTO supplier_quote_revisions(id,supplier_quote_id,revision_number,supersedes_revision_id,initiated_by,currency_code,valid_until,original_terms_text) VALUES($1,$2,2,$3,$4,\'USD\',current_date+20,\'V2 terms\')', [ids.v2, ids.quote, ids.v1, ids.user]);
    await owner.query('INSERT INTO supplier_quote_items(id,revision_id,rfq_item_id,product_identity_id,quoted_quantity,unit_price_excl_tax,tax_amount,amount_incl_tax,notes) VALUES($1,$2,$3,$4,8,120,0,120,\'V2 item\')', [ids.v2Item,ids.v2,ids.rfqItem,ids.product]);
    const after = await owner.query('SELECT id,revision_number,currency_code,valid_until,original_terms_text FROM supplier_quote_revisions WHERE id=$1', [ids.v1]);
    const v2 = await owner.query('SELECT revision_number,supersedes_revision_id,currency_code FROM supplier_quote_revisions WHERE id=$1', [ids.v2]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(v2.rows[0]).toMatchObject({ revision_number: 2, supersedes_revision_id: ids.v1, currency_code: 'USD' });
    const itemAfter = await owner.query('SELECT id,revision_id,quoted_quantity,unit_price_excl_tax,tax_amount,amount_incl_tax,notes FROM supplier_quote_items WHERE id=$1', [ids.v1Item]);
    expect(itemAfter.rows[0]).toEqual(itemBefore.rows[0]);
    await expect(owner.query('UPDATE supplier_quote_revisions SET currency_code=\'EUR\' WHERE id=$1', [ids.v1])).rejects.toThrow('SUPPLIER_QUOTE_REVISION_IMMUTABLE');
    const fresh = await owner.query('SELECT currency_code FROM supplier_quote_revisions WHERE id=$1', [ids.v1]);
    expect(fresh.rows[0].currency_code).toBe('SAR');
    await expect(owner.query('DELETE FROM supplier_quote_revisions WHERE id=$1', [ids.v1])).rejects.toThrow('SUPPLIER_QUOTE_REVISION_IMMUTABLE');
    await expect(owner.query('UPDATE supplier_quote_items SET unit_price_excl_tax=999 WHERE id=$1', [ids.v1Item])).rejects.toThrow('SUPPLIER_QUOTE_ITEM_IMMUTABLE');
    await expect(owner.query('DELETE FROM supplier_quote_items WHERE id=$1', [ids.v1Item])).rejects.toThrow('SUPPLIER_QUOTE_ITEM_IMMUTABLE');
    const itemFinal = await owner.query('SELECT unit_price_excl_tax FROM supplier_quote_items WHERE id=$1', [ids.v1Item]);
    expect(itemFinal.rows[0].unit_price_excl_tax).toBe('100.000000');
  });
});
