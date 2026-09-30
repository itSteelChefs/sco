import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InternalDatabaseService } from '../../database/internal-database.service.js';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

@Injectable()
export class ExecutionService {
  constructor(@Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService, @Inject(TenantTransactionService) private readonly tenants: TenantTransactionService) {}
  async createCycle(actor:string,input:{code:string;name:string;opensAt:string;closesAt:string}) { return this.internal.executionCycleCreate(actor, input); }
  async assign(actor:string, cycleId:string, needId:string, quantity:number, key:string) { if(quantity<=0) throw new BadRequestException({error:{code:'INVALID_QUANTITY'}}); return this.internal.executionAssign(actor, cycleId, needId, quantity, key); }
  async partnerStatus(ctx:TenantContext,itemId:string){return this.tenants.withTenant(ctx.userId,ctx.companyId,async c=>(await c.query(`SELECT CASE status WHEN 'ELIGIBLE' THEN 'RECEIVED' WHEN 'ASSIGNED' THEN 'RECEIVED' WHEN 'IN_PROCESSING' THEN 'IN_PROGRESS' WHEN 'SOURCING_READY' THEN 'SOURCING_IN_PROGRESS' WHEN 'COMPLETED' THEN 'COMPLETED' WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'ACTION_REQUIRED' END AS status,allocated_quantity AS "allocatedQuantity",remaining_quantity AS "remainingQuantity" FROM procurement_execution_items WHERE id=$1`,[itemId])).rows[0]??null);}
}
