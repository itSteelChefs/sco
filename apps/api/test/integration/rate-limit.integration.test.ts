import { Controller, Get, Module, Post } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rateLimitConfig } from '../../src/common/rate-limit/rate-limit.config.js';
import { RateLimitService } from '../../src/common/rate-limit/rate-limit.service.js';
import { MetricsService } from '../../src/observability/metrics.service.js';
import { ObservabilityModule } from '../../src/observability/observability.module.js';

@Controller()
class RateLimitTestController {
  @Get('/limited')
  limited() { return { ok: true }; }

  @Get('/health/live')
  live() { return { status: 'ok' }; }

  @Get('/health/ready')
  ready() { return { status: 'ok' }; }

  @Post('/api/v1/auth/login')
  login() { return { ok: true }; }

  @Post('/limited-body')
  body() { return { ok: true }; }
}

@Module({ imports: [ObservabilityModule], controllers: [RateLimitTestController] })
class RateLimitTestModule {}

describe('Stage 004 process-local rate limiting', () => {
  let app: NestFastifyApplication;
  const originalDeployment = process.env.SCO_DEPLOY_ENVIRONMENT;

  beforeAll(async () => {
    process.env.SCO_DEPLOY_ENVIRONMENT = 'test';
    process.env.SCO_RATE_LIMIT_MAX = '2';
    process.env.SCO_RATE_LIMIT_WINDOW_MS = '1000';
    process.env.SCO_RATE_LIMIT_AUTH_MAX = '1';
    process.env.SCO_RATE_LIMIT_AUTH_WINDOW_MS = '1000';
    process.env.SCO_RATE_LIMIT_HEALTH_MAX = '2';
    process.env.SCO_RATE_LIMIT_HEALTH_WINDOW_MS = '1000';
    process.env.SCO_RATE_LIMIT_MAX_CLIENTS = '10';
    const module = await Test.createTestingModule({ imports: [RateLimitTestModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ trustProxy: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    delete process.env.SCO_RATE_LIMIT_MAX;
    delete process.env.SCO_RATE_LIMIT_WINDOW_MS;
    delete process.env.SCO_RATE_LIMIT_AUTH_MAX;
    delete process.env.SCO_RATE_LIMIT_AUTH_WINDOW_MS;
    delete process.env.SCO_RATE_LIMIT_HEALTH_MAX;
    delete process.env.SCO_RATE_LIMIT_HEALTH_WINDOW_MS;
    delete process.env.SCO_RATE_LIMIT_MAX_CLIENTS;
    if (originalDeployment === undefined) delete process.env.SCO_DEPLOY_ENVIRONMENT;
    else process.env.SCO_DEPLOY_ENVIRONMENT = originalDeployment;
    await app?.close();
  });

  it('allows normal traffic, returns a safe 429, and records a bounded metric', async () => {
    const options = { method: 'GET' as const, url: '/limited', remoteAddress: '192.0.2.10' };
    expect((await app.inject(options)).statusCode).toBe(200);
    expect((await app.inject(options)).statusCode).toBe(200);
    const limited = await app.inject(options);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: { code: 'TOO_MANY_REQUESTS' } });
    expect(limited.headers['retry-after']).toBe('1');
    const metrics = await app.get(MetricsService).render();
    expect(metrics).toContain('sco_http_rate_limited_total');
    expect(metrics).toMatch(/sco_http_requests_total\{[^}]*method="GET"[^}]*operation="application"[^}]*status_class="4xx"[^}]*\} 1/);
    expect(metrics).not.toContain('192.0.2.10');
  });

  it('does not trust forwarding headers and keeps direct peers separate', async () => {
    const forged = (forwarded: string) => app.inject({
      method: 'GET',
      url: '/limited',
      remoteAddress: '192.0.2.20',
      headers: { 'x-forwarded-for': forwarded },
    });
    expect((await forged('198.51.100.1')).statusCode).toBe(200);
    expect((await forged('198.51.100.2')).statusCode).toBe(200);
    expect((await forged('198.51.100.3')).statusCode).toBe(429);
    expect((await app.inject({ method: 'GET', url: '/limited', remoteAddress: '192.0.2.21' })).statusCode).toBe(200);
  });

  it('keeps liveness exempt and resets expired windows', async () => {
    for (let request = 0; request < 5; request += 1) {
      expect((await app.inject({ method: 'GET', url: '/health/live', remoteAddress: '192.0.2.30' })).statusCode).toBe(200);
    }
    const limiter = app.get(RateLimitService);
    expect(limiter.consume('application', 'clock-client', 1_000).allowed).toBe(true);
    expect(limiter.consume('application', 'clock-client', 1_001).allowed).toBe(true);
    expect(limiter.consume('application', 'clock-client', 1_002).allowed).toBe(false);
    expect(limiter.consume('application', 'clock-client', 2_000).allowed).toBe(true);
  });

  it('bounds readiness database probes with a separate health policy', async () => {
    const options = { method: 'GET' as const, url: '/health/ready', remoteAddress: '192.0.2.31' };
    expect((await app.inject(options)).statusCode).toBe(200);
    expect((await app.inject(options)).statusCode).toBe(200);
    expect((await app.inject(options)).statusCode).toBe(429);
    expect((await app.inject({ method: 'GET', url: '/health/live', remoteAddress: '192.0.2.31' })).statusCode).toBe(200);
  });

  it('uses a separate authentication policy', async () => {
    const options = { method: 'POST' as const, url: '/api/v1/auth/login', remoteAddress: '192.0.2.40' };
    expect((await app.inject(options)).statusCode).toBe(201);
    expect((await app.inject(options)).statusCode).toBe(429);
    const metrics = await app.get(MetricsService).render();
    expect(metrics).toContain('operation="authentication"');
  });

  it('requires explicit deployment limits and refuses proxy trust', () => {
    expect(() => rateLimitConfig({ NODE_ENV: 'production' })).toThrow(/required for staging and production/);
    expect(() => rateLimitConfig({ NODE_ENV: 'test', SCO_TRUST_PROXY: 'true' })).toThrow(/false or trusted-peers/);
    expect(() => rateLimitConfig({ NODE_ENV: 'test', SCO_TRUST_PROXY: 'trusted-peers' })).toThrow(/TRUSTED_PROXY_PEERS is required/);
    expect(() => rateLimitConfig({ NODE_ENV: 'test', SCO_TRUST_PROXY: 'trusted-peers', SCO_TRUSTED_PROXY_PEERS: '127.0.0.1, invalid' })).toThrow(/comma-separated list/);
    expect(rateLimitConfig({ SCO_DEPLOY_ENVIRONMENT: 'production', SCO_RATE_LIMIT_ENABLED: 'false' }).enabled).toBe(false);
    const deploymentLimits = { SCO_DEPLOY_ENVIRONMENT: 'staging', SCO_RATE_LIMIT_MAX: '120', SCO_RATE_LIMIT_WINDOW_MS: '60000', SCO_RATE_LIMIT_AUTH_MAX: '20', SCO_RATE_LIMIT_AUTH_WINDOW_MS: '60000', SCO_RATE_LIMIT_HEALTH_MAX: '120', SCO_RATE_LIMIT_HEALTH_WINDOW_MS: '60000' };
    expect(() => rateLimitConfig(deploymentLimits)).toThrow(/CLIENT_IDENTITY is required/);
    expect(rateLimitConfig({ ...deploymentLimits, SCO_RATE_LIMIT_CLIENT_IDENTITY: 'direct-peer' }).enabled).toBe(true);
    expect(rateLimitConfig({ ...deploymentLimits, SCO_RATE_LIMIT_CLIENT_IDENTITY: 'trusted-proxy', SCO_TRUST_PROXY: 'trusted-peers', SCO_TRUSTED_PROXY_PEERS: '127.0.0.1' }).trustedProxyPeers).toEqual(['127.0.0.1']);
  });

  it('uses one forwarded client IP only from a configured proxy peer', () => {
    const originalTrust = process.env.SCO_TRUST_PROXY;
    const originalPeers = process.env.SCO_TRUSTED_PROXY_PEERS;
    const originalIdentity = process.env.SCO_RATE_LIMIT_CLIENT_IDENTITY;
    process.env.SCO_TRUST_PROXY = 'trusted-peers';
    process.env.SCO_TRUSTED_PROXY_PEERS = '127.0.0.1';
    process.env.SCO_RATE_LIMIT_CLIENT_IDENTITY = 'trusted-proxy';
    try {
      const limiter = new RateLimitService();
      const trustedRequest = { ip: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.10' } } as never;
      const spoofedChain = { ip: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.10, 203.0.113.4', 'x-real-ip': '198.51.100.99', forwarded: 'for=198.51.100.99' } } as never;
      const untrustedRequest = { ip: '192.0.2.10', headers: { 'x-forwarded-for': '198.51.100.10', 'x-real-ip': '198.51.100.99', forwarded: 'for=198.51.100.99' } } as never;
      expect(limiter.clientIdentity(trustedRequest)).toBe('198.51.100.10');
      expect(limiter.clientIdentity(spoofedChain)).toBe('127.0.0.1');
      expect(limiter.clientIdentity(untrustedRequest)).toBe('192.0.2.10');
      expect(limiter.consume('application', limiter.clientIdentity(trustedRequest), 10_000).allowed).toBe(true);
      expect(limiter.consume('application', '198.51.100.11', 10_000).allowed).toBe(true);
      expect(limiter.consume('application', limiter.clientIdentity(trustedRequest), 10_001).allowed).toBe(true);
      expect(limiter.consume('application', limiter.clientIdentity(trustedRequest), 10_002).allowed).toBe(false);
    } finally {
      if (originalTrust === undefined) delete process.env.SCO_TRUST_PROXY;
      else process.env.SCO_TRUST_PROXY = originalTrust;
      if (originalPeers === undefined) delete process.env.SCO_TRUSTED_PROXY_PEERS;
      else process.env.SCO_TRUSTED_PROXY_PEERS = originalPeers;
      if (originalIdentity === undefined) delete process.env.SCO_RATE_LIMIT_CLIENT_IDENTITY;
      else process.env.SCO_RATE_LIMIT_CLIENT_IDENTITY = originalIdentity;
    }
  });

  it('keeps counters local to one API process', () => {
    const firstProcess = new RateLimitService();
    const secondProcess = new RateLimitService();
    expect(firstProcess.consume('application', 'client', 10_000).allowed).toBe(true);
    expect(firstProcess.consume('application', 'client', 10_001).allowed).toBe(true);
    expect(firstProcess.consume('application', 'client', 10_002).allowed).toBe(false);
    expect(secondProcess.consume('application', 'client', 10_002).allowed).toBe(true);
  });

  it('bounds client state and recovers when full windows expire', () => {
    const originalMaximum = process.env.SCO_RATE_LIMIT_MAX_CLIENTS;
    process.env.SCO_RATE_LIMIT_MAX_CLIENTS = '1';
    try {
      const bounded = new RateLimitService();
      expect(bounded.consume('application', 'first-client', 10_000).allowed).toBe(true);
      expect(bounded.consume('application', 'churned-client', 10_001)).toEqual({ allowed: false, retryAfterSeconds: 1 });
      expect(bounded.consume('application', 'churned-client', 11_000).allowed).toBe(true);
    } finally {
      if (originalMaximum === undefined) delete process.env.SCO_RATE_LIMIT_MAX_CLIENTS;
      else process.env.SCO_RATE_LIMIT_MAX_CLIENTS = originalMaximum;
    }
  });

  it('rejects malformed and oversized JSON before controller execution', async () => {
    const malformed = await app.inject({ method: 'POST', url: '/limited-body', headers: { 'content-type': 'application/json' }, payload: '{' });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.statusCode).toBeLessThan(500);
    const oversized = await app.inject({
      method: 'POST',
      url: '/limited-body',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ value: 'x'.repeat(1_100_000) }),
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.body.length).toBeLessThan(512);
  });
});