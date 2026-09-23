import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
describe('Batch 6 execution schema', () => {
  it('defines immutable allocation and idempotency columns', async () => {
    const result = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('procurement_cycles','procurement_executions','procurement_execution_items','ready_allocation_events')`);
    expect(result.rows.map((r) => r.table_name).sort()).toEqual(['procurement_cycles','procurement_execution_items','procurement_executions','ready_allocation_events']);
    const columns = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='procurement_execution_items'`);
    expect(columns.rows.map((r) => r.column_name)).toEqual(expect.arrayContaining(['idempotency_key','allocated_quantity','consumed_quantity','remaining_quantity']));
    await pool.end();
  });
});
