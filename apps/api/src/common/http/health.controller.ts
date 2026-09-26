import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { InternalDatabaseService } from '../../database/internal-database.service.js';
import { RuntimeDatabaseService } from '../../database/runtime-database.service.js';
import { MetricsService } from '../../observability/metrics.service.js';
import { operationalLogger } from '../../observability/telemetry.js';

@Controller('/health')
export class HealthController {
  constructor(
    @Inject(RuntimeDatabaseService) private readonly runtimeDatabase: RuntimeDatabaseService,
    @Inject(InternalDatabaseService) private readonly internalDatabase: InternalDatabaseService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const [runtime, internal] = await Promise.allSettled([this.runtimeDatabase.ping(), this.internalDatabase.ping()]);
    this.metrics.setReadiness('runtime_database', runtime.status === 'fulfilled');
    this.metrics.setReadiness('internal_database', internal.status === 'fulfilled');
    if (runtime.status === 'rejected' || internal.status === 'rejected') {
      operationalLogger.warn({ event: 'readiness_failed', dependencies: [runtime.status === 'rejected' ? 'runtime_database' : undefined, internal.status === 'rejected' ? 'internal_database' : undefined].filter(Boolean) });
      throw new HttpException({ error: { code: 'NOT_READY' } }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok' };
  }
}