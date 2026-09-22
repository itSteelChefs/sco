import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { TenantContext } from './tenant-context.js';

export const Tenant = createParamDecorator((_data: unknown, context: ExecutionContext): TenantContext => {
  return context.switchToHttp().getRequest<{ tenantContext: TenantContext }>().tenantContext;
});
