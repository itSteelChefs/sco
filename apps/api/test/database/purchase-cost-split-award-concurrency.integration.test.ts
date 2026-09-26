import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
const runtime = () => new Client({ connectionString: process.env.DATABASE_URL });
let company: string;
let creator: string;
let approver: string;
let supplier: string;
let product: string;
let unit: string;
let project: string;
let source: string;

type Fixture = { rfqId: string; rfqItemId: string };

async function revision(rfqId: string) {
  const quote = id(); const revisionId = id();
  await owner.query('INSERT INTO supplier_quotes(id,rfq_id,purchase_source_id,supplier_company_id,created_by) VALUES($1,$2,$3,$4,$5)', [quote, rfqId, source, supplier, creator]);
  await owner.query('INSERT INTO supplier_quote_revisions(id,supplier_quote_id,revision_number,initiated_by,currency_code) VALUES($1,$2,1,$3,\'SAR\')', [revisionId, quote, creator]);
  return revisionId;
}

async function fixture(): Promise<Fixture> {
  const need = id(); const cycle = id(); const execution = id(); const executionItem = id(); const rfqId = id(); const rfqItemId = id();
  await owner.query('INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,unit_id,need_date,maturity,review_status) VALUES($1,$2,$3,$4,\'MANUAL\',$5,\'race\',1000,$6,current_date,\'READY\',\'APPROVED\')', [need, company, project, creator, product, unit]);
  await owner.query('INSERT INTO procurement_cycles(id,cycle_code,name,intake_opens_at,intake_closes_at,status) VALUES($1,$2,\'race\',now(),now(),\'PROCESSING\')', [cycle, `race-${cycle}`]);
  await owner.query('INSERT INTO procurement_executions(id,cycle_id,status,created_by) VALUES($1,$2,\'SOURCING_READY\',$3)', [execution, cycle, creator]);
  await owner.query('INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status) VALUES($1,$2,$3,$4,$5,$6,1000,1000,$7,current_date,$8,$9,\'SOURCING_READY\')', [executionItem, execution, company, project, need, product, unit, id(), creator]);
  await owner.query('INSERT INTO rfqs(id,created_by,status) VALUES($1,$2,\'EVALUATION\')', [rfqId, creator]);
  await owner.query('INSERT INTO rfq_items(id,rfq_id,execution_item_id,company_id,project_id,procurement_need_id,product_identity_id,requested_quantity,unit_id) VALUES($1,$2,$3,$4,$5,$6,$7,1000,$8)', [rfqItemId, rfqId, executionItem, company, project, need, product, unit]);
  return { rfqId, rfqItemId };
}

function snapshotSql() {
  return `INSERT INTO approved_purchase_cost_snapshots(rfq_item_id,supplier_quote_revision_id,purchase_source_id,supplier_company_id,product_identity_id,approved_quantity,currency_code,unit_purchase_cost,amount_excl_tax,amount_incl_tax,status,approved_by,approved_at,approval_reason,created_by) VALUES($1,$2,$3,$4,$5,400,'SAR',10,4000,4000,'APPROVED',$6,now(),'race',$6)`;
}

async function insertSnapshot(client: { query: Client['query'] }, itemId: string, revisionId: string) {
  return client.query(snapshotSql(), [itemId, revisionId, source, supplier, product, approver]);
}

async function total(itemId: string) {
  return (await owner.query('SELECT count(*)::int AS snapshots, COALESCE(sum(approved_quantity),0)::text AS total FROM approved_purchase_cost_snapshots WHERE rfq_item_id=$1 AND status=\'APPROVED\'', [itemId])).rows[0];
}

async function waitForLock(pid: number) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await owner.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid]);
    if (result.rows[0]?.wait_event_type === 'Lock') return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return false;
}

describe('Purchase cost split award real PostgreSQL concurrency', () => {
  beforeAll(async () => {
    company = id(); creator = id(); approver = id(); supplier = id();
    const category = id(); const partnership = id();
    await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,\'SCO race\',\'SCO\'),($2,\'Supplier race\',\'SUPPLIER\')', [company, supplier]);
    await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\'),($3,$4,\'x\')', [creator, `${creator}@race.test`, approver, `${approver}@race.test`]);
    await owner.query('INSERT INTO product_categories(id,code,name) VALUES($1,$2,\'Race category\')', [category, `race-${category}`]);
    unit = id(); await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,\'Unit\',\'count\')', [unit, `race-${unit.slice(0, 8)}`]);
    product = id(); await owner.query('INSERT INTO product_identities(id,category_id,unit_id,created_by,status) VALUES($1,$2,$3,$4,\'ACTIVE\')', [product, category, unit, creator]);
    project = id(); await owner.query('INSERT INTO projects(id,company_id,code,name,status,created_by) VALUES($1,$2,$3,\'Race project\',\'ACTIVE\',$4)', [project, company, `race-${project}`, creator]);
    await owner.query('INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,\'SUPPLIER_PARTNERSHIP\',\'ACTIVE\')', [partnership, supplier]);
    const sourceType = (await owner.query('SELECT id FROM purchase_source_type_definitions LIMIT 1')).rows[0].id;
    source = id(); await owner.query('INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,created_by) VALUES($1,$2,$3,$4,$5,$6)', [source, supplier, partnership, `race-${source}`, sourceType, creator]);
  });

  afterAll(async () => { await owner.end(); });

  it('allows at most one competing +400 allocation in five real two-connection races', async () => {
    for (let iteration = 1; iteration <= 5; iteration += 1) {
      const record = await fixture();
      await insertSnapshot(owner, record.rfqItemId, await revision(record.rfqId));
      await expect(total(record.rfqItemId)).resolves.toEqual({ snapshots: 1, total: '400.0000' });
      const transactionA = runtime(); const transactionB = runtime();
      await transactionA.connect(); await transactionB.connect();
      await transactionA.query('BEGIN'); await transactionB.query('BEGIN');
      await transactionA.query("SELECT set_config('app.sco_internal','true',true); SET LOCAL statement_timeout='5s'");
      await transactionB.query("SELECT set_config('app.sco_internal','true',true); SET LOCAL statement_timeout='5s'");
      const transactionBPid = (await transactionB.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      try {
        await insertSnapshot(transactionA, record.rfqItemId, await revision(record.rfqId));
        const competing = insertSnapshot(transactionB, record.rfqItemId, await revision(record.rfqId)).then(
          () => ({ status: 'fulfilled' as const }),
          (error: unknown) => ({ status: 'rejected' as const, error }),
        );
        expect(await waitForLock(transactionBPid)).toBe(true);
        await transactionA.query('COMMIT');
        const competingResult = await competing;
        expect(competingResult.status).toBe('rejected');
        if (competingResult.status === 'rejected') expect(competingResult.error).toMatchObject({ message: 'APPROVED_QUANTITY_EXCEEDED' });
        await transactionB.query('ROLLBACK');
      } finally {
        await transactionA.end(); await transactionB.end();
      }
      await expect(total(record.rfqItemId)).resolves.toEqual({ snapshots: 2, total: '800.0000' });
    }
  }, 30000);
});
