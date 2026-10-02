import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { forbidden } from '../../common/http/api-error.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { PURPOSE_KEY } from './require-purpose.decorator.js';
import type { PurposeRequirement } from './purpose-registry.js';
import { PurposeAuthorizationService } from './purpose-authorization.service.js';

type PurposeRequest = {
  tenantContext?: TenantContext;
  correlationId?: string;
  purposeContext?: {
    actorUserId: string;
    companyId: string;
    purpose: PurposeRequirement;
    correlationId?: string;
  };
};

@Injectable()
export class PurposeGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PurposeAuthorizationService) private readonly purposes: PurposeAuthorizationService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<unknown>(PURPOSE_KEY, [context.getHandler(), context.getClass()]);
    if (!requirement) return true;
    const request = context.switchToHttp().getRequest<PurposeRequest>();
    const tenant = request.tenantContext;
    if (!tenant) throw forbidden();
    if (!this.purposes.allows(tenant, requirement)) {
      const purposeRequirement = requirement as PurposeRequirement;
      await this.audit.record({
        actorUserId: tenant.userId,
        companyId: tenant.companyId,
        scope: 'TENANT',
        action: 'authorization.purpose_denied',
        correlationId: request.correlationId,
        purposeCode: purposeRequirement.purpose,
        flowSource: purposeRequirement.flow?.source,
        flowTarget: purposeRequirement.flow?.target,
        authorizationDecision: 'DENIED',
      });
      throw forbidden();
    }
    request.purposeContext = {
      actorUserId: tenant.userId,
      companyId: tenant.companyId,
      purpose: requirement,
      correlationId: request.correlationId,
    };
    await this.audit.record({
      actorUserId: tenant.userId,
      companyId: tenant.companyId,
      scope: 'TENANT',
      action: 'authorization.purpose_allowed',
      correlationId: request.correlationId,
      purposeCode: requirement.purpose,
      flowSource: requirement.flow?.source,
      flowTarget: requirement.flow?.target,
      authorizationDecision: 'ALLOWED',
    });
    return true;
  }
}