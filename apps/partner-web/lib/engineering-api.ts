import { api } from './api';
import type {
  PartnerEngineeringDraftInput,
  PartnerEngineeringRequestDetail,
  PartnerEngineeringRequestSummary,
} from '../components/engineering/engineering-types';
import { stripForbiddenEngineeringFields } from '../components/engineering/engineering-guards.mjs';

type ApiClient = typeof api & {
  partnerEngineeringRequests?: (
    companyId: string,
    signal?: AbortSignal,
  ) => Promise<{ items: PartnerEngineeringRequestSummary[] } | PartnerEngineeringRequestSummary[]>;
  partnerEngineeringRequest?: (
    companyId: string,
    requestId: string,
    signal?: AbortSignal,
  ) => Promise<PartnerEngineeringRequestDetail>;
  partnerEngineeringCreateDraft?: (
    companyId: string,
    body: PartnerEngineeringDraftInput,
    signal?: AbortSignal,
  ) => Promise<PartnerEngineeringRequestDetail | PartnerEngineeringRequestSummary>;
  partnerEngineeringSubmit?: (
    companyId: string,
    requestId: string,
    signal?: AbortSignal,
  ) => Promise<PartnerEngineeringRequestDetail | PartnerEngineeringRequestSummary>;
  partnerEngineeringRespond?: (
    companyId: string,
    requestId: string,
    body: { message?: string; documentIds?: string[] },
    signal?: AbortSignal,
  ) => Promise<PartnerEngineeringRequestDetail>;
  partnerEngineeringLinkDocuments?: (
    companyId: string,
    requestId: string,
    body: { documentIds: string[] },
    signal?: AbortSignal,
  ) => Promise<PartnerEngineeringRequestDetail>;
  partnerEngineeringCreateProcurement?: (
    companyId: string,
    requestId: string,
    body?: { resultVersionId?: string; idempotencyKey?: string },
    signal?: AbortSignal,
  ) => Promise<{
    procurementRequirementId: string;
    procurementRequirementReference?: string;
  }>;
};

export function isPartnerEngineeringContractReady(): boolean {
  const client = api as ApiClient;
  return (
    typeof client.partnerEngineeringRequests === 'function' &&
    typeof client.partnerEngineeringRequest === 'function' &&
    typeof client.partnerEngineeringCreateDraft === 'function' &&
    typeof client.partnerEngineeringSubmit === 'function'
  );
}

export function isPartnerEngineeringHandoffReady(): boolean {
  const client = api as ApiClient;
  return typeof client.partnerEngineeringCreateProcurement === 'function';
}

export class EngineeringWaitingError extends Error {
  readonly code = 'WAITING_BACKEND';
  constructor(message = 'WAITING_BACKEND') {
    super(message);
    this.name = 'EngineeringWaitingError';
  }
}

function asList(
  payload: { items: PartnerEngineeringRequestSummary[] } | PartnerEngineeringRequestSummary[],
): PartnerEngineeringRequestSummary[] {
  if (Array.isArray(payload)) return payload;
  return payload.items ?? [];
}

export const engineeringApi = {
  isReady: isPartnerEngineeringContractReady,
  canHandoffApi: isPartnerEngineeringHandoffReady,

  async list(companyId: string, signal?: AbortSignal): Promise<PartnerEngineeringRequestSummary[]> {
    if (!isPartnerEngineeringContractReady()) throw new EngineeringWaitingError();
    const client = api as ApiClient;
    const raw = await client.partnerEngineeringRequests!(companyId, signal);
    return asList(raw).map((item) => stripForbiddenEngineeringFields(item) as PartnerEngineeringRequestSummary);
  },

  async get(companyId: string, requestId: string, signal?: AbortSignal): Promise<PartnerEngineeringRequestDetail> {
    if (!isPartnerEngineeringContractReady()) throw new EngineeringWaitingError();
    const client = api as ApiClient;
    const raw = await client.partnerEngineeringRequest!(companyId, requestId, signal);
    return stripForbiddenEngineeringFields(raw) as PartnerEngineeringRequestDetail;
  },

  async createDraft(companyId: string, body: PartnerEngineeringDraftInput, signal?: AbortSignal) {
    if (!isPartnerEngineeringContractReady()) throw new EngineeringWaitingError();
    const client = api as ApiClient;
    const raw = await client.partnerEngineeringCreateDraft!(companyId, body, signal);
    return stripForbiddenEngineeringFields(raw);
  },

  async submit(companyId: string, requestId: string, signal?: AbortSignal) {
    if (!isPartnerEngineeringContractReady()) throw new EngineeringWaitingError();
    const client = api as ApiClient;
    return stripForbiddenEngineeringFields(await client.partnerEngineeringSubmit!(companyId, requestId, signal));
  },

  async respond(
    companyId: string,
    requestId: string,
    body: { message?: string; documentIds?: string[] },
    signal?: AbortSignal,
  ) {
    const client = api as ApiClient;
    if (typeof client.partnerEngineeringRespond !== 'function') throw new EngineeringWaitingError();
    return stripForbiddenEngineeringFields(await client.partnerEngineeringRespond(companyId, requestId, body, signal));
  },

  async linkDocuments(companyId: string, requestId: string, documentIds: string[], signal?: AbortSignal) {
    const client = api as ApiClient;
    if (typeof client.partnerEngineeringLinkDocuments !== 'function') throw new EngineeringWaitingError();
    return stripForbiddenEngineeringFields(
      await client.partnerEngineeringLinkDocuments(companyId, requestId, { documentIds }, signal),
    );
  },

  async createProcurement(
    companyId: string,
    requestId: string,
    opts?: { resultVersionId?: string; idempotencyKey?: string },
    signal?: AbortSignal,
  ) {
    if (!isPartnerEngineeringHandoffReady()) throw new EngineeringWaitingError('HANDOFF_WAITING_BACKEND');
    const client = api as ApiClient;
    const key =
      opts?.idempotencyKey ??
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `f2d-${Date.now()}`);
    return client.partnerEngineeringCreateProcurement!(companyId, requestId, {
      resultVersionId: opts?.resultVersionId,
      idempotencyKey: key,
    }, signal);
  },
};
