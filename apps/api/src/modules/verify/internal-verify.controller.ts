import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { ScoInternalGuard } from '../identity/sco-internal.guard.js';
import { InternalDatabaseService } from '../../database/internal-database.service.js';
import { VerifySystemDatabaseService } from './verify-system-database.service.js';

type OperationalResultBody = {
  offerValue?: unknown; verifiedReferenceScope?: unknown; gap?: unknown; confidence?: unknown;
  proposedAction: string; exclusions?: unknown; supersedesResultId?: string;
};

@Controller('/api/v1/internal/verify')
@UseGuards(AuthGuard, ScoInternalGuard)
export class InternalVerifyController {
  constructor(
    @Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService,
    @Inject(VerifySystemDatabaseService) private readonly system: VerifySystemDatabaseService,
  ) {}

  @Get('queue')
  queue(@Req() req: RequestWithAuth, @Query('page') page = '1', @Query('pageSize') pageSize = '20', @Query('status') status?: string) {
    const pageNumber = Number(page); const size = Number(pageSize);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isInteger(size) || size < 1 || size > 100) throw new BadRequestException({ error: { code: 'VALIDATION_FAILED' } });
    return this.internal.verifyQueue(req.scoUser!.id, size, (pageNumber - 1) * size, status).then((items) => ({ items, page: pageNumber, pageSize: size }));
  }

  @Post('revisions/:revisionId/runs')
  startRun(@Param('revisionId', ParseUUIDPipe) revisionId: string, @Body() body: { methodologyVersion: string; evidenceFingerprint: string; retryOfRunId?: string }) {
    return this.system.createRun(revisionId, body.methodologyVersion, body.evidenceFingerprint, body.retryOfRunId).then((runId) => this.system.startRun(runId).then(() => ({ runId, status: 'RUNNING' })));
  }

  @Post('runs/:runId/lines/:lineId/result')
  lineResult(@Param('runId', ParseUUIDPipe) runId: string, @Param('lineId', ParseUUIDPipe) lineId: string, @Body() body: { outcome: 'VERIFIED' | 'INSUFFICIENT_EVIDENCE' | 'EXCLUDED'; reason?: string }) {
    return this.system.recordLineResult(runId, lineId, body.outcome, body.reason).then((resultId) => ({ resultId }));
  }

  @Post('runs/:runId/complete')
  complete(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.system.completeRun(runId).then(() => ({ runId, status: 'COMPLETED' }));
  }

  @Post('runs/:runId/analysis')
  prepare(@Req() req: RequestWithAuth, @Param('runId', ParseUUIDPipe) runId: string, @Body() body: OperationalResultBody) {
    return this.internal.prepareOperationalVerifyResult(req.scoUser!.id, { ...body, runId }).then((resultId) => ({ resultId, status: 'PREPARED' }));
  }

  @Post('results/:resultId/approve')
  approve(@Req() req: RequestWithAuth, @Param('resultId', ParseUUIDPipe) resultId: string) {
    return this.internal.finalizeVerifyResult(req.scoUser!.id, resultId).then(() => ({ resultId, status: 'FINAL' }));
  }
}
