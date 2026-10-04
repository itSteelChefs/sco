import { Injectable } from '@nestjs/common';
import {
  InternalDatabaseService,
  type ServiceEntitlementState,
  type ServiceAccessWorkspaceSummary,
} from '../../database/internal-database.service.js';
import { PurposeDecisionAuthorityService } from '../rbac/purpose-decision-authority.service.js';

export type GrantServiceAccessInput = {
  actorUserId: string;
  targetCompanyId: string;
  serviceCode: string;
  expiresAt: string;
  idempotencyKey: string;
  correlationId?: string;
};

export type AuthorizeServiceAccessInput = {
  targetCompanyId: string;
  serviceCode: string;
  resourceContext: string;
  correlationId?: string;
};

@Injectable()
export class ServiceAccessService {
  constructor(
    private readonly database: InternalDatabaseService,
    private readonly purposeDecisions: PurposeDecisionAuthorityService,
  ) {}

  async setEntitlement(
    actorUserId: string,
    companyId: string,
    serviceCode: string,
    state: ServiceEntitlementState,
  ): Promise<string> {
    return this.database.setServiceEntitlement(actorUserId, companyId, serviceCode, state);
  }

  async grant(issuerUserId: string, input: GrantServiceAccessInput): Promise<string> {
    return this.database.createServiceAccessGrant(
      issuerUserId,
      input.actorUserId,
      input.targetCompanyId,
      input.serviceCode,
      input.expiresAt,
      input.idempotencyKey,
      input.correlationId,
    );
  }

  async revoke(issuerUserId: string, grantId: string, reason: string, correlationId?: string): Promise<void> {
    await this.database.revokeServiceAccessGrant(issuerUserId, grantId, reason, correlationId);
  }

  async authorize(actorUserId: string, input: AuthorizeServiceAccessInput): Promise<string> {
    const decisionId = await this.purposeDecisions.issueServiceAccessOperation(
      actorUserId,
      input.targetCompanyId,
      input.serviceCode,
      input.resourceContext,
    );
    return this.database.authorizeServiceAccess(
      {
        actorUserId,
        targetCompanyId: input.targetCompanyId,
        serviceCode: input.serviceCode,
        resourceContext: input.resourceContext,
        correlationId: input.correlationId,
      },
      async (binding) => {
        await this.purposeDecisions.consumeServiceAccessOperation(
          decisionId,
          actorUserId,
          input.targetCompanyId,
          input.serviceCode,
          input.resourceContext,
          binding.backendPid,
          binding.transactionId,
        );
        return decisionId;
      },
    );
  }

  async workspaceSummary(
    actorUserId: string,
    targetCompanyId: string,
    serviceCode: string,
    correlationId?: string,
  ): Promise<ServiceAccessWorkspaceSummary> {
    const resourceContext = `partner-workspace:${targetCompanyId}`;
    const decisionId = await this.purposeDecisions.issueServiceAccessOperation(
      actorUserId,
      targetCompanyId,
      serviceCode,
      resourceContext,
    );
    return this.database.getServiceAccessWorkspace(
      {
        actorUserId,
        targetCompanyId,
        serviceCode,
        resourceContext,
        correlationId,
      },
      async (binding) => {
        await this.purposeDecisions.consumeServiceAccessOperation(
          decisionId,
          actorUserId,
          targetCompanyId,
          serviceCode,
          resourceContext,
          binding.backendPid,
          binding.transactionId,
        );
        return decisionId;
      },
    );
  }
}
