import test from 'node:test'; import assert from 'node:assert/strict'; import { readFile } from 'node:fs/promises';
import { sanitizeSentryEvent } from '../sentry-privacy.mjs';
test('operations portal is separate from partner UI', async () => { const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'); assert.match(page, /Internal Operations/); assert.doesNotMatch(page, /tenant_probes|supplier_quotes|selling_price/); });
test('operations telemetry removes user, headers, cookies, bodies, and query strings', () => {
	assert.deepEqual(sanitizeSentryEvent({ request: { method: 'POST', url: 'https://operations.test/path?token=secret', headers: { authorization: 'Bearer secret' }, data: { document: 'private' } }, user: { email: 'private@example.test' }, extra: { password: 'secret' }, breadcrumbs: [{ data: { url: 'https://user:password@operations.test/private?email=private@example.test' } }] }), { request: { method: 'POST', url: 'https://operations.test/path' }, extra: { password: '[REDACTED]' }, breadcrumbs: [{ data: { url: 'https://[REDACTED]@operations.test/private' } }] });
});
