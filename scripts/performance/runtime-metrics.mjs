export function parsePrometheusMetric(text, name, labels = {}) {
  for (const line of text.split('\n')) {
    if (!line.startsWith(name)) continue;
    if (!Object.entries(labels).every(([key, value]) => line.includes(`${key}="${value}"`))) continue;
    const value = Number(line.slice(line.lastIndexOf(' ') + 1));
    if (!Number.isFinite(value)) throw new Error(`PERFORMANCE_METRIC_INVALID:${name}`);
    return value;
  }
  return undefined;
}

export function assertCompleteRuntimeSample(sample) {
  const required = [
    'apiCpuPercent', 'apiMemoryBytes', 'postgresCpuPercent', 'postgresMemoryBytes',
    'runtimePoolTotal', 'runtimePoolIdle', 'runtimePoolWaiting', 'internalPoolTotal', 'internalPoolWaiting',
    'eventLoopLagMaxSeconds', 'eventLoopLagP99Seconds', 'openFileDescriptors', 'activeHandles', 'activeResources',
    'runtimeAcquireFailures', 'internalAcquireFailures', 'databaseConnections', 'databaseLockWaiters',
  ];
  for (const key of required) {
    if (!Number.isFinite(sample[key])) throw new Error(`PERFORMANCE_SAMPLE_INCOMPLETE:${key}`);
  }
}

export async function waitForRuntimeSamples(readProgress, {
  minimumSamples = 2,
  gracePeriodMs = 3000,
  pollIntervalMs = 100,
  now = Date.now,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const deadline = now() + gracePeriodMs;
  while (true) {
    let progress;
    try {
      progress = readProgress();
    } catch {
      progress = undefined;
    }
    if (Number.isInteger(progress?.samples) && progress.samples >= minimumSamples) return true;

    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await delay(Math.min(pollIntervalMs, remaining));
  }
}

export function assertCompleteRuntimeCollection(result) {
  if (!result || result.invalid || result.samples < 2 || result.collectionErrors !== 0) {
    throw new Error('Runtime metrics samples are incomplete');
  }
}