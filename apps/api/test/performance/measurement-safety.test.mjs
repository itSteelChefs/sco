import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyK6Outcome } from '../../../../scripts/performance/k6-outcome.mjs';
import {
  assertCompleteRuntimeCollection,
  assertCompleteRuntimeSample,
  parsePrometheusMetric,
  waitForRuntimeSamples,
} from '../../../../scripts/performance/runtime-metrics.mjs';

test('only k6 stress exit 99 with a configured performance threshold is an expected stop', () => {
  const summary = { metrics: {
    checks: { thresholds: { 'rate>0.99': true } },
    http_req_duration: { thresholds: { 'p(95)<800': false } },
    http_req_failed: { thresholds: { 'rate<0.05': true } },
  } };
  assert.deepEqual(classifyK6Outcome(99, summary, 'stress'), { completed: false, stop: 'latency_guardrail' });
  assert.throws(() => classifyK6Outcome(1, summary, 'stress'), /K6_RUN_FAILED/);
  assert.throws(() => classifyK6Outcome(99, { metrics: { checks: { thresholds: { 'rate==1': false } } } }, 'stress'), /NOT_AN_EXPECTED/);
  assert.throws(() => classifyK6Outcome(99, { metrics: { http_req_duration: { thresholds: { 'p(95)<800': false } } } }, 'stress'), /NOT_AN_EXPECTED/);
  const unrelatedFailure = structuredClone(summary);
  unrelatedFailure.metrics.http_req_duration.thresholds = { 'max<1': false };
  assert.throws(() => classifyK6Outcome(99, unrelatedFailure, 'stress'), /NOT_AN_EXPECTED/);
  assert.throws(() => classifyK6Outcome(99, summary, 'rate-limit'), /K6_RUN_FAILED/);
});

test('missing and non-finite runtime metrics are not converted into zero', () => {
  const text = 'sco_database_pool_connections{pool="runtime",state="waiting"} 0\n';
  assert.equal(parsePrometheusMetric(text, 'sco_database_pool_connections', { pool: 'runtime', state: 'waiting' }), 0);
  assert.equal(parsePrometheusMetric(text, 'sco_database_pool_connections', { pool: 'internal', state: 'waiting' }), undefined);
  assert.throws(() => parsePrometheusMetric('sco_process_cpu NaN\n', 'sco_process_cpu'), /METRIC_INVALID/);
  assert.throws(() => assertCompleteRuntimeSample({ apiCpuPercent: 0 }), /SAMPLE_INCOMPLETE/);
});

test('short profiles receive a bounded grace period for a second runtime sample', async () => {
  let elapsed = 0;
  let samples = 1;
  const ready = await waitForRuntimeSamples(() => ({ samples }), {
    gracePeriodMs: 300,
    pollIntervalMs: 50,
    now: () => elapsed,
    delay: async (milliseconds) => {
      elapsed += milliseconds;
      if (elapsed >= 100) samples = 2;
    },
  });

  assert.equal(ready, true);
  assert.equal(samples, 2);
  assert.equal(elapsed, 100);
});

test('profiles with enough runtime samples do not wait', async () => {
  let waits = 0;
  const ready = await waitForRuntimeSamples(() => ({ samples: 2 }), {
    delay: async () => { waits += 1; },
  });

  assert.equal(ready, true);
  assert.equal(waits, 0);
});

test('runtime collection grace expires and incomplete or failed samples still fail', async () => {
  let elapsed = 0;
  const ready = await waitForRuntimeSamples(() => ({ samples: 1 }), {
    gracePeriodMs: 250,
    pollIntervalMs: 100,
    now: () => elapsed,
    delay: async (milliseconds) => { elapsed += milliseconds; },
  });

  assert.equal(ready, false);
  assert.equal(elapsed, 250);
  assert.throws(() => assertCompleteRuntimeCollection({ samples: 1, collectionErrors: 0, invalid: true }), /samples are incomplete/);
  assert.throws(() => assertCompleteRuntimeCollection({ samples: 2, collectionErrors: 1 }), /samples are incomplete/);
  assert.doesNotThrow(() => assertCompleteRuntimeCollection({ samples: 2, collectionErrors: 0 }));
});