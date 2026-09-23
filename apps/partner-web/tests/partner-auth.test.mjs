import test from 'node:test'; import assert from 'node:assert/strict'; import { readFile } from 'node:fs/promises';
test('partner portal has no internal navigation or direct database access', async () => { const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'); assert.match(page, /Partner Portal/); assert.doesNotMatch(page, /passwordHash|audit_logs|DATABASE_URL/); });
