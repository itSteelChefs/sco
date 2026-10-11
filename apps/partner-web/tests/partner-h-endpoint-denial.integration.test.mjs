/**
 * Real HTTP denial probes for Capability H candidate routes.
 * Uses SCO_API_ORIGIN (default http://127.0.0.1:3121). Not mocked.
 *
 * Pass criteria: every candidate returns 401/403/404 (never 200 with ops body).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  H_ENDPOINT_CANDIDATES,
  errorPayloadLooksSafe,
  isDeniedPartnerStatus,
} from '../lib/h-partner-boundary.mjs';

const API = process.env.SCO_API_ORIGIN || 'http://127.0.0.1:3121';
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
    (response.headers.get('set-cookie') || '')
      .split(',')
      .map((p) => p.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
  return { ok: response.ok, status: response.status, cookie: cookieHeader };
}

async function probe(path, cookie, companyId = COMPANY, method = 'GET') {
  const resolved = `${API}${path}`
    .replace(':id', SAMPLE_UUID)
    .replace(':workItemId', SAMPLE_UUID)
    .replace(':exceptionId', SAMPLE_UUID)
    .replace(':jobId', SAMPLE_UUID)
    .replace(':cycleId', SAMPLE_UUID);
  const response = await fetch(resolved, {
    method,
    headers: {
      accept: 'application/json',
      cookie,
      'x-sco-company-id': companyId,
      ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
    },
    body: method !== 'GET' ? JSON.stringify({}) : undefined,
  });
  const text = await response.text();
  return { status: response.status, text };
}

test('H endpoint denial: authenticated Partner cannot access operational platform', async (t) => {
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
  for (const path of H_ENDPOINT_CANDIDATES) {
    const { status, text } = await probe(path, loginResult.cookie, COMPANY);
    results.push({ path, status });
    assert.ok(isDeniedPartnerStatus(status), `${path} expected 401/403/404 got ${status}`);
    assert.ok(errorPayloadLooksSafe(text), `${path} error payload looks unsafe: ${text.slice(0, 200)}`);
  }

  // Mutation attempts on Cursor3 H controller must also deny.
  const mutations = [
    ['/api/v1/internal/h-operations/work-items', 'POST'],
    ['/api/v1/internal/h-operations/exceptions', 'POST'],
    [`/api/v1/internal/h-operations/work-items/${SAMPLE_UUID}/assign`, 'POST'],
    [`/api/v1/internal/h-operations/work-items/${SAMPLE_UUID}/transition`, 'POST'],
    [`/api/v1/internal/h-operations/exceptions/${SAMPLE_UUID}/retry`, 'POST'],
    ['/api/v1/internal/h-operations/jobs', 'POST'],
    [`/api/v1/internal/h-operations/jobs/${SAMPLE_UUID}/run`, 'POST'],
    ['/api/v1/internal/h-operations/config', 'POST'],
    ['/api/v1/internal/h-operations/cycles', 'POST'],
    [`/api/v1/partner/exceptions/${SAMPLE_UUID}/retry`, 'POST'],
    ['/api/v1/partner/jobs', 'POST'],
  ];
  for (const [path, method] of mutations) {
    const { status, text } = await probe(path, loginResult.cookie, COMPANY, method);
    results.push({ path: `${method} ${path}`, status });
    assert.ok(isDeniedPartnerStatus(status), `${method} ${path} expected denial got ${status}`);
    assert.ok(errorPayloadLooksSafe(text), `${method} ${path} unsafe error`);
  }

  const cross = await probe('/api/v1/internal/h-operations/work-items', loginResult.cookie, FOREIGN_COMPANY);
  assert.ok(isDeniedPartnerStatus(cross.status), `foreign company probe got ${cross.status}`);
  assert.ok(errorPayloadLooksSafe(cross.text));

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ API, probed: results.length, sample: results.slice(0, 8) }));
});
