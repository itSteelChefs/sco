import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InternalDatabaseService } from '../../database/internal-database.service.js';

@Injectable()
export class AlternativeProductService {
  constructor(@Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService) {}
  async review(actor: string, proposalId: string, decision: 'APPROVED'|'REJECTED'|'CLARIFICATION_REQUIRED', reason: string, correlationId?: string) {
    if (!reason?.trim()) throw new BadRequestException('REVIEW_REASON_REQUIRED');
    return this.internal.reviewAlternativeProduct(actor, proposalId, decision, reason, correlationId);
  }
}
