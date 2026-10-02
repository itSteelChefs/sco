import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import { InternalDatabaseService } from '../../database/internal-database.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

@Injectable()
export class PlanningService {
  constructor(
    @Inject(TenantTransactionService) private readonly tenants: TenantTransactionService,
    @Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService,
  ) {}
  async createProject(ctx: TenantContext, input: { code: string; name: string }) { return this.tenants.withTenant(ctx.userId,ctx.companyId,async c=>(await c.query(`INSERT INTO projects(company_id,code,name,created_by) VALUES($1,$2,$3,$4) RETURNING id,code,name,status`,[ctx.companyId,input.code,input.name,ctx.userId])).rows[0]); }
  async createNeed(ctx: TenantContext,input:{description:string;quantity:number;unitId?:string;needDate:string;projectId?:string;productIdentityId?:string;productCandidateId?:string}) {
    if(input.quantity<=0) throw new BadRequestException({error:{code:'INVALID_QUANTITY'}});
    return this.internal.createProcurementNeed(ctx.userId, ctx.companyId, input, randomUUID());
  }
}
