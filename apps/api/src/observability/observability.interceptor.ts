import { CallHandler, ExecutionContext, HttpException, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { finalize, tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service.js';
import { operationalLogger, safeFields } from './telemetry.js';

type ObservedRequest = { method?: string; correlationId?: string };
type ObservedResponse = { statusCode?: number };

@Injectable()
export class ObservabilityInterceptor implements NestInterceptor {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<ObservedRequest>();
    const response = context.switchToHttp().getResponse<ObservedResponse>();
    const method = request.method ?? 'UNKNOWN';
    const operation = `${context.getClass().name}.${context.getHandler().name}`;
    const started = process.hrtime.bigint();
    let errorStatus: number | undefined;
    this.metrics.requestStarted();

    return next.handle().pipe(
      tap({ error: (error) => { errorStatus = error instanceof HttpException ? error.getStatus() : 500; } }),
      finalize(() => {
        const status = errorStatus ?? response.statusCode ?? 200;
        const durationSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
        this.metrics.requestCompleted(method, operation, status, durationSeconds);
        const event = status === 401 ? 'authentication_failed'
          : status === 403 ? 'authorization_denied'
            : status === 400 ? 'invalid_request'
              : status === 404 ? 'request_not_found'
            : status >= 500 ? 'request_failed'
              : 'request_completed';
        const fields = safeFields({ event, request_id: request.correlationId, method, operation, status, duration_ms: Math.round(durationSeconds * 1000) });
        if (status >= 400) operationalLogger.warn(fields);
        else operationalLogger.info(fields);
      }),
    );
  }
}