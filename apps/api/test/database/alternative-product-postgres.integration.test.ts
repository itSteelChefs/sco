import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
const knownId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('AlternativeProductProposal PostgreSQL confidentiality', () => {
  it('fails closed for an unauthorized runtime context with a known UUID', async () => {
    await runtime.connect();
    await runtime.query('BEGIN');
    try {
      await expect(runtime.query('SELECT id FROM alternative_product_proposals WHERE id=$1', [knownId])).rejects.toThrow(/permission denied/i);
      await runtime.query('ROLLBACK');
    } catch (error) { await runtime.query('ROLLBACK'); throw error; }
  });
  it('keeps the proposal table forced behind SCO internal RLS', async () => {
    const result = await runtime.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='alternative_product_proposals'`);
    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
  afterAll(async () => runtime.end());
});
