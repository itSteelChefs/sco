import { BadRequestException, Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { ScoInternalGuard } from '../identity/sco-internal.guard.js';
import { InternalDatabaseService } from '../../database/internal-database.service.js';

@Controller('/api/v1/internal/documents')
@UseGuards(AuthGuard, ScoInternalGuard)
export class InternalDocumentCenterController {
  constructor(@Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService) {}

  @Get()
  list(@Req() req: RequestWithAuth, @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    const pageNumber = Number(page);
    const size = Number(pageSize);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isInteger(size) || size < 1 || size > 100) {
      throw new BadRequestException({ error: { code: 'VALIDATION_FAILED' } });
    }
    return this.internal.documentList(req.scoUser!.id, size, (pageNumber - 1) * size).then((items) => ({ items, page: pageNumber, pageSize: size }));
  }
}
