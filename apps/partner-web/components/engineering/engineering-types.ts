/** Partner-safe engineering request presentation (Capability F). */

export type PartnerEngineeringStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'ACTION_REQUIRED'
  | 'APPROVED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'UNKNOWN';

export type PartnerEngineeringRequestSummary = {
  requestId: string;
  reference: string;
  title: string;
  requestType: string;
  sector: string;
  status: string;
  submittedAt: string | null;
  currentResultVersion: string | null;
  nextActionLabel?: string | null;
};

export type PartnerEngineeringDocumentRef = {
  documentId: string;
  filename: string;
  category?: string;
  createdAt?: string;
};

export type PartnerEngineeringBoqLine = {
  lineNumber: number;
  itemCode?: string | null;
  description: string;
  specification?: string | null;
  unit: string;
  quantity: number;
  classification?: string | null;
  notes?: string | null;
};

export type PartnerEngineeringResultVersion = {
  versionId: string;
  versionLabel: string;
  status: string;
  approvedAt?: string | null;
  summary?: string | null;
  isCurrent: boolean;
  lines: PartnerEngineeringBoqLine[];
  sourceReferences?: Array<{ label: string; documentId?: string }>;
};

export type PartnerEngineeringActionRequired = {
  message: string;
  fieldsHint?: string | null;
  respondBy?: string | null;
};

export type PartnerEngineeringHandoff = {
  handedOff: boolean;
  procurementRequirementId?: string | null;
  procurementRequirementReference?: string | null;
  canCreateHandoff: boolean;
};

export type PartnerEngineeringRequestDetail = PartnerEngineeringRequestSummary & {
  projectDetails?: string | null;
  partnerVisibleNotes?: string | null;
  actionRequired?: PartnerEngineeringActionRequired | null;
  documents: PartnerEngineeringDocumentRef[];
  resultVersions: PartnerEngineeringResultVersion[];
  handoff: PartnerEngineeringHandoff;
};

export type PartnerEngineeringDraftInput = {
  title: string;
  requestType: string;
  sector: string;
  projectDetails?: string;
};
