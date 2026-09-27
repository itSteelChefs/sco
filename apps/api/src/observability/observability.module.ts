import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard.js';
import { RateLimitService } from '../common/rate-limit/rate-limit.service.js';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { MetricsService } from './metrics.service.js';
import { ObservabilityInterceptor } from './observability.interceptor.js';
import { StructuredLogger } from './structured-logger.js';

@Global()
@Module({
  providers: [
    MetricsService,
    RateLimitService,
    StructuredLogger,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: ObservabilityInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
  exports: [MetricsService, StructuredLogger],
})
export class ObservabilityModule {}