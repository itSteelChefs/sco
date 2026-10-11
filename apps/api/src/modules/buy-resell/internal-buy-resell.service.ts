import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CommercialInternalTransactionService } from './commercial-internal-transaction.service.js';
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
  constructor(@Inject(CommercialInternalTransactionService) private readonly internal: CommercialInternalTransactionService) {}

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
        const result = await client.query<{ payload: Record<string, unknown> }>(
          `SELECT public.internal_commercial_purchase_get($1,$2) AS payload`, [actorUserId, intentId],
        );
        return result.rows[0].payload;
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
        const result = await client.query<{ payload: Record<string, unknown> }>(
          `SELECT public.internal_commercial_supplier_order_get($1,$2) AS payload`, [actorUserId, orderId],
        );
        return result.rows[0].payload;
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
        const result = await client.query<{ payload: Record<string, unknown> }>(
          `SELECT public.internal_commercial_allocation_get($1,$2) AS payload`, [actorUserId, allocationId],
        );
        return result.rows[0].payload;
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
        const result = await client.query<{ payload: Record<string, unknown> }>(
          `SELECT public.internal_commercial_resale_get($1,$2) AS payload`, [actorUserId, orderId],
        );
        return result.rows[0].payload;
      });
    });
  }
}
