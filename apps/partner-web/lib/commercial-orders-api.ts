import { api } from './api';
import type {
  PartnerCommercialOrderDetail,
  PartnerCommercialOrderSummary,
} from '../components/commercial/commercial-order-types';
import { stripForbiddenCommercialFields } from '../components/commercial/commercial-confidentiality.mjs';

type ApiClient = typeof api & {
  partnerCommercialOrders?: (
    companyId: string,
    signal?: AbortSignal,
  ) => Promise<{ items: PartnerCommercialOrderSummary[] } | PartnerCommercialOrderSummary[]>;
  partnerCommercialOrder?: (
    companyId: string,
    orderId: string,
    signal?: AbortSignal,
  ) => Promise<PartnerCommercialOrderDetail>;
  acknowledgePartnerCommercialOrder?: (
    companyId: string,
    orderId: string,
    body?: { idempotencyKey?: string },
    signal?: AbortSignal,
  ) => Promise<{ ok: true } | PartnerCommercialOrderDetail>;
};

/**
 * Contract gate — true only when Cursor3 has committed partner commercial list/detail
 * methods on the shared contracts client. Do not invent endpoints here.
 */
export function isPartnerCommercialOrdersContractReady(): boolean {
  const client = api as ApiClient;
  return typeof client.partnerCommercialOrders === 'function' && typeof client.partnerCommercialOrder === 'function';
}

export function isPartnerCommercialAcknowledgeReady(): boolean {
  const client = api as ApiClient;
  return typeof client.acknowledgePartnerCommercialOrder === 'function';
}

export class CommercialOrdersWaitingError extends Error {
  readonly code = 'WAITING_BACKEND';
  constructor(message = 'WAITING_BACKEND') {
    super(message);
    this.name = 'CommercialOrdersWaitingError';
  }
}

function asList(payload: { items: PartnerCommercialOrderSummary[] } | PartnerCommercialOrderSummary[]): PartnerCommercialOrderSummary[] {
  if (Array.isArray(payload)) return payload;
  return payload.items ?? [];
}

export const commercialOrdersApi = {
  isReady: isPartnerCommercialOrdersContractReady,
  canAcknowledge: isPartnerCommercialAcknowledgeReady,

  async list(companyId: string, signal?: AbortSignal): Promise<PartnerCommercialOrderSummary[]> {
    if (!isPartnerCommercialOrdersContractReady()) throw new CommercialOrdersWaitingError();
    const client = api as ApiClient;
    const raw = await client.partnerCommercialOrders!(companyId, signal);
    const items = asList(raw).map((item) => stripForbiddenCommercialFields(item) as PartnerCommercialOrderSummary);
    return items;
  },

  async get(companyId: string, orderId: string, signal?: AbortSignal): Promise<PartnerCommercialOrderDetail> {
    if (!isPartnerCommercialOrdersContractReady()) throw new CommercialOrdersWaitingError();
    const client = api as ApiClient;
    const raw = await client.partnerCommercialOrder!(companyId, orderId, signal);
    return stripForbiddenCommercialFields(raw) as PartnerCommercialOrderDetail;
  },

  async acknowledge(companyId: string, orderId: string, signal?: AbortSignal): Promise<unknown> {
    if (!isPartnerCommercialAcknowledgeReady()) throw new CommercialOrdersWaitingError('ACKNOWLEDGE_WAITING_BACKEND');
    const client = api as ApiClient;
    const key =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `ack-${Date.now()}`;
    return client.acknowledgePartnerCommercialOrder!(companyId, orderId, { idempotencyKey: key }, signal);
  },
};
