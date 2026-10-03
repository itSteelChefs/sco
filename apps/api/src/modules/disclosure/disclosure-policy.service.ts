import { Injectable } from '@nestjs/common';
import {
  DISCLOSURE_LEVEL,
  IDENTITY_CLASS,
  RECIPIENT_CONTEXT,
  type DisclosureDecision,
  type DisclosureRequest,
} from './disclosure.types.js';

@Injectable()
export class DisclosurePolicyService {
  decide(request: DisclosureRequest): DisclosureDecision {
    const auditContext = {
      identityClass: request.identityClass,
      recipientContext: request.recipientContext,
      resourceType: request.resourceType,
      resourceId: request.resourceId,
      operation: request.operation,
    };

    if (request.embeddedIdentityClassification !== 'NONE') {
      return { appliedLevel: DISCLOSURE_LEVEL.HIDDEN, reasonCode: 'EMBEDDED_IDENTITY_RISK_UNCONTROLLED', policyVersion: '008-A', requiresAliasResolution: false, auditContext };
    }
    if (request.recipientContext === RECIPIENT_CONTEXT.PARTNER && request.identityClass === IDENTITY_CLASS.PROJECT_SITE && request.operation === 'PRESENT_ALIAS') {
      return { appliedLevel: DISCLOSURE_LEVEL.ALIAS, reasonCode: 'PARTNER_PROJECT_SITE_ALIAS', policyVersion: '008-A', requiresAliasResolution: true, auditContext };
    }
    return { appliedLevel: DISCLOSURE_LEVEL.HIDDEN, reasonCode: 'DISCLOSURE_POLICY_UNSUPPORTED', policyVersion: '008-A', requiresAliasResolution: false, auditContext };
  }
}
