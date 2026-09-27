import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const seedScript = fileURLToPath(new URL('../../../../scripts/performance/seed-performance.mjs', import.meta.url));

function runSeed(environment) {
  return spawnSync(process.execPath, [seedScript], {
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

test('performance dataset refuses Production before opening a database connection', () => {
  const result = runSeed({ NODE_ENV: 'production', SCO_PERFORMANCE_DATASET: 'isolated-local', DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/sco_dev' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /NODE_ENV=test and SCO_PERFORMANCE_DATASET=isolated-local/);
});

test('performance dataset refuses a non-loopback database before connecting', () => {
  const result = runSeed({ NODE_ENV: 'test', SCO_PERFORMANCE_DATASET: 'isolated-local', DATABASE_URL: 'postgresql://synthetic:synthetic@203.0.113.8:5432/sco_dev' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /isolated loopback sco_dev/);
});
