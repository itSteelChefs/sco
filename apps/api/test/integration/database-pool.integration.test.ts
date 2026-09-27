import { createServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createObservedPool, databasePoolSettings } from '../../src/database/observed-pool.js';
import { MetricsService } from '../../src/observability/metrics.service.js';

describe('PostgreSQL pool performance instrumentation', () => {
  const pools: Array<ReturnType<typeof createObservedPool>> = [];
  const servers: Array<ReturnType<typeof createServer>> = [];
  const sockets = new Set<Socket>();

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it('uses bounded explicit pool defaults and rejects invalid sizing', () => {
    expect(databasePoolSettings({})).toEqual({ max: 25, connectionTimeoutMillis: 5_000 });
    expect(() => databasePoolSettings({ SCO_DATABASE_POOL_MAX: '101' })).toThrow(/from 1 to 100/);
    expect(() => databasePoolSettings({ SCO_DATABASE_CONNECTION_TIMEOUT_MS: '0' })).toThrow(/from 1 to 60000/);
  });

  it('records a failed timed acquisition without exposing connection details', async () => {
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const metrics = new MetricsService();
    const pool = createObservedPool(`postgresql://synthetic:synthetic@127.0.0.1:${port}/sco_dev`, 'runtime', metrics, {
      max: 1,
      connectionTimeoutMillis: 50,
    });
    pools.push(pool);

    await expect(pool.connect()).rejects.toThrow(/timeout/i);
    await expect(pool.query('SELECT 1')).rejects.toThrow(/timeout/i);
    const callbackError = await new Promise<Error>((resolve, reject) => {
      pool.connect((error, client) => {
        client?.release();
        if (error) resolve(error);
        else reject(new Error('Expected callback acquisition timeout'));
      });
    });
    expect(callbackError.message).toMatch(/timeout/i);
    const rendered = await metrics.render();
    expect(rendered).toMatch(/sco_database_pool_failures_total\{[^}]*pool="runtime"[^}]*kind="acquire"[^}]*\} 3/);
    expect(rendered).not.toContain('synthetic');
  });
});