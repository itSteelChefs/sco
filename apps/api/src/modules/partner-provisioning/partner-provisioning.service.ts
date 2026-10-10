import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiError, forbidden } from '../../common/http/api-error.js';
import { InternalDatabaseService } from '../../database/internal-database.service.js';
import type { PartnerMembershipProvisionInput, PartnerMembershipProvisionResult } from './partner-provisioning.types.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
@Injectable()
export class PartnerProvisioningService {
  constructor(@Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService) {}
  async provision(actor: string, input: PartnerMembershipProvisionInput): Promise<PartnerMembershipProvisionResult> {
    if (!input || !uuid.test(input.targetUserId) || !uuid.test(input.targetCompanyId)
      || typeof input.operationKey !== 'string' || !input.operationKey.trim() || input.operationKey.length > 128) {
      throw new ApiError('PARTNER_PROVISIONING_INPUT_INVALID', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.internal.provisionPartnerMembership(actor, input.targetUserId, input.targetCompanyId, input.operationKey);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'PARTNER_PROVISION_IDEMPOTENCY_CONFLICT') {
        throw new ApiError(code, HttpStatus.CONFLICT);
      }
      if (code.startsWith('PARTNER_PROVISION_')) throw forbidden();
      throw error;
    }
  }
}
