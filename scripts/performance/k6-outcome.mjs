export function classifyK6Outcome(exitCode, summary, profile) {
  if (exitCode === 0) return { completed: true, stop: 'none' };
  if (profile !== 'stress' || exitCode !== 99 || !summary?.metrics) {
    throw new Error('K6_RUN_FAILED');
  }

  const checkThresholds = Object.values(summary.metrics.checks?.thresholds ?? {});
  const checksFailed = checkThresholds.length === 0 || checkThresholds.some((passed) => passed !== true);
  const durationThresholds = summary.metrics.http_req_duration?.thresholds ?? {};
  const errorThresholds = summary.metrics.http_req_failed?.thresholds ?? {};
  const durationThresholdFailed = durationThresholds['p(95)<800'] === false;
  const errorThresholdFailed = errorThresholds['rate<0.05'] === false;
  const requiredThresholdsPresent = Object.hasOwn(durationThresholds, 'p(95)<800') && Object.hasOwn(errorThresholds, 'rate<0.05');
  if (checksFailed || !requiredThresholdsPresent || (!durationThresholdFailed && !errorThresholdFailed)) {
    throw new Error('K6_FAILURE_WAS_NOT_AN_EXPECTED_STRESS_GUARDRAIL');
  }
  return { completed: false, stop: durationThresholdFailed ? 'latency_guardrail' : 'error_guardrail' };
}