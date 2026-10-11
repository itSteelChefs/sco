import { api } from './api';
import type {
  PartnerEngineeringApprovedResultDto,
  PartnerEngineeringHandoffDto,
  PartnerEngineeringRequestDetailDto,
  PartnerEngineeringRequestListItemDto,
  PartnerEngineeringResultDto,
} from '@sco/contracts';
import type {
  PartnerEngineeringDraftInput,
  PartnerEngineeringRequestDetail,
  PartnerEngineeringRequestSummary,
  PartnerEngineeringResultVersion,
} from '../components/engineering/engineering-types';
import { stripForbiddenEngineeringFields } from '../components/engineering/engineering-guards.mjs';

export function isPartnerEngineeringContractReady(): boolean {
  return (
    typeof api.partnerEngineeringRequests === 'function' &&
    typeof api.partnerEngineeringRequest === 'function' &&
    typeof api.partnerEngineeringCreateDraft === 'function' &&
    typeof api.partnerEngineeringSubmit === 'function' &&
    typeof api.partnerEngineeringResult === 'function'
  );
}

/** Partner cannot create D handoff — designed flow is internal-only (engineering.boq.approve). */
export function isPartnerEngineeringHandoffReady(): boolean {
  return false;
}

export class EngineeringWaitingError extends Error {
  readonly code = 'WAITING_BACKEND';
  constructor(message = 'WAITING_BACKEND') {
    super(message);
    this.name = 'EngineeringWaitingError';
  }
}

function mapSummary(raw: PartnerEngineeringRequestListItemDto): PartnerEngineeringRequestSummary {
  const cleaned = stripForbiddenEngineeringFields(raw) as PartnerEngineeringRequestListItemDto;
  return {
    requestId: cleaned.id,
    reference: cleaned.projectReference?.trim() || cleaned.id.slice(0, 8),
    title: cleaned.title,
    requestType: 'BOQ_PREPARATION',
    sector: cleaned.sector,
    status: cleaned.status,
    submittedAt: cleaned.submittedAt ?? null,
    currentResultVersion: null,
    nextActionLabel: null,
  };
}

function mapLines(approved: PartnerEngineeringApprovedResultDto): PartnerEngineeringResultVersion['lines'] {
  const lines = Array.isArray(approved.lines) ? approved.lines : [];
  return lines.map((line, index) => ({
    lineNumber: typeof line.sortOrder === 'number' ? line.sortOrder + 1 : index + 1,
    itemCode: line.lineKey ?? null,
    description: String(line.description ?? ''),
    specification: line.specification ?? null,
    unit: String(line.unitId ?? ''),
    quantity: Number(line.quantity ?? 0),
    classification: line.discipline ?? null,
    notes: line.partnerVisibleNotes ?? null,
  }));
}

function mapResultVersions(result: PartnerEngineeringResultDto | null): PartnerEngineeringResultVersion[] {
  const approved = result?.approvedResult;
  if (!approved) return [];
  const lines = mapLines(approved);
  return [
    {
      versionId: approved.boqVersionId,
      versionLabel: `v${approved.versionNumber}`,
      status: approved.status,
      approvedAt: approved.approvedAt ?? null,
      summary: approved.partnerVisibleNotes ?? null,
      isCurrent: true,
      lines,
      sourceReferences: lines
        .map((line, index) => {
          const src = approved.lines[index]?.sourceReference;
          return src ? { label: src } : null;
        })
        .filter((item): item is { label: string } => Boolean(item)),
    },
  ];
}

function mapHandoff(handoff: PartnerEngineeringHandoffDto | null | undefined): PartnerEngineeringRequestDetail['handoff'] {
  if (!handoff?.procurementRequirementId) {
    return { handedOff: false, canCreateHandoff: false };
  }
  return {
    handedOff: true,
    procurementRequirementId: handoff.procurementRequirementId,
    procurementRequirementReference: handoff.procurementRequirementId,
    canCreateHandoff: false,
  };
}

function mapDetail(
  raw: PartnerEngineeringRequestDetailDto,
  result: PartnerEngineeringResultDto | null,
): PartnerEngineeringRequestDetail {
  const cleaned = stripForbiddenEngineeringFields(raw) as PartnerEngineeringRequestDetailDto;
  const resultVersions = mapResultVersions(result);
  const current = resultVersions.find((item) => item.isCurrent);
  const actionMessage = cleaned.actionRequiredMessage ?? result?.actionRequiredMessage ?? null;
  return {
    requestId: cleaned.id,
    reference: cleaned.projectReference?.trim() || cleaned.id.slice(0, 8),
    title: cleaned.title,
    requestType: cleaned.requestType ?? 'BOQ_PREPARATION',
    sector: cleaned.sector,
    status: cleaned.status,
    submittedAt: cleaned.submittedAt ?? null,
    currentResultVersion: current?.versionLabel ?? null,
    nextActionLabel: null,
    projectDetails: cleaned.description ?? null,
    partnerVisibleNotes: cleaned.partnerVisibleNotes ?? result?.partnerVisibleNotes ?? null,
    actionRequired:
      String(cleaned.status).toUpperCase() === 'ACTION_REQUIRED' && actionMessage
        ? { message: actionMessage }
        : null,
    documents: (cleaned.documents ?? []).map((doc) => ({
      documentId: doc.documentId,
      filename: doc.classification || doc.documentId.slice(0, 8),
      category: doc.classification,
      createdAt: doc.createdAt,
    })),
    resultVersions,
    handoff: mapHandoff(result?.handoff ?? null),
  };
}

function toDraftBody(body: PartnerEngineeringDraftInput) {
  return {
    title: body.title,
    sector: body.sector,
    requestType: body.requestType,
    description: body.projectDetails,
  };
}

export const engineeringApi = {
  isReady: isPartnerEngineeringContractReady,
  canHandoffApi: isPartnerEngineeringHandoffReady,

  async list(companyId: string, signal?: AbortSignal): Promise<PartnerEngineeringRequestSummary[]> {
    if (!isPartnerEngineeringContractReady()) throw new EngineeringWaitingError();
    const raw = await api.partnerEngineeringRequests(companyId, signal);
    return (Array.isArray(raw) ? raw : []).map((item) => mapSummary(item));
  },

  async get(companyId: string, requestId: string, signal?: AbortSignal): Promise<PartnerEngineeringRequestDetail> {
    if (!isPartnerEngineeringContractReady()) throw new EngineeringWaitingError();
    const raw = await api.partnerEngineeringRequest(companyId, requestId, signal);
    let result: PartnerEngineeringResultDto | null = null;
    try {
      result = await api.partnerEngineeringResult(companyId, requestId, signal);
    } catch {
      result = null;
    }
    return mapDetail(raw, result);
  },

  async createDraft(companyId: string, body: PartnerEngineeringDraftInput, signal?: AbortSignal) {
    if (!isPartnerEngineeringContractReady()) throw new EngineeringWaitingError();
    const raw = await api.partnerEngineeringCreateDraft(companyId, toDraftBody(body), signal);
    return mapDetail(raw, null);
  },

  async submit(companyId: string, requestId: string, signal?: AbortSignal) {
    if (!isPartnerEngineeringContractReady()) throw new EngineeringWaitingError();
    const raw = await api.partnerEngineeringSubmit(companyId, requestId, signal);
    return mapDetail(raw, null);
  },

  async respond(
    companyId: string,
    requestId: string,
    body: { message?: string; documentIds?: string[] },
    signal?: AbortSignal,
  ) {
    if (!isPartnerEngineeringContractReady()) throw new EngineeringWaitingError();
    const current = await api.partnerEngineeringRequest(companyId, requestId, signal);
    if (body.message?.trim()) {
      await api.partnerEngineeringUpdateDraft(
        companyId,
        requestId,
        {
          title: current.title,
          sector: current.sector,
          requestType: current.requestType ?? undefined,
          projectReference: current.projectReference ?? undefined,
          description: body.message.trim(),
        },
        signal,
      );
    }
    if (body.documentIds?.length) {
      for (const documentId of body.documentIds) {
        await api.partnerEngineeringLinkDocument(
          companyId,
          requestId,
          { documentId, classification: 'OTHER' },
          signal,
        );
      }
    }
    const raw = await api.partnerEngineeringSubmit(companyId, requestId, signal);
    return mapDetail(raw, null);
  },

  async linkDocuments(companyId: string, requestId: string, documentIds: string[], signal?: AbortSignal) {
    if (!isPartnerEngineeringContractReady()) throw new EngineeringWaitingError();
    for (const documentId of documentIds) {
      await api.partnerEngineeringLinkDocument(
        companyId,
        requestId,
        { documentId, classification: 'OTHER' },
        signal,
      );
    }
    return this.get(companyId, requestId, signal);
  },

  async createProcurement(
    _companyId: string,
    _requestId: string,
    _opts?: { resultVersionId?: string; idempotencyKey?: string },
    _signal?: AbortSignal,
  ): Promise<{ procurementRequirementId: string; procurementRequirementReference?: string }> {
    throw new EngineeringWaitingError('HANDOFF_INTERNAL_ONLY');
  },
};
