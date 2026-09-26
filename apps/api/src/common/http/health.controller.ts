import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { InternalDatabaseService } from '../../database/internal-database.service.js';
import { RuntimeDatabaseService } from '../../database/runtime-database.service.js';

@Controller('/health')
export class HealthController {
  constructor(
    @Inject(RuntimeDatabaseService) private readonly runtimeDatabase: RuntimeDatabaseService,
    @Inject(InternalDatabaseService) private readonly internalDatabase: InternalDatabaseService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await Promise.all([this.runtimeDatabase.ping(), this.internalDatabase.ping()]);
    } catch {
      throw new HttpException({ error: { code: 'NOT_READY' } }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok' };
  }
}