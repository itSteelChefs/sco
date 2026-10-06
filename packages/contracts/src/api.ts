export type ErrorEnvelope = { error: { code: string; message?: string; correlationId?: string; details?: unknown } };
export type Page<T> = { items: T[]; page: number; pageSize: number; total?: number };

export type ActiveCompany = { id: string; name: string; type: string };
export type CompanyProjection = { id: string; name: string; type: string; tenantId: string };
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

type RequestOptions = { method?: string; companyId?: string; body?: unknown };
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
		context: () => request<{ companies: ActiveCompany[] }>('/api/v1/auth/context'),
		company: (companyId: string) => request<CompanyProjection>('/api/v1/companies/current/me', { companyId }),
		partner: (companyId: string) => request<{ companyId: string; membershipId: string }>('/api/v1/partner/me', { companyId }),
		partnerWorkspace: (companyId: string) => request<PartnerWorkspace | null>('/api/v1/partner/workspace/current', { companyId }),
		createPartnerWorkspace: (companyId: string) => request<PartnerWorkspace>('/api/v1/partner/workspace/current', { method: 'POST', companyId, body: {} }),
		companies: (companyId: string, page = 1, pageSize = 25) => request<Page<{ id: string; name: string; type: string; status: string }>>(`/api/v1/internal/companies?page=${page}&pageSize=${pageSize}`, { companyId }),
	};
}
