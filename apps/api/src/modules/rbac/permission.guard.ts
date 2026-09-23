import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { forbidden } from '../../common/http/api-error.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PERMISSION_KEY } from './require-permission.decorator.js';
import { PermissionsService } from './permissions.service.js';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(PermissionsService) private readonly permissions: PermissionsService) {}
  async canActivate(context: ExecutionContext) {
    const permission = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!permission) return true;
    const tenant = context.switchToHttp().getRequest<{ tenantContext?: TenantContext }>().tenantContext;
    if (!tenant || !(await this.permissions.has(tenant, permission))) throw forbidden();
    return true;
  }
}
