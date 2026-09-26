import { Controller, Get, Module } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';
import { RuntimeDatabaseService } from '../../src/database/runtime-database.service.js';
import { createOperationalLogger, safeFields, sanitizeSentryEvent } from '../../src/observability/telemetry.js';

@Controller('/test-observability')
class FaultController {
  @Get('failure')
  fail() {
    throw new Error('postgresql://admin:secret@private-db/sco /root/private-file');
  }
}

@Module({ imports: [AppModule], controllers: [FaultController] })
class TestModule {}

const runtimeDatabase = { ping: vi.fn(), poolStats: () => ({ total: 2, idle: 1, waiting: 0 }), onModuleDestroy: vi.fn() };
const internalDatabase = { ping: vi.fn(), poolStats: () => ({ total: 1, idle: 1, waiting: 0 }), onModuleDestroy: vi.fn() };
let app: NestFastifyApplication;

beforeAll(async () => {
  process.env.SCO_METRICS_TOKEN = 'test-metrics-token-at-least-32-characters';
  const module = await Test.createTestingModule({ imports: [TestModule] })
    .overrideProvider(RuntimeDatabaseService)
    .useValue(runtimeDatabase)
    .overrideProvider(InternalDatabaseService)
    .useValue(internalDatabase)
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  delete process.env.SCO_METRICS_TOKEN;
  await app?.close();
});

describe('Stage 004 observability foundation', () => {
  it('accepts only bounded log-safe correlation IDs and always returns one', async () => {
    const accepted = await app.inject({ method: 'GET', url: '/health/live', headers: { 'x-correlation-id': 'request-123.safe' } });
    expect(accepted.headers['x-correlation-id']).toBe('request-123.safe');

    const rejected = await app.inject({ method: 'GET', url: '/health/live', headers: { 'x-correlation-id': '../../cookie?token=value' } });
    expect(rejected.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(rejected.headers['x-correlation-id']).not.toContain('token');
  });

  it('redacts secrets and private request material before logging or Sentry delivery', () => {
    const chunks: string[] = [];
    const destination = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk.toString()); callback(); } });
    const logger = createOperationalLogger(destination);
    logger.info(safeFields({
      event: 'test',
      authorization: 'Bearer private-token',
      nested: { password: 'secret', databaseUrl: 'postgresql://admin:secret@db/sco' },
    }));
    const entry = JSON.parse(chunks.join(''));
    expect(entry.authorization).toBe('[REDACTED]');
    expect(entry.nested).toEqual({ password: '[REDACTED]', databaseUrl: '[REDACTED]' });

    const sentry = sanitizeSentryEvent({
      request: { method: 'POST', url: 'https://sco.test/path?token=secret', headers: { cookie: 'sco_session=secret' }, data: { document: 'private' } },
      user: { email: 'private@example.test' },
      extra: { apiKey: 'secret' },
      exception: { values: [{ type: 'DatabaseError', value: 'SELECT private_data FROM commercial_terms' }] },
      breadcrumbs: [{ data: { url: 'https://sco.test/private?email=private@example.test' } }],
    });
    expect(sentry).toEqual({ request: { method: 'POST', url: 'https://sco.test/path' }, extra: { apiKey: '[REDACTED]' }, exception: { values: [{ type: 'DatabaseError', value: '[REDACTED]' }] }, breadcrumbs: [{ data: { url: 'https://sco.test/private' } }] });
  });

  it('returns a safe internal error contract without stack, SQL, path, or credential details', async () => {
    const response = await app.inject({ method: 'GET', url: '/test-observability/failure' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR' } });
    expect(response.body).not.toMatch(/postgres|secret|private-db|\/root/);
    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps metrics private and exports only bounded operational labels', async () => {
    const denied = await app.inject({ method: 'GET', url: '/internal/metrics' });
    expect(denied.statusCode).toBe(404);

    const response = await app.inject({
      method: 'GET',
      url: '/internal/metrics',
      headers: { authorization: `Bearer ${process.env.SCO_METRICS_TOKEN}`, 'x-correlation-id': 'metrics-request' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('sco_http_requests_total');
    expect(response.body).toContain('sco_database_pool_connections');
    expect(response.body).toContain('sco_nodejs_process_cpu');
    expect(response.body).not.toContain('metrics-request');
    expect(response.body).not.toContain(process.env.SCO_METRICS_TOKEN);
  });
});
