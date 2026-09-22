import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { forbidden, unauthenticated } from '../http/api-error.js';
import { MembershipsService } from '../../modules/identity/memberships.service.js';
import type { RequestWithAuth } from '../../modules/auth/guards/auth.guard.js';
import type { TenantContext } from './tenant-context.js';

type TenantRequest = RequestWithAuth & { tenantContext?: TenantContext };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(@Inject(MembershipsService) private readonly memberships: MembershipsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    if (!request.scoUser) throw unauthenticated();
    const header = request.headers['x-sco-company-id'];
    const companyId = Array.isArray(header) ? undefined : header;
    if (companyId !== undefined && !uuidPattern.test(companyId)) throw forbidden();
    request.tenantContext = await this.memberships.requireActiveMembership(request.scoUser.id, companyId);
    return true;
  }
}
