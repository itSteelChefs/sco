import { describe, expect, it } from 'vitest';
import { TenantTransactionService } from '../../src/database/tenant-transaction.service.js';

describe('tenant transaction context', () => {
  it('sets actor and tenant context transaction-locally before tenant queries', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const database = {
      withActor: async (_actorId: string, callback: (client: { query: (sql: string, values?: unknown[]) => Promise<unknown> }) => Promise<unknown>) =>
        callback({
          query: async (sql, values) => {
            queries.push({ sql, values });
            return { rows: [] };
          },
        }),
    };
    const tenantTx = new TenantTransactionService(database as never);
    const records = await tenantTx.withTenant(
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      async (client) => client.query('SELECT id FROM tenant_probes'),
    );

    expect(queries[0]).toEqual({
      sql: "SELECT set_config('app.tenant_id', $1, true)",
      values: ['00000000-0000-4000-8000-000000000001'],
    });
    expect(records).toEqual({ rows: [] });
  });
});
