import { Injectable } from '@nestjs/common';
import {
  InternalDatabaseService,
  type ProcurementIntelligenceRunInput,
} from '../../database/internal-database.service.js';
import {
  PurposeDecisionAuthorityService,
} from '../rbac/purpose-decision-authority.service.js';
import {
  PURPOSE_REQUIREMENT,
  isAllowedPurposeFlow,
} from '../rbac/purpose-registry.js';

export type RunProcurementIntelligenceInput = Omit<
  ProcurementIntelligenceRunInput,
  'actorUserId'
>;

@Injectable()
export class ProcurementIntelligenceService {
  constructor(
    private readonly database: InternalDatabaseService,
    private readonly purposeDecisionAuthority: PurposeDecisionAuthorityService,
  ) {}

  async run(actorUserId: string, input: RunProcurementIntelligenceInput): Promise<{ runId: string; snapshotId: string }> {
    if (!isAllowedPurposeFlow(PURPOSE_REQUIREMENT.PROCUREMENT_INTELLIGENCE)) {
      throw new Error('Procurement Intelligence purpose requirement is not allowed.');
    }
    const decision = await this.purposeDecisionAuthority.issueProcurementIntelligenceRun(
      actorUserId,
      input.sourceBuyingPowerSnapshotId,
    );
    return this.database.runProcurementIntelligence(
      { ...input, actorUserId },
      async (binding) => {
        await this.purposeDecisionAuthority.consumeProcurementIntelligenceRun(
          decision,
          actorUserId,
          input.sourceBuyingPowerSnapshotId,
          binding.backendPid,
          binding.transactionId,
        );
        return decision.decisionId;
      },
    );
  }
}
