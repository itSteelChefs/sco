import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

@Injectable()
export class PlanningService {
  constructor(@Inject(TenantTransactionService) private readonly tenants: TenantTransactionService) {}
  async createProject(ctx: TenantContext, input: { code: string; name: string }) { return this.tenants.withTenant(ctx.userId,ctx.companyId,async c=>(await c.query(`INSERT INTO projects(company_id,code,name,created_by) VALUES($1,$2,$3,$4) RETURNING id,code,name,status`,[ctx.companyId,input.code,input.name,ctx.userId])).rows[0]); }
  async createNeed(ctx: TenantContext,input:{description:string;quantity:number;unitId?:string;needDate:string;projectId?:string;productIdentityId?:string;productCandidateId?:string}) { if(input.quantity<=0) throw new BadRequestException({error:{code:'INVALID_QUANTITY'}}); return this.tenants.withTenant(ctx.userId,ctx.companyId,async c=>(await c.query(`INSERT INTO procurement_needs(company_id,created_by,source_type,description,quantity,unit_id,need_date,project_id,product_identity_id,product_candidate_id) VALUES($1,$2,'MANUAL',$3,$4,$5,$6,$7,$8,$9) RETURNING id,description,quantity,maturity`,[ctx.companyId,ctx.userId,input.description,input.quantity,input.unitId??null,input.needDate,input.projectId??null,input.productIdentityId??null,input.productCandidateId??null])).rows[0]); }
}
