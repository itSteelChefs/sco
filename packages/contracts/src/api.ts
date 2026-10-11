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
		qualification: 'NONE' | 'DRAFT' | 'APPLICATION' | 'SUBMITTED' | 'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED' | 'REJECTED';
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

export type PartnerQualificationDraft = {
	companyName: string;
	commercialIdentifier?: string;
	responsiblePerson: string;
	contact: string;
	city: string;
	sector: 'HVAC_REFRIGERATION' | 'ELECTRICAL' | 'PLUMBING' | 'MULTI';
	needType: 'VERIFY_QUOTE_CHECK' | 'PROCUREMENT_SUPPORT' | 'BOTH';
	procurementSize: 'SMALL' | 'MEDIUM' | 'LARGE' | 'PROJECT_BASED';
	procurementFrequency: 'OCCASIONAL' | 'MONTHLY' | 'WEEKLY' | 'PROJECT_BASED';
};

export type PartnerQualification = {
	id: string;
	status: string;
	reviewState: string;
	actionRequired: boolean;
	actionRequiredReason: string | null;
	companyName: string;
	commercialIdentifier: string | null;
	responsiblePerson: string | null;
	contact: string;
	city: string | null;
	sector: string | null;
	needType: string | null;
	procurementSize: string | null;
	procurementFrequency: string | null;
	submittedAt: string | null;
	updatedAt: string;
};

/** Internal qualification queue row from GET /api/v1/internal/network/qualifications */
export type InternalQualificationListItem = {
	id: string;
	legalName: string;
	contactEmail: string;
	status: string;
	createdAt: string;
};

export type InternalQualificationDecisionStatus = 'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED' | 'REJECTED';

export type InternalPartnershipReadiness = {
	partnershipId: string;
	companyId: string;
	companyDisplayName: string;
	partnershipType: string;
	partnershipStatus: string;
	qualificationStatus: string | null;
	qualificationReady: boolean;
	requiredAgreementsSatisfied: boolean;
	companyStatus: string;
	companyActive: boolean;
	activePortalMembershipReady: boolean;
	partnerPortalReadReady: boolean;
	nextInternalAction: 'APPROVE' | 'ACTIVATE' | 'NONE';
	actionReady: boolean;
	blockers: string[];
	createdAt: string;
	updatedAt: string;
};

export type InternalDocumentListItem = {
	id: string;
	company_id: string;
	filename: string;
	detected_mime_type: string;
	byte_size: number;
	status: string;
	document_category: string | null;
	retention_class: string | null;
	linked_entity_type: string | null;
	linked_entity_id: string | null;
	created_at: string;
	updated_at: string;
};

export type InternalVerifyQueueItem = {
	request_id: string;
	company_id: string;
	revision_id: string | null;
	run_id: string | null;
	result_id: string | null;
	request_status: string;
	run_status: string | null;
	result_status: string | null;
	classification: string | null;
	updated_at: string;
};

export type InternalVerifyAnalysisInput = {
	offerValue?: unknown;
	verifiedReferenceScope?: unknown;
	gap?: unknown;
	confidence?: unknown;
	proposedAction: string;
	exclusions?: unknown;
	supersedesResultId?: string;
};

export type PartnerDocumentMetadata = {
	documentId: string;
	filename: string;
	contentType: string;
	byteSize: number;
	status: string;
	category: string | null;
	retentionClass: string | null;
	linkedEntityType: string | null;
	linkedEntityId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type PartnerDocumentCategory = 'QUALIFICATION_SUPPORT' | 'AGREEMENT_ARTIFACT' | 'VERIFY_QUOTE' | 'GENERAL';

export type PartnerDocumentUploadInput = {
	category: PartnerDocumentCategory;
	filename: string;
	contentType: string;
	contentBase64: string;
	linkedEntityType?: 'QUALIFICATION_APPLICATION' | 'VERIFY_REQUEST' | 'AGREEMENT_POLICY_VERSION';
	linkedEntityId?: string;
};

export type PartnerDocumentUploadResult = {
	documentId: string;
	versionId: string;
	filename: string;
	contentType: string;
	byteSize: number;
	category: string;
	retentionClass: string;
	linkedEntityType: string | null;
	linkedEntityId: string | null;
	createdAt: string;
};
export type PartnerDocumentPage = Page<PartnerDocumentMetadata>;
export type PartnerVerifyOperationalResult = {
	offerValue: unknown;
	verifiedReferenceScope: unknown;
	gap: unknown;
	confidence: unknown;
	proposedAction: string;
};

export type PartnerVerifyDraft = { requestId: string; status: 'DRAFT'; productMode: 'QUOTE_CHECK' };
export type PartnerVerifyQuoteLine = {
	lineNumber: number;
	lineReference?: string;
	itemDescription?: string;
	productIdentityId?: string;
	unitId: string;
	quantity: number;
	currencyCode: string;
	unitPrice: number;
	isPriceBearing?: boolean;
	isInformational?: boolean;
	isRealZeroValue?: boolean;
};
export type PartnerVerifyAttachQuoteInput = {
	documentId: string;
	documentVersionId: string;
	currencies: string[];
	lines: PartnerVerifyQuoteLine[];
	idempotencyKey: string;
	expectedPredecessorRevisionId?: string;
};
export type PartnerVerifyAttachResult = { requestId: string; revisionId: string; status: string };
export type PartnerVerifySubmitResult = { requestId: string; revisionId: string; status: 'SUBMITTED' };

/** Partner-visible Verify result — fields match backend PartnerVerifyResultDto (Wave2). */
export type PartnerVerifyCoverageEntry = {
	currency: string;
	totalLineCount: number;
	verifiedLineCount: number;
	excludedLineCount: number;
	insufficientLineCount: number;
	lineCoveragePercent: number;
	valueCoveragePercent: number;
};
export type PartnerVerifyResult = {
	requestId: string;
	revisionId: string;
	runId: string;
	resultId: string;
	status: string;
	classification: string;
	finalizedAt: string;
	coverage: PartnerVerifyCoverageEntry[];
	offerValue: unknown;
	verifiedReferenceScope: unknown;
	gap: unknown;
	confidence: unknown;
	proposedAction: string;
};

/* —— Capability E — Buy & Resell (aligned to Cursor3 /api/v1/internal/commercial) —— */

export type InternalCommercialQueueKey =
	| 'SELECTIONS_READY'
	| 'PURCHASES_NEEDING_APPROVAL'
	| 'POS_AWAITING_ISSUE'
	| 'SUPPLIER_CONFIRMATIONS_PENDING'
	| 'ALLOCATIONS_INCOMPLETE'
	| 'RESALE_ORDERS_PENDING'
	| 'FULFILLMENT_READY';

export type InternalCommercialQueueCounts = Record<InternalCommercialQueueKey, number>;

/** D selection candidate ready for E (when list endpoint is available). */
export type InternalSelectionCandidate = {
	id: string;
	requirementId: string;
	quoteId: string;
	supplierCompanyId: string;
	supplierName?: string | null;
	aliasLabel?: string | null;
	companyId: string;
	partnerDisplayName?: string | null;
	requirementTitle?: string | null;
	currencyCode?: string | null;
	comparableTotal?: number | null;
	eHandoffReady: boolean;
	updatedAt?: string;
};

/** Purchase intent created from D selection — Cursor3 getIntent. */
export type InternalPurchaseIntent = {
	id: string;
	selectionCandidateId: string;
	requirementId: string;
	partnerCompanyId: string;
	quoteId: string;
	supplierCompanyId: string;
	aliasLabel?: string | null;
	currencyCode: string;
	status: string;
	purchaseSubtotal: number;
	purchaseTotal: number;
	paymentTerms?: string | null;
	/** Present only when margin is authorized; otherwise omit/undefined. */
	grossMargin?: number | null;
	canViewMargin?: boolean;
	lines: InternalPurchaseIntentLine[];
};

export type InternalPurchaseIntentLine = {
	id: string;
	quoteLineId?: string | null;
	requirementLineId?: string | null;
	description?: string | null;
	quantity: number;
	purchaseUnitPrice: number;
	lineAmount: number;
	valueState?: string | null;
};

/** Consolidated SCO→Supplier order — Cursor3 getSupplierOrder. */
export type InternalSupplierOrder = {
	id: string;
	orderReference?: string | null;
	scoBuyerCompanyId?: string | null;
	supplierCompanyId: string;
	status: string;
	currencyCode: string;
	purchaseSubtotal: number;
	purchaseTotal: number;
	paymentTerms?: string | null;
	commercialTerms?: string | null;
	issuedAt?: string | null;
	confirmedAt?: string | null;
	confirmationReference?: string | null;
	expectedDeliveryDate?: string | null;
	grossMargin?: number | null;
	canViewMargin?: boolean;
	lines: InternalSupplierOrderLine[];
};

export type InternalSupplierOrderLine = {
	id: string;
	partnerCompanyId: string;
	requirementLineId?: string | null;
	description?: string | null;
	orderedQuantity: number;
	confirmedQuantity?: number | null;
	allocatedQuantity?: number | null;
	purchaseUnitPrice: number;
	lineAmount: number;
	availableToAllocate: number;
};

export type InternalPartnerAllocation = {
	id: string;
	supplierOrderLineId: string;
	supplierOrderId: string;
	partnerCompanyId: string;
	requirementId?: string | null;
	requirementLineId?: string | null;
	allocatedQuantity: number;
	purchaseUnitPrice: number;
	purchaseLineAmount: number;
	status: string;
	resaleOrderLineId?: string | null;
};

export type InternalResaleOrder = {
	id: string;
	orderReference?: string | null;
	partnerCompanyId: string;
	scoSellerCompanyId?: string | null;
	status: string;
	currencyCode: string;
	paymentTerms?: string | null;
	saleSubtotal: number;
	saleTotal: number;
	/** Internal cost total — may be omitted by permission. */
	purchaseCostTotal?: number | null;
	grossMargin?: number | null;
	canViewMargin?: boolean;
	supplierAliasLabel?: string | null;
	fulfillmentReady: boolean;
	confirmedAt?: string | null;
	lines: InternalResaleLine[];
};

export type InternalResaleLine = {
	id: string;
	allocationId?: string | null;
	description?: string | null;
	quantity: number;
	saleUnitPrice: number;
	saleLineAmount: number;
	purchaseUnitPrice?: number | null;
	purchaseLineAmount?: number | null;
	lineGrossMargin?: number | null;
};

/** UI consolidation row derived from supplier order lines (same-supplier only). */
export type InternalConsolidationRow = {
	partnerCompanyId: string;
	partnerDisplayName?: string | null;
	requirementId: string;
	purchaseLineId: string;
	supplierCompanyId: string;
	requestedQuantity: number;
	allocatedQuantity: number;
	remainingQuantity: number;
};

/** UI allocation table row (maps to supplier order line + allocation). */
export type InternalAllocationLine = {
	id?: string;
	purchaseLineId: string;
	partnerCompanyId: string;
	requirementId?: string | null;
	purchasedQuantity: number;
	allocatedQuantity: number;
	remainingQuantity: number;
	partnerRequestedQuantity?: number | null;
	resaleLineStatus?: string | null;
};

export type InternalFulfillmentReadiness = {
	ready: boolean;
	reasons: string[];
	source: 'RESALE_ORDER' | 'SUPPLIER_ORDER' | 'BACKEND';
	resaleOrderId?: string;
	supplierOrderId?: string;
	fulfillmentReady?: boolean;
};

/** D internal requirement list row (SELECTION_READY feeds E queue). */
export type InternalProcurementRequirementListItem = {
	id: string;
	companyId: string;
	title: string;
	sector?: string | null;
	status: string;
	submittedAt?: string | null;
	updatedAt: string;
};

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
		partnerQualificationCurrent: (companyId: string, signal?: AbortSignal) =>
			request<PartnerQualification | null>('/api/v1/partner/qualification/current', { companyId, signal }),
		partnerQualificationSaveDraft: (companyId: string, body: PartnerQualificationDraft, signal?: AbortSignal) =>
			request<PartnerQualification>('/api/v1/partner/qualification/draft', { method: 'PUT', companyId, body, signal }),
		partnerQualificationCreateDraft: (companyId: string, body: PartnerQualificationDraft, signal?: AbortSignal) =>
			request<PartnerQualification>('/api/v1/partner/qualification/draft', { method: 'POST', companyId, body, signal }),
		partnerQualificationSubmit: (companyId: string, signal?: AbortSignal) =>
			request<PartnerQualification>('/api/v1/partner/qualification/submit', { method: 'POST', companyId, body: {}, signal }),
		partnerDocumentUpload: (companyId: string, body: PartnerDocumentUploadInput, signal?: AbortSignal) =>
			request<PartnerDocumentUploadResult>('/api/v1/partner/documents/upload', { method: 'POST', companyId, body, signal }),
		partnerDocuments: (companyId: string, page = 1, pageSize = 20, signal?: AbortSignal) =>
			request<PartnerDocumentPage>(`/api/v1/partner/documents?page=${page}&pageSize=${pageSize}`, { companyId, signal }),
		partnerDocumentDownload: (companyId: string, documentId: string, signal?: AbortSignal) =>
			fetchImpl(`${baseUrl}/api/v1/partner/documents/${documentId}/download`, {
				method: 'GET',
				credentials: 'include',
				headers: {
					accept: '*/*',
					'x-sco-company-id': companyId,
				},
				signal,
			}).then(async (response) => {
				if (!response.ok) {
					const payload = await response.json().catch(() => ({})) as Partial<ErrorEnvelope>;
					throw new ApiClientError(response.status, payload.error?.code ?? 'REQUEST_FAILED', response.headers.get('x-correlation-id') ?? undefined);
				}
				return response;
			}),
		partnerVerifyCreate: (companyId: string, signal?: AbortSignal) =>
			request<PartnerVerifyDraft>('/api/v1/partner/verify/requests', { method: 'POST', companyId, body: { productMode: 'QUOTE_CHECK' }, signal }),
		partnerVerifyAttachQuote: (companyId: string, requestId: string, body: PartnerVerifyAttachQuoteInput, signal?: AbortSignal) =>
			request<PartnerVerifyAttachResult>(`/api/v1/partner/verify/requests/${requestId}/quote`, { method: 'POST', companyId, body, signal }),
		partnerVerifySubmit: (companyId: string, requestId: string, revisionId: string, signal?: AbortSignal) =>
			request<PartnerVerifySubmitResult>(`/api/v1/partner/verify/requests/${requestId}/submit`, { method: 'POST', companyId, body: { revisionId }, signal }),
		partnerVerifyGetResult: (companyId: string, requestId: string, signal?: AbortSignal) =>
			request<PartnerVerifyResult>(`/api/v1/partner/verify/requests/${requestId}/result`, { companyId, signal }),
		companies: (companyId: string, page = 1, pageSize = 25) => request<Page<{ id: string; name: string; type: string; status: string }>>(`/api/v1/internal/companies?page=${page}&pageSize=${pageSize}`, { companyId }),

		/* —— SCO Internal Operations (ScoInternalGuard; no company header) —— */
		internalQualifications: (signal?: AbortSignal) =>
			request<InternalQualificationListItem[]>('/api/v1/internal/network/qualifications', { signal }),
		internalQualificationDecide: (
			id: string,
			body: { status: InternalQualificationDecisionStatus; reason: string },
			signal?: AbortSignal,
		) =>
			request<{ id: string; status?: string; decision_reason?: string; partner_action_required_reason?: string | null }>(
				`/api/v1/internal/network/qualifications/${id}/decision`,
				{ method: 'PATCH', body, signal },
			),
		internalPartnerships: (signal?: AbortSignal) =>
			request<InternalPartnershipReadiness[]>('/api/v1/internal/network/partnerships', { signal }),
		internalPartnershipReadiness: (partnershipId: string, signal?: AbortSignal) =>
			request<InternalPartnershipReadiness>(`/api/v1/internal/network/partnerships/${partnershipId}/readiness`, { signal }),
		internalPartnershipApprove: (partnershipId: string, reason: string, signal?: AbortSignal) =>
			request<unknown>(`/api/v1/internal/network/partnerships/${partnershipId}/approve`, { method: 'POST', body: { reason }, signal }),
		internalPartnershipActivate: (partnershipId: string, signal?: AbortSignal) =>
			request<unknown>(`/api/v1/internal/network/partnerships/${partnershipId}/activate`, { method: 'POST', body: {}, signal }),
		internalAgreementPolicyPublish: (policyId: string, signal?: AbortSignal) =>
			request<unknown>(`/api/v1/internal/network/agreement-policies/${policyId}/publish`, { method: 'POST', body: {}, signal }),
		internalDocuments: (page = 1, pageSize = 20, signal?: AbortSignal) =>
			request<{ items: InternalDocumentListItem[]; page: number; pageSize: number }>(
				`/api/v1/internal/documents?page=${page}&pageSize=${pageSize}`,
				{ signal },
			),
		internalVerifyQueue: (page = 1, pageSize = 20, status?: string, signal?: AbortSignal) =>
			request<{ items: InternalVerifyQueueItem[]; page: number; pageSize: number }>(
				`/api/v1/internal/verify/queue?page=${page}&pageSize=${pageSize}${status ? `&status=${encodeURIComponent(status)}` : ''}`,
				{ signal },
			),
		internalVerifyStartRun: (
			revisionId: string,
			body: { methodologyVersion: string; evidenceFingerprint: string; retryOfRunId?: string },
			signal?: AbortSignal,
		) =>
			request<{ runId: string; status: string }>(`/api/v1/internal/verify/revisions/${revisionId}/runs`, {
				method: 'POST',
				body,
				signal,
			}),
		internalVerifyLineResult: (
			runId: string,
			lineId: string,
			body: { outcome: 'VERIFIED' | 'INSUFFICIENT_EVIDENCE' | 'EXCLUDED'; reason?: string },
			signal?: AbortSignal,
		) =>
			request<{ resultId: string }>(`/api/v1/internal/verify/runs/${runId}/lines/${lineId}/result`, {
				method: 'POST',
				body,
				signal,
			}),
		internalVerifyCompleteRun: (runId: string, signal?: AbortSignal) =>
			request<{ runId: string; status: string }>(`/api/v1/internal/verify/runs/${runId}/complete`, {
				method: 'POST',
				body: {},
				signal,
			}),
		internalVerifyPrepareAnalysis: (runId: string, body: InternalVerifyAnalysisInput, signal?: AbortSignal) =>
			request<{ resultId: string; status: string }>(`/api/v1/internal/verify/runs/${runId}/analysis`, {
				method: 'POST',
				body,
				signal,
			}),
		internalVerifyApproveResult: (resultId: string, signal?: AbortSignal) =>
			request<{ resultId: string; status: string }>(`/api/v1/internal/verify/results/${resultId}/approve`, {
				method: 'POST',
				body: {},
				signal,
			}),

		/* —— Capability E internal commercial (Cursor3 signed routes only) —— */
		/** D certified list — SELECTION_READY rows feed E commercial entry (no unsigned commercial list APIs). */
		internalProcurementRequirements: (signal?: AbortSignal) =>
			request<InternalProcurementRequirementListItem[]>('/api/v1/internal/procurement/requirements', { signal }),
		internalPurchaseCreateFromSelection: (
			body: { selectionCandidateId: string; idempotencyKey: string },
			signal?: AbortSignal,
		) =>
			request<InternalPurchaseIntent>('/api/v1/internal/commercial/purchases/from-selection', {
				method: 'POST',
				body,
				signal,
			}),
		internalPurchaseGet: (intentId: string, signal?: AbortSignal) =>
			request<InternalPurchaseIntent>(`/api/v1/internal/commercial/purchases/${intentId}`, { signal }),
		internalPurchaseApprove: (intentId: string, signal?: AbortSignal) =>
			request<InternalPurchaseIntent>(`/api/v1/internal/commercial/purchases/${intentId}/approve`, {
				method: 'POST',
				body: {},
				signal,
			}),
		internalSupplierOrderCreate: (
			body: { intentIds: string[]; idempotencyKey: string; deliveryContext?: string; commercialTerms?: string },
			signal?: AbortSignal,
		) =>
			request<InternalSupplierOrder>('/api/v1/internal/commercial/supplier-orders', {
				method: 'POST',
				body,
				signal,
			}),
		internalSupplierOrderGet: (orderId: string, signal?: AbortSignal) =>
			request<InternalSupplierOrder>(`/api/v1/internal/commercial/supplier-orders/${orderId}`, { signal }),
		internalSupplierOrderApprove: (orderId: string, signal?: AbortSignal) =>
			request<InternalSupplierOrder>(`/api/v1/internal/commercial/supplier-orders/${orderId}/approve`, {
				method: 'POST',
				body: {},
				signal,
			}),
		internalSupplierOrderIssue: (orderId: string, signal?: AbortSignal) =>
			request<InternalSupplierOrder>(`/api/v1/internal/commercial/supplier-orders/${orderId}/issue`, {
				method: 'POST',
				body: {},
				signal,
			}),
		internalSupplierOrderConfirm: (
			orderId: string,
			body: {
				confirmationReference?: string;
				expectedDeliveryDate?: string;
				notes?: string;
				lineConfirmations?: Array<{ lineId: string; confirmedQuantity: number }>;
			},
			signal?: AbortSignal,
		) =>
			request<InternalSupplierOrder>(`/api/v1/internal/commercial/supplier-orders/${orderId}/confirm`, {
				method: 'POST',
				body,
				signal,
			}),
		internalAllocationCreate: (
			body: { orderLineId: string; quantity: number; idempotencyKey: string },
			signal?: AbortSignal,
		) =>
			request<InternalPartnerAllocation>('/api/v1/internal/commercial/allocations', {
				method: 'POST',
				body,
				signal,
			}),
		internalAllocationGet: (allocationId: string, signal?: AbortSignal) =>
			request<InternalPartnerAllocation>(`/api/v1/internal/commercial/allocations/${allocationId}`, { signal }),
		internalResaleCreate: (
			body: {
				partnerCompanyId: string;
				allocations: Array<{ allocationId: string; saleUnitPrice: number }>;
				idempotencyKey: string;
				paymentTerms?: string;
				deliveryTerms?: string;
				commercialNotes?: string;
			},
			signal?: AbortSignal,
		) =>
			request<InternalResaleOrder>('/api/v1/internal/commercial/resale-orders', {
				method: 'POST',
				body,
				signal,
			}),
		internalResaleGet: (resaleOrderId: string, signal?: AbortSignal) =>
			request<InternalResaleOrder>(`/api/v1/internal/commercial/resale-orders/${resaleOrderId}`, { signal }),
		internalResaleApprove: (resaleOrderId: string, signal?: AbortSignal) =>
			request<InternalResaleOrder>(`/api/v1/internal/commercial/resale-orders/${resaleOrderId}/approve`, {
				method: 'POST',
				body: {},
				signal,
			}),
		internalResaleConfirm: (resaleOrderId: string, signal?: AbortSignal) =>
			request<InternalResaleOrder>(`/api/v1/internal/commercial/resale-orders/${resaleOrderId}/confirm`, {
				method: 'POST',
				body: {},
				signal,
			}),
	};
}
