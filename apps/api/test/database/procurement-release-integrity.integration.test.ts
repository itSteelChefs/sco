import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
let runtime: Client; let executor: Client;

describe('Batch 9.5 procurement release integrity', () => {
  beforeAll(async () => {
    runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
    executor = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
    await runtime.connect(); await executor.connect();
  });
  afterAll(async () => { await runtime.end(); await executor.end(); await owner.end(); });

  it('has protected release, line, allocation, deallocation, and reconfirmation tables', async () => {
    const rows = (await owner.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('procurement_releases','procurement_release_lines','procurement_funding_allocations','procurement_funding_deallocations','supplier_reconfirmations') ORDER BY relname`)).rows;
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it('denies direct runtime DML on every protected release table', async () => {
    for (const table of ['procurement_releases','procurement_release_lines','procurement_funding_allocations','procurement_funding_deallocations','supplier_reconfirmations']) {
      await expect(runtime.query(`UPDATE ${table} SET id=id WHERE false`)).rejects.toThrow(/permission denied/i);
    }
  });

  it('denies direct internal-executor DML even with spoofed coordination context', async () => {
    await executor.query("SELECT set_config('app.procurement_release_gateway','true',true), set_config('app.sco_internal','true',true)");
    for (const table of ['procurement_releases','procurement_release_lines','procurement_funding_allocations','procurement_funding_deallocations','supplier_reconfirmations']) {
      await expect(executor.query(`UPDATE ${table} SET id=id WHERE false`)).rejects.toThrow(/permission denied/i);
    }
  });

  it('revokes public execute and exposes only the intended executor gateways', async () => {
    const rows = (await owner.query(`SELECT p.proname, has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute, has_function_privilege('sco_internal_executor', p.oid, 'EXECUTE') AS executor_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('internal_procurement_release_execute','internal_procurement_release_withdraw','internal_supplier_reconfirmation_create')`)).rows;
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.public_execute === false && row.executor_execute === true)).toBe(true);
  });

  it('requires a concrete funding source for every allocation type', async () => {
    const constraints = (await owner.query(`SELECT conname FROM pg_constraint WHERE conrelid='procurement_funding_allocations'::regclass AND conname='procurement_funding_allocation_source_ck'`)).rows;
    expect(constraints).toHaveLength(1);
    const indexes = (await owner.query(`SELECT indexname FROM pg_indexes WHERE tablename='procurement_funding_allocations' AND indexname IN ('procurement_funding_customer_source_once','procurement_funding_internal_source_once')`)).rows;
    expect(indexes).toHaveLength(0);
  });

  it('does not create a Supplier Purchase Order or supplier payment object', async () => {
    const po = (await owner.query(`SELECT to_regclass('public.sco_supplier_purchase_orders') AS po, to_regclass('public.supplier_payment_executions') AS payment`)).rows[0];
    expect(po.po).toBeNull(); expect(po.payment).toBeNull();
  });
});
