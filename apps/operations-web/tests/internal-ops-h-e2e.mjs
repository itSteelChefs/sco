/**
 * Capability H INTERNAL_E2E — real backend (no mocks).
 * Runs Cursor3 signed h-operations HTTP integration against test DB,
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
const cursor3 = '/root/.ssh/sco-cursor3-h-operations';
const cursor3Test = join(cursor3, 'apps/api/test/integration/h-operations.integration.test.ts');

test('H INTERNAL_E2E real backend HTTP (Cursor3 signed suite) + contracts alignment', async () => {
  await access(cursor3Test, constants.R_OK);
  const headProc = spawnSync('git', ['-C', cursor3, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  assert.equal(headProc.status, 0);
  const head = headProc.stdout.trim();
  assert.match(head, /^[0-9a-f]{40}$/);

  const ahead = spawnSync('git', ['-C', cursor3, 'rev-list', '--count', '0dba9bbb87e00e38e3b65725886e1e046646b083..HEAD'], {
    encoding: 'utf8',
  });
  assert.equal(ahead.status, 0);
  assert.ok(Number(ahead.stdout.trim()) > 0, 'Cursor3 H must have signed commits beyond BASE');

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
      'test/integration/h-operations.integration.test.ts',
      '--no-file-parallelism',
    ],
    { cwd: cursor3, encoding: 'utf8', env: process.env, timeout: 600_000 },
  );
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
  }
  assert.equal(result.status, 0, 'Real H HTTP integration must pass');
  assert.match(result.stdout + result.stderr, /Test Files\s+1 passed|h-operations\.integration/);

  const contracts = await readFile(contractsPath, 'utf8');
  for (const route of [
    '/api/v1/internal/h-operations/work-items',
    '/api/v1/internal/h-operations/exceptions/',
    '/api/v1/internal/h-operations/cycles',
    '/api/v1/internal/h-operations/notifications',
    '/api/v1/internal/h-operations/jobs',
    '/api/v1/internal/h-operations/health',
    '/api/v1/internal/h-operations/config',
    '/api/v1/internal/h-operations/audit-evidence',
  ]) {
    assert.match(contracts, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const uiFiles = [
    'components/ops/h-operations-queue.tsx',
    'components/ops/h-operations-exceptions.tsx',
    'components/ops/h-operations-cycles.tsx',
    'components/ops/h-operations-notifications.tsx',
    'components/ops/h-operations-jobs.tsx',
    'components/ops/h-operations-health.tsx',
    'components/ops/h-operations-audit.tsx',
    'components/ops/h-operations-config.tsx',
    'components/ops/h-operations-shared.tsx',
  ];
  for (const rel of uiFiles) {
    const src = await readFile(join(root, rel), 'utf8');
    assert.match(src, /internalH|sourceDeepLink|OperationsSubnav/);
  }
});
