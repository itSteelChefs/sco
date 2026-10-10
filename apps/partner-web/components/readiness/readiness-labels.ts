/** Presentation labels only — domain values stay backend-authored. */

export type PresentationReadiness =
  | 'INCOMPLETE'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'ACTION_REQUIRED'
  | 'APPROVED'
  | 'UNKNOWN';

export function mapQualificationPresentation(
  qualification: string | null | undefined,
): PresentationReadiness {
  switch (qualification) {
    case 'NONE':
    case null:
    case undefined:
      return 'INCOMPLETE';
    case 'APPLICATION':
      return 'IN_PROGRESS';
    case 'UNDER_REVIEW':
      return 'UNDER_REVIEW';
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'ACTION_REQUIRED';
    default:
      return 'UNKNOWN';
  }
}

export function qualificationLabelAr(presentation: PresentationReadiness): string {
  switch (presentation) {
    case 'INCOMPLETE':
      return 'غير مكتمل';
    case 'IN_PROGRESS':
      return 'قيد الإعداد';
    case 'SUBMITTED':
      return 'مُرسَل';
    case 'UNDER_REVIEW':
      return 'قيد مراجعة سكو';
    case 'ACTION_REQUIRED':
      return 'يتطلب إجراءً';
    case 'APPROVED':
      return 'معتمد';
    default:
      return 'غير معروف';
  }
}

export function agreementTypeLabelAr(type: string): string {
  if (type === 'BINDING_CONFIDENTIALITY') return 'السرية الملزمة';
  if (type === 'PARTNERSHIP_TERMS') return 'شروط الشراكة';
  return type;
}

export function agreementStatusLabelAr(status: string): string {
  switch (status) {
    case 'ACCEPTED':
      return 'مقبول';
    case 'NOT_ACCEPTED':
      return 'مطلوب';
    case 'REACCEPTANCE_REQUIRED':
      return 'يتطلب إعادة قبول (تغيّر الإصدار)';
    case 'SUSPENDED':
      return 'موقوف';
    default:
      return status;
  }
}

/** Launch package focus — still render other required types if API returns them. */
export const LAUNCH_AGREEMENT_FOCUS = new Set(['BINDING_CONFIDENTIALITY', 'PARTNERSHIP_TERMS']);

export const SECTOR_OPTIONS = [
  { value: 'HVAC_REFRIGERATION', label: 'التكييف والتبريد' },
  { value: 'ELECTRICAL', label: 'الكهرباء' },
  { value: 'PLUMBING', label: 'السباكة' },
  { value: 'MULTI', label: 'متعدد المجالات' },
] as const;

export const NEED_OPTIONS = [
  { value: 'VERIFY_QUOTE_CHECK', label: 'توثيق عروض الأسعار (Quote Check)' },
  { value: 'PROCUREMENT_SUPPORT', label: 'دعم المشتريات' },
  { value: 'BOTH', label: 'كلاهما' },
] as const;

export const SIZE_OPTIONS = [
  { value: 'OCCASIONAL', label: 'طلبات متقطعة' },
  { value: 'MONTHLY', label: 'شهري تقريبًا' },
  { value: 'QUARTERLY_PROJECTS', label: 'مشاريع ربع سنوية' },
  { value: 'CONTINUOUS', label: 'مستمر / عالي التكرار' },
] as const;
