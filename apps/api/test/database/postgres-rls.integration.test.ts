import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const companyA = '00000000-0000-4000-8000-000000000001';
const companyB = '00000000-0000-4000-8000-000000000002';
let client: Client;

async function tenantQuery<T>(tenantId: string | undefined, sql: string, values: unknown[] = []) {
  await client.query('BEGIN');
  try {
    if (tenantId) await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const result = await client.query<T>(sql, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

describe('PostgreSQL RLS with the runtime role', () => {
  beforeAll(async () => {
    client = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => client.end());

  it('returns only company A rows under company A context even when company B UUID is known', async () => {
    const result = await tenantQuery(companyA, 'SELECT id FROM tenant_probes WHERE id = $1', [
      '20000000-0000-4000-8000-000000000002',
    ]);
    expect(result.rows).toEqual([]);
  });

  it('rejects company A update and delete attempts against company B rows', async () => {
    const updated = await tenantQuery(companyA, "UPDATE tenant_probes SET label = 'attack' WHERE id = $1", [
      '20000000-0000-4000-8000-000000000002',
    ]);
    const deleted = await tenantQuery(companyA, 'DELETE FROM tenant_probes WHERE id = $1', [
      '20000000-0000-4000-8000-000000000002',
    ]);
    expect(updated.rowCount).toBe(0);
    expect(deleted.rowCount).toBe(0);
  });

  it('rejects an insert whose company ownership differs from the tenant context', async () => {
    await expect(tenantQuery(companyA,
      "INSERT INTO tenant_probes (id, company_id, label) VALUES ('20000000-0000-4000-8000-000000000003', $1, 'attack')",
      [companyB],
    )).rejects.toMatchObject({ code: '42501' });
  });

  it('cannot turn row security off with the runtime role', async () => {
    await client.query('BEGIN');
    await client.query('SET LOCAL row_security = off');
    await expect(client.query('SELECT id FROM tenant_probes')).rejects.toMatchObject({ code: '42501' });
    await client.query('ROLLBACK');
  });

  it('fails closed without tenant context', async () => {
    const result = await tenantQuery(undefined, 'SELECT id FROM tenant_probes');
    expect(result.rows).toEqual([]);
  });

  it('does not retain tenant context after a transaction ends', async () => {
    await tenantQuery(companyA, 'SELECT id FROM tenant_probes');
    const result = await tenantQuery(undefined, 'SELECT id FROM tenant_probes');
    expect(result.rows).toEqual([]);
  });
});
