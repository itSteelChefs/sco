import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const profiles = {
  smoke: [{ duration: '5s', target: 1 }],
  light: [{ duration: '5s', target: 5 }, { duration: '10s', target: 5 }, { duration: '5s', target: 0 }],
  sustained: [{ duration: '5s', target: 15 }, { duration: '20s', target: 15 }, { duration: '5s', target: 0 }],
  burst: [{ duration: '2s', target: 40 }, { duration: '8s', target: 40 }, { duration: '5s', target: 0 }],
  stress: [{ duration: '5s', target: 10 }, { duration: '10s', target: 20 }, { duration: '10s', target: 30 }, { duration: '10s', target: 40 }, { duration: '5s', target: 0 }, { duration: '10s', target: 1 }],
};

const profile = __ENV.SCO_LOAD_PROFILE || 'smoke';
if (!profiles[profile]) throw new Error(`Unknown load profile: ${profile}`);

export const options = {
  scenarios: { workload: { executor: 'ramping-vus', stages: profiles[profile], gracefulRampDown: '5s' } },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
  },
};

if (profile === 'stress') {
  options.thresholds.http_req_duration = [{ threshold: 'p(95)<800', abortOnFail: true, delayAbortEval: '5s' }];
  options.thresholds.http_req_failed = [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '2s' }];
}

const baseUrl = __ENV.SCO_LOAD_BASE_URL;
const password = __ENV.SCO_LOAD_PASSWORD;
const partnerCompanyId = '10000000-0000-4000-8000-000000000002';
const scoCompanyId = '10000000-0000-4000-8000-000000000001';
const status429 = new Counter('sco_status_429');
const status5xx = new Counter('sco_status_5xx');
const operationDuration = new Trend('sco_operation_duration_ms', true);
let cookie;

http.setResponseCallback(http.expectedStatuses(200, 201, 401, 403, 429));

function record(response, expected, name) {
  status429.add(response.status === 429);
  status5xx.add(response.status >= 500);
  operationDuration.add(response.timings.duration, { operation: name });
  check(response, { [`${name} status ${expected}`]: (result) => result.status === expected });
}

function login() {
  const response = http.post(`${baseUrl}/api/v1/auth/login`, JSON.stringify({ email: 'seed.owner@sco.test', password }), {
    headers: { 'content-type': 'application/json' },
    tags: { operation: 'auth_login' },
  });
  record(response, 201, 'login');
  const session = response.cookies.sco_session?.[0]?.value;
  if (session) cookie = `sco_session=${session}`;
}

function authenticatedGet(path, companyId, operation) {
  if (!cookie) login();
  const response = http.get(`${baseUrl}${path}`, {
    headers: { cookie, 'x-sco-company-id': companyId },
    tags: { operation },
  });
  record(response, 200, operation);
}

function tenantRead(companyId) {
  if (!cookie) login();
  const response = http.get(`${baseUrl}/api/v1/companies/current/me`, {
    headers: { cookie, 'x-sco-company-id': companyId },
    tags: { operation: 'tenant_company_read' },
  });
  record(response, 200, 'tenant_company_read');
  check(response, { 'tenant response matches requested company': (result) => result.json('id') === companyId });
}

export default function () {
  const selector = __ITER % 20;
  if (selector === 0) {
    record(http.get(`${baseUrl}/health/live`, { tags: { operation: 'liveness' } }), 200, 'liveness');
  } else if (selector === 1) {
    record(http.get(`${baseUrl}/health/ready`, { tags: { operation: 'readiness' } }), 200, 'readiness');
  } else if (selector === 2) {
    login();
  } else if (selector < 8) {
    const syntheticCompany = `20000000-0000-4000-8000-${((__VU + __ITER) % 250 + 1).toString(16).padStart(12, '0')}`;
    tenantRead(syntheticCompany);
  } else if (selector < 13) {
    authenticatedGet('/api/v1/partner/me', partnerCompanyId, 'partner_read');
  } else if (selector < 19) {
    authenticatedGet('/api/v1/internal/companies?page=1&pageSize=20', scoCompanyId, 'paginated_internal_read');
  } else {
    if (!cookie) login();
    const denied = http.get(`${baseUrl}/api/v1/companies/current/me`, {
      headers: { cookie, 'x-sco-company-id': '30000000-0000-4000-8000-000000000001' },
      tags: { operation: 'cross_tenant_denial' },
    });
    operationDuration.add(denied.timings.duration, { operation: 'cross_tenant_denial' });
    record(denied, 403, 'cross_tenant_denial');
    check(denied, { 'cross-tenant response contains no company projection': (result) => !result.body.includes('Synthetic Performance Company') });
  }
}