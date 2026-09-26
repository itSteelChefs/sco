import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();

const protectedTables = [
  'rfqs', 'supplier_quotes', 'supplier_quote_revisions', 'negotiation_events',
  'approved_purchase_cost_snapshots', 'purchase_sources', 'supplier_po_commercial_documents',
  'partner_offers', 'partner_purchase_orders', 'commercial_commitments',
  'procurement_releases', 'supplier_purchase_orders', 'supplier_po_confirmations',
  'supplier_po_delivery_execution_events', 'partner_delivery_receipt_events',
  'partner_delivery_acceptance_events', 'partner_delivery_discrepancy_events',
  'warranty_entitlements', 'buying_power_snapshots', 'buying_power_snapshot_lines',
  'buying_power_snapshot_source_memberships', 'supplier_future_demand_frameworks',
  'supplier_future_demand_framework_commercial_terms',
  'supplier_future_demand_framework_buying_power_provenance',
] as const;

let partnerActor: string;
let supplierActor: string;
let dualRoleActor: string;
let partnerCompany: string;
let supplierCompany: string;
let dualRoleCompany: string;

async function actor(companyId: string, suffix: string) {
  const userId = id();
  await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\')', [userId, `${suffix}-${userId}@batch13.test`]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
  return userId;
}

describe('Batch 13 Stage 003 cross-domain adversarial security', () => {
  beforeAll(async () => {
    partnerCompany = id(); supplierCompany = id(); dualRoleCompany = id();
    await owner.query(
      `INSERT INTO "Company"(id,name,type) VALUES
       ($1,'Batch 13 Partner','PARTNER'),($2,'Batch 13 Supplier','SUPPLIER'),($3,'Batch 13 Dual Role','PARTNER')`,
      [partnerCompany, supplierCompany, dualRoleCompany],
    );
    await owner.query(
      `INSERT INTO company_partnerships(company_id,type,status) VALUES
       ($1,'BUYER_PARTNERSHIP','ACTIVE'),($2,'SUPPLIER_PARTNERSHIP','ACTIVE'),
       ($3,'BUYER_PARTNERSHIP','ACTIVE'),($3,'SUPPLIER_PARTNERSHIP','ACTIVE')`,
      [partnerCompany, supplierCompany, dualRoleCompany],
    );
    partnerActor = await actor(partnerCompany, 'partner');
    supplierActor = await actor(supplierCompany, 'supplier');
    dualRoleActor = await actor(dualRoleCompany, 'dual-role');
  });

  afterAll(async () => owner.end());

  it('keeps every public SECURITY DEFINER gateway constrained and every RLS table forced', async () => {
    const functions = await owner.query<{
      proname: string;
      proconfig: string[] | null;
      publicExecute: boolean;
      runtimeExecute: boolean;
    }>(
      `SELECT p.proname,p.proconfig,
              has_function_privilege('public',p.oid,'EXECUTE') AS "publicExecute",
              has_function_privilege('sco_runtime',p.oid,'EXECUTE') AS "runtimeExecute"
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prosecdef`,
    );
    expect(functions.rows.length).toBeGreaterThan(0);
    expect(functions.rows.every((row) => row.proconfig?.includes('search_path=pg_catalog, public') && !row.publicExecute)).toBe(true);
    expect(functions.rows.filter((row) => row.proname.startsWith('internal_')).every((row) => !row.runtimeExecute)).toBe(true);

    const tables = await owner.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname,relrowsecurity,relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'
          AND c.relname NOT IN ('Company','User','Session','Permission','_prisma_migrations')`,
    );
    expect(tables.rows.length).toBeGreaterThan(0);
    expect(tables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it('denies Partner, Supplier, dual-role, and spoofed runtime reads across commercial domains', async () => {
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
    await runtime.connect();
    try {
      const profiles = [
        [partnerActor, partnerCompany],
        [supplierActor, supplierCompany],
        [dualRoleActor, dualRoleCompany],
        [id(), id()],
      ] as const;
      for (const [actorId, companyId] of profiles) {
        await runtime.query(
          `SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false),
                  set_config('app.company_id',$3,false),set_config('app.sco_internal','true',false)`,
          [actorId, companyId, id()],
        );
        for (const table of protectedTables) {
          await expect(runtime.query(`SELECT * FROM public.${table} LIMIT 1`)).rejects.toMatchObject({ code: '42501' });
        }
      }
    } finally {
      await runtime.end();
    }
  }, 30000);

  it('denies direct internal gateways and provides no cross-company error oracle through safe projections', async () => {
    const runtime = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL });
    const unknownId = id();
    try {
      await runtime.connect();
      await runtime.query(
        `SELECT set_config('app.actor_id',$1,false),set_config('app.tenant_id',$2,false),set_config('app.sco_internal','true',false)`,
        [dualRoleActor, dualRoleCompany],
      );
      const internalCalls: Array<[string, string[]]> = [
        ['SELECT * FROM public.internal_purchase_cost_get($1,$2)', [dualRoleActor, unknownId]],
        ['SELECT * FROM public.internal_supplier_po_scoped_get($1,$2)', [dualRoleActor, unknownId]],
        ['SELECT * FROM public.internal_buying_power_summary_view($1,$2)', [dualRoleActor, unknownId]],
        ['SELECT * FROM public.internal_supplier_future_demand_framework_get($1,$2)', [dualRoleActor, unknownId]],
      ];
      for (const [sql, values] of internalCalls) {
        await expect(runtime.query(sql, values)).rejects.toMatchObject({ code: '42501' });
      }
      const own = await runtime.query(
        'SELECT * FROM public.partner_buying_power_own_context($1,$2,$3,$4)',
        [dualRoleActor, supplierCompany, 'WEEKLY_IMMEDIATE', '2099-01-01'],
      );
      expect(own.rows).toEqual([]);
      const known = await runtime.query('SELECT id FROM documents WHERE id=$1', [unknownId]);
      const guessed = await runtime.query('SELECT id FROM documents WHERE id=$1', [id()]);
      expect(known.rows).toEqual(guessed.rows);
    } finally {
      await runtime.end();
    }
  });
});