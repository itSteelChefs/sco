import { describe, expect, it } from 'vitest';
import { Client } from 'pg';

describe('Batch 8 buy-side commercial confidentiality', () => {
  it('does not expose RFQs to sco_runtime when app.sco_internal is spoofed', async () => {
    const client = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
    await client.connect();
    await client.query('BEGIN');
    try {
      await client.query("SELECT set_config('app.sco_internal','true',true)");
      await expect(client.query('SELECT id FROM rfqs LIMIT 1')).rejects.toThrow(/permission denied/i);
    } finally { await client.query('ROLLBACK'); await client.end(); }
  });
});
