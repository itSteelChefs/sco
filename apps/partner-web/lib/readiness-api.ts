import { api } from './api';

/** Wave2 partner readiness client — shared contracts only (no parallel DTO invention). */
export const readinessApi = {
  context: api.context.bind(api),
  partnerJourney: api.partnerJourney.bind(api),
  partnerAgreements: api.partnerAgreements.bind(api),
  acceptPartnerAgreement: api.acceptPartnerAgreement.bind(api),
  qualificationCurrent: api.partnerQualificationCurrent.bind(api),
  qualificationSaveDraft: api.partnerQualificationSaveDraft.bind(api),
  qualificationCreateDraft: api.partnerQualificationCreateDraft.bind(api),
  qualificationSubmit: api.partnerQualificationSubmit.bind(api),
  documentUpload: api.partnerDocumentUpload.bind(api),
  documentList: api.partnerDocuments.bind(api),
  documentDownload: api.partnerDocumentDownload.bind(api),
  verifyCreate: api.partnerVerifyCreate.bind(api),
  verifyAttachQuote: api.partnerVerifyAttachQuote.bind(api),
  verifySubmit: api.partnerVerifySubmit.bind(api),
  verifyGetResult: api.partnerVerifyGetResult.bind(api),
};
