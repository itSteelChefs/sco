export type ErrorEnvelope = { error: { code: string; message?: string; correlationId?: string; details?: unknown } };
export type Page<T> = { items: T[]; page: number; pageSize: number; total?: number };

export type ActiveCompany = { id: string; name: string; type: string };
export type CompanyProjection = { id: string; name: string; type: string; tenantId: string };
export type PartnerJourneyReason = 'PERMISSION_REQUIRED' | 'RELATIONSHIP_NOT_ACTIVE' | 'AGREEMENT_REQUIRED' | 'NOT_AVAILABLE';
export type PartnerJourney = {
	company: { id: string; name: string };
	actor: { userId: string; membershipId: string };
	operational: { procurementAccess: 'AVAILABLE' | 'RESTRICTED'; reason?: PartnerJourneyReason };
	relationship: {
		stage: 'REGISTRATION' | 'QUALIFICATION' | 'AGREEMENT' | 'APPROVAL' | 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'REJECTED';
		qualification: 'NONE' | 'APPLICATION' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
		partnership: 'NONE' | 'UNDER_REVIEW' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'REJECTED';
		agreementsSatisfied: boolean;
		pendingAgreements: Array<{ agreementType: string; version: string; status: string; actionable: boolean }>;
	} | null;
	nextAction: { code: 'ACCEPT_AGREEMENTS' | 'AWAIT_SCO_REVIEW' | 'CONTACT_SCO' | 'NONE'; owner: 'PARTNER' | 'SCO' | 'NONE'; permitted: boolean } | null;
	experiences: Array<{ code: 'PARTNER_SHELL' | 'ONBOARDING' | 'PROCUREMENT'; classification: 'B' | 'C' | 'D'; enterable: boolean; reason?: PartnerJourneyReason }>;
	capabilities: Array<{ code: 'AGREEMENT_ACCEPTANCE' | 'VERIFY_RESULT_READ' | 'PROCUREMENT_DOCUMENT_EXTRACTION'; classification: 'B' | 'D'; available: boolean; reason?: PartnerJourneyReason }>;
};
export type PartnerAgreement = {
	agreementType: string;
	version: string;
	content: string;
	effectiveAt: string;
	required: boolean;
	acceptanceStatus: string;
	acceptedVersion: string | null;
	actionable: boolean;
};
export type PartnerAgreementAcceptance = { agreementType: string; version: string; acceptedAt: string; status: string };
export type PartnerWorkspaceCapabilityState = { capability: string; available: boolean; reason?: 'OPERATIONAL_ACCESS_RESTRICTED' };
// capabilityStates is advisory display state only; it is never an authorization decision.
export type PartnerWorkspace = { id: string; displayName: string; state: string; version: number; capabilities: string[]; capabilityStates?: PartnerWorkspaceCapabilityState[] };
export type ApiErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_FAILED' | 'INTERNAL_ERROR' | string;

export class ApiClientError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: ApiErrorCode,
		public readonly correlationId?: string,
	) {
		super(code);
	}
}

type RequestOptions = { method?: string; companyId?: string; body?: unknown; signal?: AbortSignal };
type ApiClientOptions = { baseUrl?: string; fetchImpl?: typeof fetch };

export function createApiClient({ baseUrl = '', fetchImpl = fetch }: ApiClientOptions = {}) {
	async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
		const correlationId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined;
		const response = await fetchImpl(`${baseUrl}${path}`, {
			method: options.method ?? 'GET',
			credentials: 'include',
			headers: {
				accept: 'application/json',
				...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
				...(options.companyId ? { 'x-sco-company-id': options.companyId } : {}),
				...(correlationId ? { 'x-correlation-id': correlationId } : {}),
			},
			...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
			signal: options.signal,
		});
		if (!response.ok) {
			const payload = await response.json().catch(() => ({})) as Partial<ErrorEnvelope>;
			throw new ApiClientError(response.status, payload.error?.code ?? 'REQUEST_FAILED', response.headers.get('x-correlation-id') ?? undefined);
		}
		return response.json() as Promise<T>;
	}

	return {
		login: (email: string, password: string) => request<{ ok: true }>('/api/v1/auth/login', { method: 'POST', body: { email, password } }),
		logout: () => request<{ ok: true }>('/api/v1/auth/logout', { method: 'POST', body: {} }),
		context: (signal?: AbortSignal) => request<{ companies: ActiveCompany[] }>('/api/v1/auth/context', { signal }),
		company: (companyId: string) => request<CompanyProjection>('/api/v1/companies/current/me', { companyId }),
		partner: (companyId: string) => request<{ companyId: string; membershipId: string }>('/api/v1/partner/me', { companyId }),
		partnerJourney: (companyId: string, signal?: AbortSignal) => request<PartnerJourney>('/api/v1/partner/journey', { companyId, signal }),
		partnerAgreements: (companyId: string, signal?: AbortSignal) => request<PartnerAgreement[]>('/api/v1/partner/admission/agreements', { companyId, signal }),
		acceptPartnerAgreement: (companyId: string, body: { agreementType: string; versionCode: string; idempotencyKey: string }, signal?: AbortSignal) => request<PartnerAgreementAcceptance>('/api/v1/partner/admission/agreements/accept', { method: 'POST', companyId, body, signal }),
		partnerWorkspace: (companyId: string, signal?: AbortSignal) => request<PartnerWorkspace | null>('/api/v1/partner/workspace/current', { companyId, signal }),
		createPartnerWorkspace: (companyId: string, signal?: AbortSignal) => request<PartnerWorkspace>('/api/v1/partner/workspace/current', { method: 'POST', companyId, body: {}, signal }),
		companies: (companyId: string, page = 1, pageSize = 25) => request<Page<{ id: string; name: string; type: string; status: string }>>(`/api/v1/internal/companies?page=${page}&pageSize=${pageSize}`, { companyId }),
	};
}
