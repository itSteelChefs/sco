import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });

const commercialTables = [
  'commercial_purchase_intents',
  'commercial_purchase_intent_lines',
  'commercial_supplier_orders',
  'commercial_supplier_order_intents',
  'commercial_supplier_order_lines',
  'commercial_partner_allocations',
  'commercial_partner_resale_orders',
  'commercial_partner_resale_order_lines',
];

const internalGateways = [
  'internal_commercial_purchase_from_selection(uuid,uuid,text,uuid)',
  'internal_commercial_purchase_approve(uuid,uuid,uuid)',
  'internal_commercial_supplier_order_create(uuid,uuid[],text,text,text,uuid)',
  'internal_commercial_supplier_order_approve(uuid,uuid,uuid)',
  'internal_commercial_supplier_order_issue(uuid,uuid,uuid)',
  'internal_commercial_supplier_order_confirm(uuid,uuid,text,date,text,jsonb,uuid)',
  'internal_commercial_allocation_create(uuid,uuid,numeric,text,uuid)',
  'internal_commercial_resale_create(uuid,uuid,jsonb,text,text,text,text,uuid)',
  'internal_commercial_resale_approve(uuid,uuid,uuid)',
  'internal_commercial_resale_confirm(uuid,uuid,uuid)',
  'internal_commercial_purchase_get(uuid,uuid)',
  'internal_commercial_supplier_order_get(uuid,uuid)',
  'internal_commercial_allocation_get(uuid,uuid)',
  'internal_commercial_resale_get(uuid,uuid)',
];

afterAll(async () => {
  await owner.end();
  await runtime.end();
});

describe('E buy-resell security boundary', () => {
  it('keeps commercial source-of-truth tables and internal gateways unavailable to sco_runtime even when app.sco_internal is spoofed', async () => {
    const tableAcl = await owner.query<{ table_name: string; select: boolean; insert: boolean; update: boolean }>(
      `SELECT table_name,
              has_table_privilege('sco_runtime', format('public.%I', table_name), 'SELECT') AS select,
              has_table_privilege('sco_runtime', format('public.%I', table_name), 'INSERT') AS insert,
              has_table_privilege('sco_runtime', format('public.%I', table_name), 'UPDATE') AS update
         FROM unnest($1::text[]) AS t(table_name)
         ORDER BY table_name`,
      [commercialTables],
    );
    for (const row of tableAcl.rows) expect(row).toEqual({ table_name: row.table_name, select: false, insert: false, update: false });

    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.sco_internal', 'true', true)");
      await expect(client.query('SELECT * FROM public.commercial_supplier_orders LIMIT 1')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }

    const functionAcl = await owner.query<{ signature: string; runtime_execute: boolean; executor_execute: boolean; owner: string; security_definer: boolean }>(
      `SELECT p.oid::regprocedure::text AS signature,
              has_function_privilege('sco_runtime', p.oid, 'EXECUTE') AS runtime_execute,
              has_function_privilege('sco_internal_executor', p.oid, 'EXECUTE') AS executor_execute,
              r.rolname AS owner,
              p.prosecdef AS security_definer
         FROM pg_proc p
         JOIN pg_roles r ON r.oid = p.proowner
        WHERE p.oid = ANY($1::regprocedure[])
        ORDER BY p.oid::regprocedure::text`,
      [internalGateways.map((signature) => `public.${signature}`)],
    );
    expect(functionAcl.rows).toHaveLength(internalGateways.length);
    for (const row of functionAcl.rows) {
      expect(row.runtime_execute).toBe(false);
      expect(row.executor_execute).toBe(true);
      expect(row.owner).toBe('sco_internal_gateway_owner');
      expect(row.security_definer).toBe(true);
    }
  });
});
