import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function read(relative) {
  return readFile(new URL(relative, import.meta.url), 'utf8');
}

test('public reception is Arabic-first and links live login', async () => {
  const home = await read('../components/reception/reception-home.tsx');
  const page = await read('../app/page.tsx');
  assert.match(page, /ReceptionHome/);
  assert.match(home, /سكو/);
  assert.match(home, /href="\/login"/);
  assert.match(home, /التكييف/);
  assert.match(home, /الكهرباء/);
  assert.match(home, /السباكة/);
  assert.doesNotMatch(home, /%|شهادة معتمدة|عدد العملاء|SLA/);
});

test('root layout remains Arabic RTL', async () => {
  const layout = await read('../app/layout.tsx');
  assert.match(layout, /lang="ar"/);
  assert.match(layout, /dir="rtl"/);
});

test('middleware exposes public reception routes without inventing auth', async () => {
  const middleware = await read('../middleware.ts');
  assert.match(middleware, /PUBLIC_PATHS/);
  assert.match(middleware, /'\/'/);
  assert.match(middleware, /'\/login'/);
  assert.match(middleware, /'\/partnership'/);
  assert.match(middleware, /'\/verify'/);
  assert.match(middleware, /sco_session/);
});

test('partnership and verify entries are explicit shells, not fake success', async () => {
  const partnership = await read('../app/partnership/page.tsx');
  const verify = await read('../app/verify/page.tsx');
  assert.match(partnership, /SHELL/);
  assert.match(verify, /SHELL/);
  assert.doesNotMatch(partnership, /تم قبول|registration successful|submitRegistration/i);
  assert.doesNotMatch(verify, /تم التوثيق|verified successfully/i);
});

test('login success targets authenticated portal path', async () => {
  const login = await read('../app/login/page.tsx');
  assert.match(login, /replace\('\/portal'\)/);
});
