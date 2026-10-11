/**
 * Real HTTP denial probes for Capability G candidate routes.
 * Uses SCO_API_ORIGIN (default http://127.0.0.1:3101). Not mocked.
 *
 * Pass criteria: every candidate returns 401/403/404 (never 200 with intelligence body).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  G_ENDPOINT_CANDIDATES,
  errorPayloadLooksSafe,
  isDeniedPartnerStatus,
} from '../lib/g-partner-boundary.mjs';

const API = process.env.SCO_API_ORIGIN || 'http://127.0.0.1:3101';
const EMAIL = process.env.SCO_PARTNER_EMAIL || 'seed.owner@sco.test';
const PASSWORD = process.env.SCO_PARTNER_PASSWORD || 'sco-test-seed-password';
const COMPANY = process.env.SCO_PARTNER_COMPANY_ID || '10000000-0000-4000-8000-000000000002';
const FOREIGN_COMPANY = '30000000-0000-4000-8000-000000000099';
const SAMPLE_UUID = '11111111-1111-4111-8111-111111111111';

async function login() {
  const response = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const cookieHeader =
    setCookie.map((part) => part.split(';')[0]).join('; ') ||
    (response.headers.get('set-cookie') || '').split(',').map((p) => p.split(';')[0].trim()).filter(Boolean).join('; ');
  return { ok: response.ok, status: response.status, cookie: cookieHeader };
}

async function probe(path, cookie, companyId = COMPANY) {
  const url = path.includes('?')
    ? `${API}${path}`
    : `${API}${path}${path.includes(':') ? '' : ''}`;
  // Substitute :id style placeholders if present
  const resolved = url
    .replace(':supplierId', SAMPLE_UUID)
    .replace(':companyId', FOREIGN_COMPANY)
    .replace(':categoryId', SAMPLE_UUID)
    .replace(':sourceFactId', SAMPLE_UUID)
    .replace(':quoteId', SAMPLE_UUID)
    .replace(':purchaseOrderId', SAMPLE_UUID)
    .replace(':id', SAMPLE_UUID);
  const response = await fetch(resolved, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      cookie,
      'x-sco-company-id': companyId,
    },
  });
  const text = await response.text();
  return { status: response.status, text };
}

test('G endpoint denial: authenticated Partner cannot read intelligence surfaces', async (t) => {
  let loginResult;
  try {
    loginResult = await login();
  } catch (error) {
    t.skip(`API unreachable at ${API}: ${error}`);
    return;
  }
  if (!loginResult.ok || !loginResult.cookie) {
    t.skip(`Partner login failed status=${loginResult.status} at ${API}`);
    return;
  }

  const results = [];
  for (const path of G_ENDPOINT_CANDIDATES) {
    const { status, text } = await probe(path, loginResult.cookie, COMPANY);
    results.push({ path, status });
    assert.ok(isDeniedPartnerStatus(status), `${path} expected 401/403/404 got ${status}`);
    assert.ok(errorPayloadLooksSafe(text), `${path} error payload looks unsafe`);
  }

  // Direct ID substitution / foreign company header must not unlock intelligence.
  const cross = await probe('/api/v1/partner/intelligence/demand-signals', loginResult.cookie, FOREIGN_COMPANY);
  assert.ok(isDeniedPartnerStatus(cross.status), `foreign company probe got ${cross.status}`);
  assert.ok(errorPayloadLooksSafe(cross.text));

  const idPaths = [
    `/api/v1/partner/intelligence/suppliers/${SAMPLE_UUID}`,
    `/api/v1/partner/intelligence/categories/${SAMPLE_UUID}`,
    `/api/v1/partner/intelligence/quotes/${SAMPLE_UUID}`,
    `/api/v1/partner/intelligence/facts/${SAMPLE_UUID}`,
    `/api/v1/partner/intelligence/purchase-orders/${SAMPLE_UUID}`,
  ];
  for (const path of idPaths) {
    const { status, text } = await probe(path, loginResult.cookie, COMPANY);
    assert.ok(isDeniedPartnerStatus(status), `${path} expected denial got ${status}`);
    assert.ok(errorPayloadLooksSafe(text), `${path} unsafe error`);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ API, probed: results.length, sample: results.slice(0, 5) }));
});
