import { Controller, Get, HttpStatus, Inject, NotFoundException, Req, Res } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { InternalDatabaseService } from '../database/internal-database.service.js';
import { RuntimeDatabaseService } from '../database/runtime-database.service.js';
import { MetricsService } from './metrics.service.js';

function authorized(header: string | string[] | undefined, configuredToken: string | undefined): boolean {
  if (!configuredToken || configuredToken.length < 32 || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const expected = createHash('sha256').update(configuredToken).digest();
  const supplied = createHash('sha256').update(header.slice(7)).digest();
  return timingSafeEqual(expected, supplied);
}

@Controller('/internal')
export class MetricsController {
  constructor(
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(RuntimeDatabaseService) private readonly runtimeDatabase: RuntimeDatabaseService,
    @Inject(InternalDatabaseService) private readonly internalDatabase: InternalDatabaseService,
  ) {}

  @Get('metrics')
  async render(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    if (!authorized(request.headers.authorization, process.env.SCO_METRICS_TOKEN)) throw new NotFoundException();
    this.metrics.setDatabasePool('runtime', this.runtimeDatabase.poolStats());
    this.metrics.setDatabasePool('internal', this.internalDatabase.poolStats());
    reply.status(HttpStatus.OK).header('content-type', this.metrics.contentType()).header('cache-control', 'no-store').send(await this.metrics.render());
  }
}