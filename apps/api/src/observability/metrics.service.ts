import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { runtimeIdentity } from './telemetry.js';

type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';
type DatabasePool = 'runtime' | 'internal';
type DatabasePoolFailureKind = 'acquire' | 'idle_client';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly requests = new Counter({
    name: 'sco_http_requests_total',
    help: 'Completed HTTP requests',
    labelNames: ['method', 'operation', 'status_class'] as const,
    registers: [this.registry],
  });
  private readonly duration = new Histogram({
    name: 'sco_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'operation', 'status_class'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  private readonly inFlight = new Gauge({
    name: 'sco_http_requests_in_flight',
    help: 'HTTP requests currently in flight',
    registers: [this.registry],
  });
  private readonly readiness = new Gauge({
    name: 'sco_readiness_dependency_up',
    help: 'Required readiness dependency state',
    labelNames: ['dependency'] as const,
    registers: [this.registry],
  });
  private readonly databasePoolConnections = new Gauge({
    name: 'sco_database_pool_connections',
    help: 'PostgreSQL pool connections by state',
    labelNames: ['pool', 'state'] as const,
    registers: [this.registry],
  });
  private readonly databasePoolFailures = new Counter({
    name: 'sco_database_pool_failures_total',
    help: 'PostgreSQL pool acquisition and idle-client failures',
    labelNames: ['pool', 'kind'] as const,
    registers: [this.registry],
  });
  private readonly storageFailures = new Counter({
    name: 'sco_storage_operation_failures_total',
    help: 'Private object storage operation failures',
    labelNames: ['operation'] as const,
    registers: [this.registry],
  });
  private readonly rateLimitedRequests = new Counter({
    name: 'sco_http_rate_limited_total',
    help: 'Requests rejected by the process-local rate limiter',
    labelNames: ['method', 'operation'] as const,
    registers: [this.registry],
  });

  constructor() {
    const identity = runtimeIdentity();
    this.registry.setDefaultLabels({ service: identity.service, environment: identity.environment });
    for (const pool of ['runtime', 'internal'] as const) {
      for (const kind of ['acquire', 'idle_client'] as const) {
        this.databasePoolFailures.inc({ pool, kind }, 0);
      }
    }
    new Gauge({
      name: 'sco_build_info',
      help: 'Current immutable application release identity',
      labelNames: ['release'] as const,
      registers: [this.registry],
    }).set({ release: identity.release }, 1);
    collectDefaultMetrics({ register: this.registry, prefix: 'sco_nodejs_' });
  }

  requestStarted(): void {
    this.inFlight.inc();
  }

  requestCompleted(method: string, operation: string, status: number, seconds: number): void {
    const statusClass = `${Math.floor(status / 100)}xx` as StatusClass;
    const labels = { method, operation, status_class: statusClass };
    this.requests.inc(labels);
    this.duration.observe(labels, seconds);
    this.inFlight.dec();
  }

  setReadiness(dependency: 'runtime_database' | 'internal_database', up: boolean): void {
    this.readiness.set({ dependency }, up ? 1 : 0);
  }

  setDatabasePool(pool: DatabasePool, stats: { total: number; idle: number; waiting: number }): void {
    this.databasePoolConnections.set({ pool, state: 'total' }, stats.total);
    this.databasePoolConnections.set({ pool, state: 'idle' }, stats.idle);
    this.databasePoolConnections.set({ pool, state: 'waiting' }, stats.waiting);
  }

  databasePoolFailure(pool: DatabasePool, kind: DatabasePoolFailureKind): void {
    this.databasePoolFailures.inc({ pool, kind });
  }

  storageFailed(operation: 'read' | 'write'): void {
    this.storageFailures.inc({ operation });
  }

  rateLimited(method: string, policy: 'application' | 'authentication' | 'health', seconds: number): void {
    const labels = { method, operation: policy, status_class: '4xx' as const };
    this.requests.inc(labels);
    this.duration.observe(labels, seconds);
    this.rateLimitedRequests.inc({ method, operation: policy });
  }

  contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}