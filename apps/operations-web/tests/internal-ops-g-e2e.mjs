/**
 * Capability G INTERNAL_E2E — real backend (no mocks).
 * Runs Cursor3 signed g-intelligence HTTP integration against test DB,
 * then asserts Cursor2 contracts/UI bind the same routes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractsPath = join(root, '../../packages/contracts/src/api.ts');
const cursor3 = '/root/.ssh/sco-cursor3-g-intelligence';
const cursor3Test = join(cursor3, 'apps/api/test/integration/g-intelligence.integration.test.ts');

test('G INTERNAL_E2E real backend HTTP (Cursor3 signed suite) + contracts alignment', async () => {
  await access(cursor3Test, constants.R_OK);
  const log = spawnSync('git', ['-C', cursor3, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  assert.equal(log.status, 0);
  const head = log.stdout.trim();
  assert.match(head, /^[0-9a-f]{40}$/);

  const verify = spawnSync('git', ['-C', cursor3, 'verify-commit', 'HEAD'], { encoding: 'utf8' });
  assert.equal(verify.status, 0, 'Cursor3 HEAD must be signed');

  const result = spawnSync(
    'node',
    [
      'scripts/test/run-with-test-db.mjs',
      'corepack',
      'pnpm',
      '--filter',
      '@sco/api',
      'exec',
      'vitest',
      'run',
      'test/integration/g-intelligence.integration.test.ts',
      '--no-file-parallelism',
    ],
    {
      cwd: cursor3,
      encoding: 'utf8',
      env: process.env,
      timeout: 600_000,
    },
  );

  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
  }
  assert.equal(result.status, 0, 'Real G HTTP integration must pass');
  assert.match(result.stdout + result.stderr, /Test Files\s+1 passed|✓ test\/integration\/g-intelligence/);

  const contracts = await readFile(contractsPath, 'utf8');
  for (const route of [
    '/api/v1/internal/g-intelligence/backfill',
    '/api/v1/internal/g-intelligence/price-history',
    '/api/v1/internal/g-intelligence/quotes/',
    '/api/v1/internal/g-intelligence/suppliers/',
    '/api/v1/internal/g-intelligence/categories/',
    '/api/v1/internal/g-intelligence/demand',
    '/api/v1/internal/g-intelligence/decision-support/quotes/',
    '/api/v1/internal/g-intelligence/evidence',
  ]) {
    assert.match(contracts, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const uiFiles = [
    'components/ops/intelligence-overview.tsx',
    'components/ops/intelligence-prices.tsx',
    'components/ops/intelligence-benchmark.tsx',
    'components/ops/intelligence-suppliers.tsx',
    'components/ops/intelligence-categories.tsx',
    'components/ops/intelligence-demand.tsx',
    'components/ops/intelligence-evidence.tsx',
    'components/ops/intelligence-decision-support.tsx',
    'components/ops/purchase-workspace.tsx',
  ];
  for (const rel of uiFiles) {
    const src = await readFile(join(root, rel), 'utf8');
    assert.match(src, /internalG|IntelligenceDecisionSupportPanel/);
  }
});
