/** Presentation labels only — domain values stay backend-authored. */

export type PresentationReadiness =
  | 'INCOMPLETE'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'ACTION_REQUIRED'
  | 'APPROVED'
  | 'UNKNOWN';

export function mapQualificationPresentation(qualification: string | null | undefined): PresentationReadiness {
  switch (qualification) {
    case 'NONE':
    case null:
    case undefined:
      return 'INCOMPLETE';
    case 'DRAFT':
    case 'APPLICATION':
      return 'IN_PROGRESS';
    case 'SUBMITTED':
      return 'SUBMITTED';
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
      return 'مسودة / قيد الإعداد';
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

export function relationshipStageLabelAr(stage: string | null | undefined): string {
  switch (stage) {
    case 'REGISTRATION':
      return 'تسجيل';
    case 'QUALIFICATION':
      return 'تأهيل';
    case 'AGREEMENT':
      return 'اتفاقيات';
    case 'APPROVAL':
      return 'اعتماد';
    case 'ONBOARDING':
      return 'تهيئة';
    case 'ACTIVE':
      return 'نشطة';
    case 'SUSPENDED':
      return 'موقوفة';
    case 'REVOKED':
      return 'ملغاة';
    case 'REJECTED':
      return 'مرفوضة';
    default:
      return stage ? stage : 'غير متاحة';
  }
}

export function partnershipStatusLabelAr(status: string | null | undefined): string {
  switch (status) {
    case 'NONE':
      return 'لا توجد';
    case 'UNDER_REVIEW':
      return 'قيد المراجعة';
    case 'APPROVED':
      return 'معتمدة';
    case 'ACTIVE':
      return 'نشطة';
    case 'SUSPENDED':
      return 'موقوفة';
    case 'REVOKED':
      return 'ملغاة';
    case 'REJECTED':
      return 'مرفوضة';
    default:
      return status ? status : '—';
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

export function verifyRequestStatusLabelAr(status: string | null | undefined): string {
  switch (status) {
    case 'DRAFT':
      return 'مسودة';
    case 'SUBMITTED':
      return 'مُرسَل';
    case 'IN_REVIEW':
      return 'قيد المراجعة';
    case 'COMPLETED':
      return 'مكتمل';
    case 'CANCELLED':
      return 'ملغى';
    default:
      return status ? status : '—';
  }
}

export function verifyClassificationLabelAr(classification: string | null | undefined): string {
  if (!classification) return '—';
  switch (classification) {
    case 'WITHIN_RANGE':
      return 'ضمن النطاق المرجعي';
    case 'ABOVE_RANGE':
      return 'أعلى من النطاق المرجعي';
    case 'BELOW_RANGE':
      return 'أدنى من النطاق المرجعي';
    case 'PARTIAL':
      return 'تحقق جزئي';
    case 'INSUFFICIENT':
      return 'بيانات غير كافية';
    default:
      return classification;
  }
}

export function coverageQualityLabelAr(entry: {
  totalLineCount: number;
  verifiedLineCount: number;
  insufficientLineCount: number;
}): string {
  if (entry.totalLineCount <= 0) return 'لا بنود';
  if (entry.verifiedLineCount >= entry.totalLineCount && entry.insufficientLineCount === 0) {
    return 'تحقق كامل';
  }
  if (entry.verifiedLineCount > 0) return 'تحقق جزئي';
  return 'غير قابل للتحقق';
}

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
  { value: 'SMALL', label: 'صغير' },
  { value: 'MEDIUM', label: 'متوسط' },
  { value: 'LARGE', label: 'كبير' },
  { value: 'PROJECT_BASED', label: 'حسب المشروع' },
] as const;

export const FREQUENCY_OPTIONS = [
  { value: 'OCCASIONAL', label: 'متقطع' },
  { value: 'MONTHLY', label: 'شهري' },
  { value: 'WEEKLY', label: 'أسبوعي' },
  { value: 'PROJECT_BASED', label: 'حسب المشروع' },
] as const;

export const DOCUMENT_CATEGORY_OPTIONS = [
  { value: 'QUALIFICATION_SUPPORT', label: 'دعم التأهيل' },
  { value: 'AGREEMENT_ARTIFACT', label: 'مرفق اتفاقية' },
  { value: 'VERIFY_QUOTE', label: 'عرض سعر للتوثيق' },
  { value: 'GENERAL', label: 'عام' },
] as const;

export function documentCategoryLabelAr(category: string): string {
  return DOCUMENT_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category;
}

export function documentGroupLabelAr(category: string): string {
  switch (category) {
    case 'QUALIFICATION_SUPPORT':
      return 'مستندات التأهيل';
    case 'AGREEMENT_ARTIFACT':
      return 'مستندات الاتفاقيات';
    case 'VERIFY_QUOTE':
      return 'مستندات التوثيق';
    case 'GENERAL':
      return 'مستندات عامة';
    default:
      return 'مستندات أخرى';
  }
}
