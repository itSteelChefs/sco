import { Pool, type PoolClient } from 'pg';
import type { MetricsService } from '../observability/metrics.service.js';

export type DatabasePoolName = 'runtime' | 'internal';
type PoolRelease = (error?: Error | boolean) => void;
type PoolConnectCallback = (error: Error | undefined, client: PoolClient | undefined, release: PoolRelease) => void;
type PoolConnect = (callback?: PoolConnectCallback) => Promise<PoolClient> | void;

export function databasePoolSettings(environment: NodeJS.ProcessEnv = process.env) {
  const max = Number(environment.SCO_DATABASE_POOL_MAX ?? 25);
  const connectionTimeoutMillis = Number(environment.SCO_DATABASE_CONNECTION_TIMEOUT_MS ?? 5_000);
  if (!Number.isSafeInteger(max) || max < 1 || max > 100) throw new Error('SCO_DATABASE_POOL_MAX must be an integer from 1 to 100');
  if (!Number.isSafeInteger(connectionTimeoutMillis) || connectionTimeoutMillis < 1 || connectionTimeoutMillis > 60_000) {
    throw new Error('SCO_DATABASE_CONNECTION_TIMEOUT_MS must be an integer from 1 to 60000');
  }
  return { max, connectionTimeoutMillis };
}

export function createObservedPool(
  connectionString: string | undefined,
  name: DatabasePoolName,
  metrics?: MetricsService,
  settings = databasePoolSettings(),
): Pool {
  const pool = new Pool({ connectionString, ...settings });
  if (!metrics) return pool;
  const connect = pool.connect.bind(pool) as PoolConnect;
  Object.defineProperty(pool, 'connect', {
    value: (callback?: PoolConnectCallback) => {
      if (callback) {
        return connect((error, client, release) => {
          if (error) metrics.databasePoolFailure(name, 'acquire');
          callback(error, client, release);
        });
      }
      return (connect() as Promise<PoolClient>).catch((error: unknown) => {
        metrics.databasePoolFailure(name, 'acquire');
        throw error;
      });
    },
  });
  pool.on('error', () => metrics.databasePoolFailure(name, 'idle_client'));
  return pool;
}