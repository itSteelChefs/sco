import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvironment } from '@sco/config';

test('rejects a missing database URL', () => {
  assert.throws(
    () => loadEnvironment({ SESSION_SECRET: 'a-long-test-secret' }),
    { message: 'DATABASE_URL is required' },
  );
});
