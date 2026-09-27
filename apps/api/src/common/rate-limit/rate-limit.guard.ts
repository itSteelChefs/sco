import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MetricsService } from '../../observability/metrics.service.js';
import { RateLimitService } from './rate-limit.service.js';

const exemptPaths = new Set(['/health/live']);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(RateLimitService) private readonly limiter: RateLimitService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<FastifyRequest & { correlationId?: string }>();
    const operation = request.routeOptions.url ?? 'unknown';
    if (exemptPaths.has(operation)) return true;
    const started = process.hrtime.bigint();
    const policy = operation === '/api/v1/auth/login' ? 'authentication'
      : operation === '/health/ready' ? 'health'
        : 'application';
    const result = this.limiter.consume(policy, request.ip);
    if (result.allowed) return true;
    const response = context.switchToHttp().getResponse<FastifyReply>();
    response.header('retry-after', String(result.retryAfterSeconds));
    this.metrics.rateLimited(request.method, policy, Number(process.hrtime.bigint() - started) / 1_000_000_000);
    throw new HttpException({ error: { code: 'TOO_MANY_REQUESTS' } }, HttpStatus.TOO_MANY_REQUESTS);
  }
}