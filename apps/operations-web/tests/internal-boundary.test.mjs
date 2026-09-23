import test from 'node:test'; import assert from 'node:assert/strict'; import { readFile } from 'node:fs/promises';
test('operations portal is separate from partner UI', async () => { const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'); assert.match(page, /Internal Operations/); assert.doesNotMatch(page, /tenant_probes|supplier_quotes|selling_price/); });
