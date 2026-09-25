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
  async verifyPartnerPurchaseOrder(actor: string, purchaseOrderId: string, reason?: string, correlationId?: string) {
    return (await this.pool.query<{ verification_id: string; outcome: string }>('SELECT * FROM public.internal_partner_po_verify($1,$2,$3,$4)', [actor, purchaseOrderId, reason ?? null, correlationId ?? null])).rows[0];
  }
  async createCommercialCommitment(actor: string, purchaseOrderId: string, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_commercial_commitment_create($1,$2,$3) AS id', [actor, purchaseOrderId, correlationId ?? null])).rows[0].id;
  }
  async createPaymentRequirement(actor: string, commitmentId: string, input: { type: string; amount: number; currency: string; dueDate?: string; correlationId?: string }) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_payment_requirement_create($1,$2,$3,$4,$5,$6,$7) AS id', [actor, commitmentId, input.type, input.amount, input.currency, input.dueDate ?? null, input.correlationId ?? null])).rows[0].id;
  }
  async verifyPayment(actor: string, receiptId: string, method: 'DOCUMENT_EVIDENCE' | 'INTERNAL_CONFIRMATION', reason: string, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_payment_verify($1,$2,$3,$4,$5) AS id', [actor, receiptId, method, reason, correlationId ?? null])).rows[0].id;
  }
  async createSupplierFundingRequirement(actor: string, commitmentId: string, input: { stage: string; amount: number; currency: string; requiredBy?: string; correlationId?: string }) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_funding_create($1,$2,$3,$4,$5,$6,$7) AS id', [actor, commitmentId, input.stage, input.amount, input.currency, input.requiredBy ?? null, input.correlationId ?? null])).rows[0].id;
  }
  async authorizeInternalFunding(actor: string, requirementId: string, input: { amount: number; currency: string; reason: string; correlationId?: string }) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_funding_authorize($1,$2,$3,$4,$5,$6) AS id', [actor, requirementId, input.amount, input.currency, input.reason, input.correlationId ?? null])).rows[0].id;
  }
  async evaluateFunding(actor: string, requirementId: string, correlationId?: string) {
    return (await this.pool.query<{ evaluation_id: string; status: string; funding_gap: string | null }>('SELECT * FROM public.internal_cash_funding_evaluate($1,$2,$3)', [actor, requirementId, correlationId ?? null])).rows[0];
  }
  async getSupplierFunding(actor: string, requirementId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_funding_get($1,$2)', [actor, requirementId])).rows[0] ?? null;
  }
  async getCashExposure(actor: string, requirementId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_cash_exposure_get($1,$2)', [actor, requirementId])).rows;
  }
  async createSupplierReconfirmation(actor: string, input: { purchaseSourceId: string; supplierCompanyId: string; productIdentityId: string; price: number; currency: string; quantity: number; validUntil?: string; note?: string; correlationId?: string }) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_reconfirmation_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS id', [actor, input.purchaseSourceId, input.supplierCompanyId, input.productIdentityId, input.price, input.currency, input.quantity, input.validUntil ?? null, input.note ?? null, input.correlationId ?? null])).rows[0].id;
  }
  async executeProcurementRelease(actor: string, commitmentId: string, lines: Array<{ commercialCommitmentLineId: string; productIdentityId: string; quantity: number; unitId: string; approvedPurchaseCostSnapshotId: string; supplierReconfirmationId?: string }>, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_procurement_release_execute($1,$2,$3::jsonb,$4) AS id', [actor, commitmentId, JSON.stringify(lines), correlationId ?? null])).rows[0].id;
  }
  async withdrawProcurementRelease(actor: string, releaseId: string, reason: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_procurement_release_withdraw($1,$2,$3,$4)', [actor, releaseId, reason, correlationId ?? null]);
  }
  async createSupplierPurchaseOrderDraft(actor: string, purchaseSourceId: string, currency: string, lines: Array<Record<string, unknown>>, leadProcurementEngineerId?: string, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_po_draft_create($1,$2,$3,$4::jsonb,$5,$6) AS id', [actor, purchaseSourceId, currency, JSON.stringify(lines), leadProcurementEngineerId ?? null, correlationId ?? null])).rows[0].id;
  }
  async issueSupplierPurchaseOrder(actor: string, purchaseOrderId: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_po_issue($1,$2,$3)', [actor, purchaseOrderId, correlationId ?? null]);
  }
  async setPurchaseSourcePreference(actor: string, purchaseSourceId: string, preferred: boolean, reason: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_purchase_source_preference_set($1,$2,$3,$4,$5)', [actor, purchaseSourceId, preferred, reason, correlationId ?? null]);
  }
  async authorizeStrategicOverbuy(actor: string, input: { purchaseSourceId: string; productIdentityId: string; unitId: string; quantity: number; currency: string; maxUnitPurchaseCost: number; reason: string; correlationId?: string }) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_strategic_overbuy_authorize($1,$2,$3,$4,$5,$6,$7,$8,$9) AS id', [actor, input.purchaseSourceId, input.productIdentityId, input.unitId, input.quantity, input.currency, input.maxUnitPurchaseCost, input.reason, input.correlationId ?? null])).rows[0].id;
  }
  async getScopedSupplierPurchaseOrder(actor: string, purchaseOrderId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_po_scoped_get($1,$2)', [actor, purchaseOrderId])).rows;
  }
  async listScopedSupplierPurchaseOrders(actor: string, limit = 50, offset = 0) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_po_scoped_list($1,$2,$3)', [actor, limit, offset])).rows;
  }
  async setSupplierPurchaseOrderLineResponsibility(actor: string, lineId: string, engineerId: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_po_line_responsibility_set($1,$2,$3,$4)', [actor, lineId, engineerId, correlationId ?? null]);
  }
  async setSupplierPurchaseOrderLead(actor: string, purchaseOrderId: string, engineerId: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_po_lead_set($1,$2,$3,$4)', [actor, purchaseOrderId, engineerId, correlationId ?? null]);
  }
  async recordSupplierPOConfirmation(actor: string, lineId: string, quantity: number, promisedDate: string, supplierReference?: string, note?: string, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_po_confirmation_record($1,$2,$3,$4,$5,$6,$7) AS id', [actor, lineId, quantity, promisedDate, supplierReference ?? null, note ?? null, correlationId ?? null])).rows[0].id;
  }
  async getSupplierPOConfirmationLine(actor: string, lineId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_po_confirmation_line_get($1,$2)', [actor, lineId])).rows[0] ?? null;
  }
  async changeSupplierPOConfirmationDate(actor: string, lineId: string, previousDate: string, newDate: string, reason: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_po_confirmation_date_change($1,$2,$3,$4,$5,$6)', [actor, lineId, previousDate, newDate, reason, correlationId ?? null]);
  }
  async correctSupplierPOConfirmationReference(actor: string, lineId: string, previousReference: string, correctedReference: string, reason: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_po_confirmation_reference_correct($1,$2,$3,$4,$5,$6)', [actor, lineId, previousReference, correctedReference, reason, correlationId ?? null]);
  }
  async getSupplierPOConfirmation(actor: string, purchaseOrderId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_po_confirmation_po_get($1,$2)', [actor, purchaseOrderId])).rows;
  }
  async registerSupplierPOCommercialDocument(actor: string, purchaseOrderId: string, documentId: string, versionId: string, documentType: string, classification: string, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_po_commercial_document_register($1,$2,$3,$4,$5,$6,$7) AS id', [actor, purchaseOrderId, documentId, versionId, documentType, classification, correlationId ?? null])).rows[0].id;
  }
  async setSupplierPOCommercialDocumentCoverage(actor: string, documentId: string, lineId: string, quantity: number | null, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_po_commercial_document_coverage_set($1,$2,$3,$4,$5)', [actor, documentId, lineId, quantity, correlationId ?? null]);
  }
  async getSupplierPOCommercialDocument(actor: string, documentId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_po_commercial_document_get($1,$2)', [actor, documentId])).rows[0] ?? null;
  }
  async verifySupplierPOCommercialDocument(actor: string, documentId: string, facts: Record<string, unknown>, correlationId?: string) {
    return (await this.pool.query<{ id: string; result: string; mismatch_reasons: string[] }>('SELECT * FROM public.internal_supplier_po_commercial_document_verify($1,$2,$3::jsonb,$4)', [actor, documentId, JSON.stringify(facts), correlationId ?? null])).rows[0];
  }
  async createSupplierPaymentScheduleDraft(actor: string, purchaseOrderId: string, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_payment_schedule_draft_create($1,$2,$3) AS id', [actor, purchaseOrderId, correlationId ?? null])).rows[0].id;
  }
  async addSupplierPaymentScheduleItem(actor: string, revisionId: string, input: { lineNumber: number; triggerType: string; amount: number | string; percentage?: number | string; fixedDate?: string; milestoneDescription?: string; metadata?: Record<string, unknown> }, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_payment_schedule_item_add($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) AS id', [actor, revisionId, input.lineNumber, input.triggerType, input.amount, input.percentage ?? null, input.fixedDate ?? null, input.milestoneDescription ?? null, JSON.stringify(input.metadata ?? {}), correlationId ?? null])).rows[0].id;
  }
  async updateSupplierPaymentScheduleItem(actor: string, itemId: string, input: { triggerType: string; amount: number | string; percentage?: number | string; fixedDate?: string; milestoneDescription?: string; metadata?: Record<string, unknown> }, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_payment_schedule_item_update($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)', [actor, itemId, input.triggerType, input.amount, input.percentage ?? null, input.fixedDate ?? null, input.milestoneDescription ?? null, JSON.stringify(input.metadata ?? {}), correlationId ?? null]);
  }
  async removeSupplierPaymentScheduleItem(actor: string, itemId: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_payment_schedule_item_remove($1,$2,$3)', [actor, itemId, correlationId ?? null]);
  }
  async getSupplierPaymentSchedule(actor: string, revisionId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_payment_schedule_get($1,$2)', [actor, revisionId])).rows[0] ?? null;
  }
}
