import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { isAllowedPurposeFlow, isPurposeRequirement, type PurposeRequirement } from './purpose-registry.js';

@Injectable()
export class PurposeAuthorizationService {
  allows(context: TenantContext | undefined, requirement: unknown): requirement is PurposeRequirement {
    return Boolean(context) && isPurposeRequirement(requirement) && isAllowedPurposeFlow(requirement);
  }
}