import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

export const options = {
  vus: 1,
  iterations: 30,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    checks: ['rate==1'],
    sco_status_429: ['count>0'],
    sco_status_5xx: ['count==0'],
  },
};

const baseUrl = __ENV.SCO_LOAD_BASE_URL;
const status429 = new Counter('sco_status_429');
const status5xx = new Counter('sco_status_5xx');
http.setResponseCallback(http.expectedStatuses(200, 401, 429));

export default function () {
  const response = http.post(`${baseUrl}/api/v1/auth/login`, JSON.stringify({ email: 'unknown-load-user@sco.test', password: 'synthetic-invalid-password' }), {
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `198.51.100.${(__ITER % 250) + 1}`,
    },
    tags: { operation: 'forged_forwarding_login_burst' },
  });
  status429.add(response.status === 429);
  status5xx.add(response.status >= 500);
  check(response, { 'failed login or limited': (result) => result.status === 401 || result.status === 429 });
  const live = http.get(`${baseUrl}/health/live`, { tags: { operation: 'liveness_during_limit' } });
  check(live, { 'liveness remains available': (result) => result.status === 200 });
}