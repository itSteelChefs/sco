#!/usr/bin/env node
/**
 * CLI admin backfill for Capability G facts (idempotent).
 * Usage: node apps/api/scripts/g-intelligence-backfill.mjs [--dry-run] --actor <uuid>
 */
import pg from 'pg';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const actorIdx = args.indexOf('--actor');
const actor = actorIdx >= 0 ? args[actorIdx + 1] : process.env.G_BACKFILL_ACTOR_USER_ID;
if (!actor) {
  console.error('Usage: --actor <uuid> [--dry-run]');
  process.exit(2);
}
const url = process.env.RUNTIME_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('RUNTIME_DATABASE_URL or DATABASE_URL required');
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.actor_id',$1,true), set_config('app.sco_internal','true',true)", [actor]);
  const result = await client.query('SELECT public.internal_g_intelligence_backfill($1,$2,gen_random_uuid()) AS summary', [
    actor,
    dryRun,
  ]);
  await client.query('COMMIT');
  console.log(JSON.stringify(result.rows[0].summary, null, 2));
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message || error);
  process.exit(1);
} finally {
  await client.end();
}
