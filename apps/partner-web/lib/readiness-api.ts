import { ApiClientError, type ErrorEnvelope } from '@sco/contracts';
import { api } from './api';

/**
 * Partner-facing readiness helpers.
 * Uses existing journey/agreements client methods; admission status is fetched
 * against the live GET /api/v1/partner/admission/status without inventing new backend.
 * Does not modify packages/contracts (protected shared).
 */

export type AdmissionStatus = {
  partnershipType: string | null;
  partnershipStatus: string | null;
  qualificationStatus: string | null;
  agreementReady: boolean;
};

async function getJson<T>(path: string, companyId: string, signal?: AbortSignal): Promise<T> {
  const correlationId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined;
  const response = await fetch(path, {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-sco-company-id': companyId,
      ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
    },
    signal,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as Partial<ErrorEnvelope>;
    throw new ApiClientError(
      response.status,
      payload.error?.code ?? 'REQUEST_FAILED',
      response.headers.get('x-correlation-id') ?? undefined,
    );
  }
  return response.json() as Promise<T>;
}

export const readinessApi = {
  context: api.context.bind(api),
  partnerJourney: api.partnerJourney.bind(api),
  partnerAgreements: api.partnerAgreements.bind(api),
  acceptPartnerAgreement: api.acceptPartnerAgreement.bind(api),
  admissionStatus: (companyId: string, signal?: AbortSignal) =>
    getJson<AdmissionStatus>('/api/v1/partner/admission/status', companyId, signal),
};
