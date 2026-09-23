import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InternalDatabaseService } from '../../database/internal-database.service.js';

@Injectable()
export class RfqService {
  constructor(@Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService) {}
  async create(actor:string,input:{executionItemIds:string[];expiresAt?:string;internalNotes?:string},correlationId?:string){return this.internal.createRfq(actor,input.executionItemIds,input.expiresAt,input.internalNotes,correlationId);}
  async transition(actor: string, id: string, next: string, reason?: string, correlationId?: string) {
    return this.internal.transitionRfq(actor,id,next,reason,correlationId);
  }
  async addRecipient(actor:string,rfqId:string,sourceId:string,correlationId?:string){return this.internal.addRfqRecipient(actor,rfqId,sourceId,correlationId);}
  async recordQuote(actor:string,input:{rfqId:string;purchaseSourceId:string;supplierCompanyId:string;quoteReference?:string;currency:string;items:Array<{rfqItemId:string;productIdentityId:string;quantity:number;unitPrice:number}>},correlationId?:string){const result=await this.internal.recordQuote(actor,input,correlationId);return {quoteId:result.quote_id,revisionId:result.revision_id};}
  async reviseQuote(actor:string,quoteId:string,input:{currency:string;reason:string;items:Array<{rfqItemId:string;productIdentityId:string;quantity:number;unitPrice:number}>},correlationId?:string){return this.internal.reviseQuote(actor,quoteId,input,correlationId);}
  async recordNegotiation(actor:string,input:{rfqId:string;revisionId?:string;direction:string;eventType:string;reason?:string;metadata?:Record<string,unknown>},correlationId?:string){return this.internal.recordNegotiation(actor,input,correlationId);}
  async approveCost(actor:string,input:{rfqItemId:string;revisionId:string;sourceId:string;supplierCompanyId:string;productIdentityId:string;quantity:number;currency:string;unitCost:number;reason:string;selfApprove?:boolean;correlationId?:string}){if(!input.reason?.trim())throw new BadRequestException('APPROVAL_REASON_REQUIRED');return this.internal.approvePurchaseCost(actor,input);}
}
