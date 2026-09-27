import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { assertCompleteRuntimeSample, parsePrometheusMetric } from './runtime-metrics.mjs';

const [outputPath, progressPath, apiUrl, apiContainer, postgresContainer, postgresUser] = process.argv.slice(2);
if (!outputPath || !progressPath || !apiUrl || !apiContainer || !postgresContainer || !postgresUser || !process.env.SCO_METRICS_TOKEN) {
  throw new Error('Runtime collector arguments and SCO_METRICS_TOKEN are required');
}

const samples = [];
let stopping = false;
let timer;

function bytes(value) {
  const match = /^([0-9.]+)([KMG]iB)$/.exec(value.trim());
  if (!match) return undefined;
  return Number(match[1]) * { KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }[match[2]];
}

async function sample() {
  try {
    const response = await fetch(`${apiUrl}/internal/metrics`, { headers: { authorization: `Bearer ${process.env.SCO_METRICS_TOKEN}` } });
    if (!response.ok) throw new Error('METRICS_ENDPOINT_UNAVAILABLE');
    const metrics = await response.text();
    const stats = execFileSync('docker', ['stats', '--no-stream', '--format', '{{json .}}', apiContainer, postgresContainer], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const byName = Object.fromEntries(stats.map((item) => [item.Name, item]));
    if (!byName[apiContainer] || !byName[postgresContainer]) throw new Error('REQUIRED_CONTAINER_STATS_MISSING');
    const database = execFileSync('docker', ['exec', postgresContainer, 'psql', '-U', postgresUser, '-d', 'sco_dev', '-Atc', "SELECT count(*), count(*) FILTER (WHERE wait_event_type='Lock') FROM pg_stat_activity WHERE datname=current_database()"], { encoding: 'utf8' }).trim().split('|').map(Number);
    if (database.length !== 2 || database.some((value) => !Number.isFinite(value))) throw new Error('DATABASE_ACTIVITY_METRICS_INVALID');
    const sample = {
      at: new Date().toISOString(),
      apiCpuPercent: Number.parseFloat(byName[apiContainer].CPUPerc),
      apiMemoryBytes: bytes(byName[apiContainer].MemUsage.split('/')[0]),
      postgresCpuPercent: Number.parseFloat(byName[postgresContainer].CPUPerc),
      postgresMemoryBytes: bytes(byName[postgresContainer].MemUsage.split('/')[0]),
      runtimePoolTotal: parsePrometheusMetric(metrics, 'sco_database_pool_connections', { pool: 'runtime', state: 'total' }),
      runtimePoolIdle: parsePrometheusMetric(metrics, 'sco_database_pool_connections', { pool: 'runtime', state: 'idle' }),
      runtimePoolWaiting: parsePrometheusMetric(metrics, 'sco_database_pool_connections', { pool: 'runtime', state: 'waiting' }),
      internalPoolTotal: parsePrometheusMetric(metrics, 'sco_database_pool_connections', { pool: 'internal', state: 'total' }),
      internalPoolWaiting: parsePrometheusMetric(metrics, 'sco_database_pool_connections', { pool: 'internal', state: 'waiting' }),
      eventLoopLagMaxSeconds: parsePrometheusMetric(metrics, 'sco_nodejs_nodejs_eventloop_lag_max_seconds'),
      eventLoopLagP99Seconds: parsePrometheusMetric(metrics, 'sco_nodejs_nodejs_eventloop_lag_p99_seconds'),
      openFileDescriptors: parsePrometheusMetric(metrics, 'sco_nodejs_process_open_fds'),
      activeHandles: parsePrometheusMetric(metrics, 'sco_nodejs_nodejs_active_handles_total'),
      activeResources: parsePrometheusMetric(metrics, 'sco_nodejs_nodejs_active_resources_total'),
      runtimeAcquireFailures: parsePrometheusMetric(metrics, 'sco_database_pool_failures_total', { pool: 'runtime', kind: 'acquire' }),
      internalAcquireFailures: parsePrometheusMetric(metrics, 'sco_database_pool_failures_total', { pool: 'internal', kind: 'acquire' }),
      databaseConnections: database[0],
      databaseLockWaiters: database[1],
    };
    assertCompleteRuntimeSample(sample);
    samples.push(sample);
  } catch (error) {
    samples.push({ at: new Date().toISOString(), collectionError: error instanceof Error ? error.name : 'UnknownError' });
  }
  writeFileSync(progressPath, `${JSON.stringify({ samples: samples.length, collectionErrors: samples.filter((item) => item.collectionError).length })}\n`);
}

function maximum(key) {
  return Math.max(0, ...samples.map((item) => typeof item[key] === 'number' ? item[key] : 0));
}

function average(key) {
  const values = samples.map((item) => item[key]).filter((value) => typeof value === 'number');
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function finish() {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  if (samples.length < 2 || samples.some((item) => item.collectionError)) {
    writeFileSync(outputPath, `${JSON.stringify({ samples: samples.length, collectionErrors: samples.filter((item) => item.collectionError).length, invalid: true }, null, 2)}\n`);
    return;
  }
  writeFileSync(outputPath, `${JSON.stringify({
    samples: samples.length,
    apiCpuPercent: { average: average('apiCpuPercent'), maximum: maximum('apiCpuPercent') },
    apiMemoryBytes: { average: average('apiMemoryBytes'), maximum: maximum('apiMemoryBytes') },
    postgresCpuPercent: { average: average('postgresCpuPercent'), maximum: maximum('postgresCpuPercent') },
    postgresMemoryBytes: { average: average('postgresMemoryBytes'), maximum: maximum('postgresMemoryBytes') },
    runtimePool: { totalMaximum: maximum('runtimePoolTotal'), idleMinimum: Math.min(...samples.map((item) => item.runtimePoolIdle ?? Infinity)), waitingMaximum: maximum('runtimePoolWaiting') },
    internalPool: { totalMaximum: maximum('internalPoolTotal'), waitingMaximum: maximum('internalPoolWaiting') },
    eventLoopLagMaximumSeconds: maximum('eventLoopLagMaxSeconds'),
    eventLoopLagP99MaximumSeconds: maximum('eventLoopLagP99Seconds'),
    openFileDescriptorsMaximum: maximum('openFileDescriptors'),
    activeHandlesMaximum: maximum('activeHandles'),
    activeResourcesMaximum: maximum('activeResources'),
    runtimeAcquireFailures: maximum('runtimeAcquireFailures'),
    internalAcquireFailures: maximum('internalAcquireFailures'),
    databaseConnectionsMaximum: maximum('databaseConnections'),
    databaseLockWaitersMaximum: maximum('databaseLockWaiters'),
    collectionErrors: samples.filter((item) => item.collectionError).length,
  }, null, 2)}\n`);
}

process.on('SIGTERM', finish);
process.on('SIGINT', finish);
await sample();
if (!stopping) timer = setInterval(sample, 1000);