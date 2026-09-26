import test from 'node:test'; import assert from 'node:assert/strict'; import { readFile } from 'node:fs/promises';
import { sanitizeSentryEvent } from '../sentry-privacy.mjs';
test('partner portal has no internal navigation or direct database access', async () => { const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'); assert.match(page, /Partner Portal/); assert.doesNotMatch(page, /passwordHash|audit_logs|DATABASE_URL/); });
test('partner telemetry removes user, headers, cookies, bodies, and query strings', () => {
	assert.deepEqual(sanitizeSentryEvent({ request: { method: 'POST', url: 'https://partner.test/path?token=secret', headers: { authorization: 'Bearer secret' }, data: { document: 'private' } }, user: { email: 'private@example.test' }, extra: { password: 'secret' }, breadcrumbs: [{ data: { url: 'https://user:password@partner.test/private?email=private@example.test' } }] }), { request: { method: 'POST', url: 'https://partner.test/path' }, extra: { password: '[REDACTED]' }, breadcrumbs: [{ data: { url: 'https://[REDACTED]@partner.test/private' } }] });
});
