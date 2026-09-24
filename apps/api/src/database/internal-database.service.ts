import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

export type PricingAllocationInput = { snapshotId: string; quantity: number; fxRate?: number; asOfDate?: string; fxReason?: string };
export type PricingLineInput = { lineNumber: number; productIdentityId: string; quantity: number; unitId: string; unitSellingPrice: number; taxTreatmentCode?: string; taxRate?: number; taxAmount?: number; allocations: PricingAllocationInput[] };
export type DirectDealCostInput = { lineNumber: number; type: string; description?: string; currency: string; amount: number; fxRate?: number; asOfDate?: string; fxReason?: string };
export type CreatePricingInput = { caseId?: string; partnerCompanyId: string; currency: string; lines: PricingLineInput[]; directCosts?: DirectDealCostInput[]; overhead?: number; overheadReason?: string; correlationId?: string };
@Injectable()
export class InternalDatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
  async onModuleDestroy() { await this.pool.end(); }
  async canSelfApprovePurchaseCost(actorId: string): Promise<boolean> { const result=await this.pool.query('SELECT public.can_self_approve_purchase_cost($1) AS allowed',[actorId]); return result.rows[0].allowed===true; }
  async canApprovePurchaseCost(actorId: string): Promise<boolean> { const result=await this.pool.query('SELECT public.can_approve_purchase_cost($1) AS allowed',[actorId]); return result.rows[0].allowed===true; }
  async supplierQuoteDocument(actorId: string, documentId: string) { const result=await this.pool.query<{filename:string;detected_mime_type:string;byte_size:number;storage_key:string}>('SELECT * FROM public.get_supplier_quote_document($1,$2)',[documentId,actorId]); return result.rows[0] ?? null; }
  async createRfq(actor:string, executionItemIds:string[], expiresAt?:string, notes?:string, correlationId?:string) { return (await this.pool.query('SELECT public.internal_rfq_create($1,$2::uuid[],$3,$4,$5) AS id',[actor,executionItemIds,expiresAt??null,notes??null,correlationId??null])).rows[0]; }
  async transitionRfq(actor:string,id:string,next:string,reason?:string,correlationId?:string) { return (await this.pool.query('SELECT * FROM public.internal_rfq_transition($1,$2,$3,$4,$5)',[actor,id,next,reason??null,correlationId??null])).rows[0]; }
  async addRfqRecipient(actor:string,rfqId:string,sourceId:string,correlationId?:string) { return (await this.pool.query('SELECT * FROM public.internal_rfq_add_recipient($1,$2,$3,$4)',[actor,rfqId,sourceId,correlationId??null])).rows[0]; }
  async recordQuote(actor:string,input:{rfqId:string;purchaseSourceId:string;supplierCompanyId:string;quoteReference?:string;currency:string;items:Array<{rfqItemId:string;productIdentityId:string;quantity:number;unitPrice:number}>},correlationId?:string) { return (await this.pool.query('SELECT * FROM public.internal_quote_record($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',[actor,input.rfqId,input.purchaseSourceId,input.supplierCompanyId,input.quoteReference??null,input.currency,JSON.stringify(input.items),correlationId??null])).rows[0]; }
  async reviseQuote(actor:string,quoteId:string,input:{currency:string;reason:string;items:Array<{rfqItemId:string;productIdentityId:string;quantity:number;unitPrice:number}>},correlationId?:string) { return (await this.pool.query('SELECT * FROM public.internal_quote_revise($1,$2,$3,$4,$5::jsonb,$6)',[actor,quoteId,input.currency,input.reason,JSON.stringify(input.items),correlationId??null])).rows[0]; }
  async recordNegotiation(actor:string,input:{rfqId:string;revisionId?:string;direction:string;eventType:string;reason?:string;metadata?:Record<string,unknown>},correlationId?:string) { return (await this.pool.query('SELECT public.internal_negotiation_record($1,$2,$3,$4,$5,$6,$7::jsonb,$8) AS id',[actor,input.rfqId,input.revisionId??null,input.direction,input.eventType,input.reason??null,JSON.stringify(input.metadata??{}),correlationId??null])).rows[0]; }
  async approvePurchaseCost(actor:string,input:{rfqItemId:string;revisionId:string;sourceId:string;supplierCompanyId:string;productIdentityId:string;quantity:number;currency:string;unitCost:number;reason:string;selfApprove?:boolean;correlationId?:string}) { return (await this.pool.query('SELECT public.internal_purchase_cost_approve($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS id',[actor,input.rfqItemId,input.revisionId,input.sourceId,input.supplierCompanyId,input.productIdentityId,input.quantity,input.currency,input.unitCost,input.reason,Boolean(input.selfApprove),input.correlationId??null])).rows[0]; }
  async reviewAlternativeProduct(actor:string,id:string,decision:string,reason:string,correlationId?:string) { return (await this.pool.query('SELECT * FROM public.internal_alternative_product_review($1,$2,$3,$4,$5)',[actor,id,decision,reason,correlationId??null])).rows[0]; }
  async getRfq(actor:string,id:string) { return (await this.pool.query('SELECT * FROM public.internal_rfq_get($1,$2)',[actor,id])).rows[0]??null; }
  async getQuote(actor:string,id:string) { return (await this.pool.query('SELECT * FROM public.internal_quote_get($1,$2)',[actor,id])).rows[0]??null; }
  async getNegotiationEvents(actor:string,id:string) { return (await this.pool.query('SELECT * FROM public.internal_negotiation_events($1,$2)',[actor,id])).rows; }
  async getPurchaseCost(actor:string,id:string) { return (await this.pool.query('SELECT * FROM public.internal_purchase_cost_get($1,$2)',[actor,id])).rows[0]??null; }
  async createPricing(actor: string, input: CreatePricingInput) {
    const row = (await this.pool.query<{ id: string }>('SELECT public.internal_pricing_create($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9) AS id', [actor, input.caseId ?? null, input.partnerCompanyId, input.currency, JSON.stringify(input.lines), JSON.stringify(input.directCosts ?? []), input.overhead ?? 0, input.overheadReason ?? null, input.correlationId ?? null])).rows[0];
    return { revisionId: row.id };
  }
  async submitPricing(actor: string, revisionId: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_pricing_submit($1,$2,$3)', [actor, revisionId, correlationId ?? null]);
  }
  async decidePricing(actor: string, revisionId: string, decision: 'APPROVED' | 'REJECTED', reason?: string, selfApprove = false, correlationId?: string) {
    await this.pool.query('SELECT public.internal_pricing_decide($1,$2,$3,$4,$5,$6)', [actor, revisionId, decision, reason ?? null, selfApprove, correlationId ?? null]);
  }
  async getPricing(actor: string, revisionId: string) { return (await this.pool.query('SELECT * FROM public.internal_pricing_get($1,$2)', [actor, revisionId])).rows[0] ?? null; }
  async getPricingMargin(actor: string, revisionId: string) { return (await this.pool.query('SELECT * FROM public.internal_pricing_margin_get($1,$2)', [actor, revisionId])).rows[0] ?? null; }
  async getPricingOverhead(actor: string, revisionId: string) { return (await this.pool.query('SELECT * FROM public.internal_pricing_overhead_get($1,$2)', [actor, revisionId])).rows[0] ?? null; }
  async createOffer(actor: string, input: { offerId?: string; pricingRevisionId: string; offerReference: string; commercialTerms?: string; paymentTerms?: string; deliveryTerms?: string; correlationId?: string }) {
    const row = (await this.pool.query<{ offer_id: string; revision_id: string }>('SELECT * FROM public.internal_offer_create($1,$2,$3,$4,$5,$6,$7,$8)', [actor, input.offerId ?? null, input.pricingRevisionId, input.offerReference, input.commercialTerms ?? null, input.paymentTerms ?? null, input.deliveryTerms ?? null, input.correlationId ?? null])).rows[0];
    return { offerId: row.offer_id, revisionId: row.revision_id };
  }
  async submitOffer(actor: string, revisionId: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_offer_submit($1,$2,$3)', [actor, revisionId, correlationId ?? null]);
  }
  async decideOffer(actor: string, revisionId: string, decision: 'APPROVED' | 'REJECTED', reason?: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_offer_decide($1,$2,$3,$4,$5)', [actor, revisionId, decision, reason ?? null, correlationId ?? null]);
  }
  async issueOffer(actor: string, revisionId: string, validUntil: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_offer_issue($1,$2,$3,$4)', [actor, revisionId, validUntil, correlationId ?? null]);
  }
  async withdrawOffer(actor: string, revisionId: string, reason: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_offer_withdraw($1,$2,$3,$4)', [actor, revisionId, reason, correlationId ?? null]);
  }
  async getOfferBinding(actor: string, revisionId: string) {
    return (await this.pool.query<{ pricing_revision_id: string }>('SELECT * FROM public.internal_offer_binding_get($1,$2)', [actor, revisionId])).rows[0] ?? null;
  }
}
