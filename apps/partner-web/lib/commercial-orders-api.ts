import { api } from './api';
import type {
  PartnerCommercialOrderDetailDto,
  PartnerCommercialOrderSummaryDto,
} from '@sco/contracts';
import type {
  PartnerCommercialOrderDetail,
  PartnerCommercialOrderLine,
  PartnerCommercialOrderSummary,
} from '../components/commercial/commercial-order-types';
import { stripForbiddenCommercialFields } from '../components/commercial/commercial-confidentiality.mjs';

type ApiClient = typeof api;

/**
 * Contract gate — true only when shared contracts expose partner commercial list/detail.
 */
export function isPartnerCommercialOrdersContractReady(): boolean {
  const client = api as ApiClient & {
    partnerCommercialOrders?: unknown;
    partnerCommercialOrder?: unknown;
  };
  return typeof client.partnerCommercialOrders === 'function' && typeof client.partnerCommercialOrder === 'function';
}

export function isPartnerCommercialAcknowledgeReady(): boolean {
  const client = api as ApiClient & { acknowledgePartnerCommercialOrder?: unknown };
  return typeof client.acknowledgePartnerCommercialOrder === 'function';
}

export class CommercialOrdersWaitingError extends Error {
  readonly code = 'WAITING_BACKEND';
  constructor(message = 'WAITING_BACKEND') {
    super(message);
    this.name = 'CommercialOrdersWaitingError';
  }
}

function money(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function readinessLabel(fulfillmentReady: boolean): string | null {
  return fulfillmentReady ? 'جاهز للتجهيز' : null;
}

function mapSummary(raw: PartnerCommercialOrderSummaryDto, itemCount = 0): PartnerCommercialOrderSummary {
  const cleaned = stripForbiddenCommercialFields(raw) as PartnerCommercialOrderSummaryDto;
  return {
    orderId: cleaned.id,
    reference: cleaned.orderReference,
    createdAt: cleaned.createdAt,
    status: cleaned.status,
    currencyCode: cleaned.currencyCode,
    commercialTotal: money(cleaned.saleTotal),
    itemCount,
    readinessLabel: readinessLabel(Boolean(cleaned.fulfillmentReady)),
    nextActionLabel: null,
    procurementRequirementId: null,
    procurementRequirementReference: null,
  };
}

function mapLines(raw: PartnerCommercialOrderDetailDto): PartnerCommercialOrderLine[] {
  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  return lines.map((line, index) => ({
    lineNumber: index + 1,
    specification: String(line.specification ?? line.description ?? ''),
    quantity: money(line.quantity),
    unitSalePrice: money(line.saleUnitPrice),
    lineTotal: money(line.saleLineAmount),
    currencyCode: raw.currencyCode,
  }));
}

function mapDetail(raw: PartnerCommercialOrderDetailDto): PartnerCommercialOrderDetail {
  const cleaned = stripForbiddenCommercialFields(raw) as PartnerCommercialOrderDetailDto;
  const lines = mapLines(cleaned);
  const summary = mapSummary(cleaned, lines.length);
  return {
    ...summary,
    paymentTerms: cleaned.paymentTerms ?? null,
    deliveryReadiness: cleaned.deliveryTerms ?? null,
    supplierAliasLabel: cleaned.supplierAliasLabel ?? null,
    lines,
    acknowledgementRequired: false,
    acknowledgementActionAvailable: false,
  };
}

export const commercialOrdersApi = {
  isReady: isPartnerCommercialOrdersContractReady,
  canAcknowledge: isPartnerCommercialAcknowledgeReady,

  async list(companyId: string, signal?: AbortSignal): Promise<PartnerCommercialOrderSummary[]> {
    if (!isPartnerCommercialOrdersContractReady()) throw new CommercialOrdersWaitingError();
    const raw = await api.partnerCommercialOrders(companyId, signal);
    return (Array.isArray(raw) ? raw : []).map((item) => mapSummary(item, 0));
  },

  async get(companyId: string, orderId: string, signal?: AbortSignal): Promise<PartnerCommercialOrderDetail> {
    if (!isPartnerCommercialOrdersContractReady()) throw new CommercialOrdersWaitingError();
    const raw = await api.partnerCommercialOrder(companyId, orderId, signal);
    return mapDetail(raw);
  },

  async acknowledge(companyId: string, orderId: string, signal?: AbortSignal): Promise<unknown> {
    if (!isPartnerCommercialAcknowledgeReady()) throw new CommercialOrdersWaitingError('ACKNOWLEDGE_WAITING_BACKEND');
    const client = api as ApiClient & {
      acknowledgePartnerCommercialOrder: (
        companyId: string,
        orderId: string,
        body?: { idempotencyKey?: string },
        signal?: AbortSignal,
      ) => Promise<unknown>;
    };
    const key =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `ack-${Date.now()}`;
    return client.acknowledgePartnerCommercialOrder(companyId, orderId, { idempotencyKey: key }, signal);
  },
};
