import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { forbidden } from '../../common/http/api-error.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { PurposeRequirement } from '../rbac/purpose-registry.js';
import { operationDescriptor } from './authorization-operations.js';
import { AUTHORIZED_OPERATION_KEY } from './require-authorization.decorator.js';
import { ResourceAuthorizationService } from './resource-authorization.service.js';

type AuthorizedRequest = {
  tenantContext?: TenantContext;
  correlationId?: string;
  params?: Record<string, unknown>;
  purposeContext?: { actorUserId: string; companyId: string; purpose: PurposeRequirement; correlationId?: string };
};

// Single HTTP entry point for composed resource authorization. Runs after AuthGuard + TenantGuard. Fails closed when a
// route declares no operation, so the guard can never silently pass an undeclared route.
@Injectable()
export class ResourceAuthorizationGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ResourceAuthorizationService) private readonly authorization: ResourceAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const operation = this.reflector.getAllAndOverride<unknown>(AUTHORIZED_OPERATION_KEY, [context.getHandler(), context.getClass()]);
    const descriptor = operationDescriptor(operation);
    if (!descriptor) throw forbidden();
    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const decision = await this.authorization.require({
      tenant: request.tenantContext,
      operation,
      resource: descriptor.resource.routeParam === null ? undefined : { id: request.params?.[descriptor.resource.routeParam] },
      correlationId: request.correlationId,
    });
    const tenant = request.tenantContext as TenantContext;
    request.purposeContext = { actorUserId: tenant.userId, companyId: tenant.companyId, purpose: decision.purpose, correlationId: request.correlationId };
    return true;
  }
}
