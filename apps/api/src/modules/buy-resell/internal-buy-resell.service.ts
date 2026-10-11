import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ScoInternalTransactionService } from '../../database/sco-internal-transaction.service.js';
import { withCommercialErrors } from './buy-resell.errors.js';
import type {
  ConfirmSupplierOrderDto,
  CreateAllocationDto,
  CreatePurchaseFromSelectionDto,
  CreateResaleOrderDto,
  CreateSupplierOrderDto,
} from './internal-buy-resell.dto.js';

@Injectable()
export class InternalBuyResellService {
  constructor(@Inject(ScoInternalTransactionService) private readonly internal: ScoInternalTransactionService) {}

  createPurchaseFromSelection(actorUserId: string, body: CreatePurchaseFromSelectionDto) {
    return withCommercialErrors(async () => {
      const intentId = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_commercial_purchase_from_selection($1,$2,$3,$4) AS id`,
          [actorUserId, body.selectionCandidateId, body.idempotencyKey, randomUUID()],
        );
        return result.rows[0].id;
      });
      return this.getIntent(actorUserId, intentId);
    });
  }

  approvePurchase(actorUserId: string, intentId: string) {
    return withCommercialErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_commercial_purchase_approve($1,$2,$3)`, [actorUserId, intentId, randomUUID()]),
      );
      return this.getIntent(actorUserId, intentId);
    });
  }

  getIntent(actorUserId: string, intentId: string) {
    return withCommercialErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        const intent = await client.query(`SELECT * FROM public.commercial_purchase_intents WHERE id=$1`, [intentId]);
        const row = intent.rows[0];
        if (!row) throw new Error('COMMERCIAL_INTENT_NOT_FOUND');
        const lines = await client.query(
          `SELECT * FROM public.commercial_purchase_intent_lines WHERE intent_id=$1 ORDER BY description`,
          [intentId],
        );
        return {
          id: row.id,
          selectionCandidateId: row.selection_candidate_id,
          requirementId: row.requirement_id,
          partnerCompanyId: row.partner_company_id,
          quoteId: row.quote_id,
          supplierCompanyId: row.supplier_company_id,
          aliasLabel: row.alias_label,
          currencyCode: row.currency_code,
          status: row.status,
          purchaseSubtotal: row.purchase_subtotal,
          purchaseTotal: row.purchase_total,
          paymentTerms: row.payment_terms,
          lines: lines.rows.map((line) => ({
            id: line.id,
            quoteLineId: line.quote_line_id,
            requirementLineId: line.requirement_line_id,
            description: line.description,
            quantity: line.quantity,
            purchaseUnitPrice: line.purchase_unit_price,
            lineAmount: line.line_amount,
            valueState: line.value_state,
          })),
        };
      });
    });
  }

  createSupplierOrder(actorUserId: string, body: CreateSupplierOrderDto) {
    return withCommercialErrors(async () => {
      const orderId = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_commercial_supplier_order_create($1,$2::uuid[],$3,$4,$5,$6) AS id`,
          [
            actorUserId,
            body.intentIds,
            body.idempotencyKey,
            body.deliveryContext ?? null,
            body.commercialTerms ?? null,
            randomUUID(),
          ],
        );
        return result.rows[0].id;
      });
      return this.getSupplierOrder(actorUserId, orderId);
    });
  }

  approveSupplierOrder(actorUserId: string, orderId: string) {
    return withCommercialErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_commercial_supplier_order_approve($1,$2,$3)`, [
          actorUserId,
          orderId,
          randomUUID(),
        ]),
      );
      return this.getSupplierOrder(actorUserId, orderId);
    });
  }

  issueSupplierOrder(actorUserId: string, orderId: string) {
    return withCommercialErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_commercial_supplier_order_issue($1,$2,$3)`, [
          actorUserId,
          orderId,
          randomUUID(),
        ]),
      );
      return this.getSupplierOrder(actorUserId, orderId);
    });
  }

  confirmSupplierOrder(actorUserId: string, orderId: string, body: ConfirmSupplierOrderDto) {
    return withCommercialErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_commercial_supplier_order_confirm($1,$2,$3,$4,$5,$6::jsonb,$7)`, [
          actorUserId,
          orderId,
          body.confirmationReference ?? null,
          body.expectedDeliveryDate ?? null,
          body.notes ?? null,
          body.lineConfirmations ? JSON.stringify(body.lineConfirmations) : null,
          randomUUID(),
        ]),
      );
      return this.getSupplierOrder(actorUserId, orderId);
    });
  }

  getSupplierOrder(actorUserId: string, orderId: string) {
    return withCommercialErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        const order = await client.query(`SELECT * FROM public.commercial_supplier_orders WHERE id=$1`, [orderId]);
        const row = order.rows[0];
        if (!row) throw new Error('COMMERCIAL_ORDER_NOT_FOUND');
        const lines = await client.query(
          `SELECT * FROM public.commercial_supplier_order_lines WHERE order_id=$1 ORDER BY description`,
          [orderId],
        );
        return {
          id: row.id,
          orderReference: row.order_reference,
          scoBuyerCompanyId: row.sco_buyer_company_id,
          supplierCompanyId: row.supplier_company_id,
          status: row.status,
          currencyCode: row.currency_code,
          purchaseSubtotal: row.purchase_subtotal,
          purchaseTotal: row.purchase_total,
          paymentTerms: row.payment_terms,
          issuedAt: row.issued_at ? new Date(row.issued_at).toISOString() : null,
          confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
          confirmationReference: row.confirmation_reference,
          expectedDeliveryDate: row.expected_delivery_date,
          lines: lines.rows.map((line) => ({
            id: line.id,
            partnerCompanyId: line.partner_company_id,
            requirementLineId: line.requirement_line_id,
            description: line.description,
            orderedQuantity: line.ordered_quantity,
            confirmedQuantity: line.confirmed_quantity,
            allocatedQuantity: line.allocated_quantity,
            purchaseUnitPrice: line.purchase_unit_price,
            lineAmount: line.line_amount,
            availableToAllocate:
              Number(line.confirmed_quantity ?? line.ordered_quantity) - Number(line.allocated_quantity),
          })),
        };
      });
    });
  }

  createAllocation(actorUserId: string, body: CreateAllocationDto) {
    return withCommercialErrors(async () => {
      const allocationId = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_commercial_allocation_create($1,$2,$3,$4,$5) AS id`,
          [actorUserId, body.orderLineId, body.quantity, body.idempotencyKey, randomUUID()],
        );
        return result.rows[0].id;
      });
      return this.getAllocation(actorUserId, allocationId);
    });
  }

  getAllocation(actorUserId: string, allocationId: string) {
    return withCommercialErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query(`SELECT * FROM public.commercial_partner_allocations WHERE id=$1`, [
          allocationId,
        ]);
        const row = result.rows[0];
        if (!row) throw new Error('COMMERCIAL_ALLOCATION_NOT_FOUND');
        return {
          id: row.id,
          supplierOrderLineId: row.supplier_order_line_id,
          supplierOrderId: row.supplier_order_id,
          partnerCompanyId: row.partner_company_id,
          requirementId: row.requirement_id,
          requirementLineId: row.requirement_line_id,
          allocatedQuantity: row.allocated_quantity,
          purchaseUnitPrice: row.purchase_unit_price,
          purchaseLineAmount: row.purchase_line_amount,
          status: row.status,
          resaleOrderLineId: row.resale_order_line_id,
        };
      });
    });
  }

  createResale(actorUserId: string, body: CreateResaleOrderDto) {
    return withCommercialErrors(async () => {
      const orderId = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_commercial_resale_create($1,$2,$3::jsonb,$4,$5,$6,$7,$8) AS id`,
          [
            actorUserId,
            body.partnerCompanyId,
            JSON.stringify(body.allocations),
            body.paymentTerms ?? 'CASH',
            body.deliveryTerms ?? null,
            body.commercialNotes ?? null,
            body.idempotencyKey,
            randomUUID(),
          ],
        );
        return result.rows[0].id;
      });
      return this.getResaleInternal(actorUserId, orderId);
    });
  }

  approveResale(actorUserId: string, orderId: string) {
    return withCommercialErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_commercial_resale_approve($1,$2,$3)`, [
          actorUserId,
          orderId,
          randomUUID(),
        ]),
      );
      return this.getResaleInternal(actorUserId, orderId);
    });
  }

  confirmResale(actorUserId: string, orderId: string) {
    return withCommercialErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_commercial_resale_confirm($1,$2,$3)`, [
          actorUserId,
          orderId,
          randomUUID(),
        ]),
      );
      return this.getResaleInternal(actorUserId, orderId);
    });
  }

  getResaleInternal(actorUserId: string, orderId: string) {
    return withCommercialErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        const order = await client.query(`SELECT * FROM public.commercial_partner_resale_orders WHERE id=$1`, [orderId]);
        const row = order.rows[0];
        if (!row) throw new Error('COMMERCIAL_RESALE_NOT_FOUND');
        const lines = await client.query(
          `SELECT * FROM public.commercial_partner_resale_order_lines WHERE resale_order_id=$1`,
          [orderId],
        );
        return {
          id: row.id,
          orderReference: row.order_reference,
          partnerCompanyId: row.partner_company_id,
          scoSellerCompanyId: row.sco_seller_company_id,
          status: row.status,
          currencyCode: row.currency_code,
          paymentTerms: row.payment_terms,
          saleSubtotal: row.sale_subtotal,
          saleTotal: row.sale_total,
          purchaseCostTotal: row.purchase_cost_total,
          grossMargin: row.gross_margin,
          supplierAliasLabel: row.supplier_alias_label,
          fulfillmentReady: row.fulfillment_ready,
          confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
          lines: lines.rows.map((line) => ({
            id: line.id,
            allocationId: line.allocation_id,
            description: line.description,
            quantity: line.quantity,
            saleUnitPrice: line.sale_unit_price,
            saleLineAmount: line.sale_line_amount,
            purchaseUnitPrice: line.purchase_unit_price,
            purchaseLineAmount: line.purchase_line_amount,
            lineGrossMargin: line.line_gross_margin,
          })),
        };
      });
    });
  }
}
