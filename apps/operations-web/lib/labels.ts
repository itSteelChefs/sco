/** Arabic presentation labels for internal operations — domain values remain backend-authored. */

export function qualificationStatusAr(status: string): string {
  switch (status) {
    case 'DRAFT':
    case 'APPLICATION':
      return 'مسودة';
    case 'SUBMITTED':
      return 'مُرسَل للمراجعة';
    case 'UNDER_REVIEW':
      return 'قيد المراجعة';
    case 'ACTION_REQUIRED':
      return 'يتطلب إجراءً من الشريك';
    case 'APPROVED':
      return 'معتمد';
    case 'REJECTED':
      return 'مرفوض';
    default:
      return status;
  }
}

export function partnershipStatusAr(status: string): string {
  switch (status) {
    case 'UNDER_REVIEW':
      return 'قيد المراجعة';
    case 'APPROVED':
      return 'معتمد';
    case 'ACTIVE':
      return 'نشط';
    case 'SUSPENDED':
      return 'موقوف';
    case 'REVOKED':
      return 'ملغى';
    case 'REJECTED':
      return 'مرفوض';
    default:
      return status;
  }
}

export function verifyRequestStatusAr(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'مسودة';
    case 'SUBMITTED':
      return 'مُرسَل';
    case 'IN_REVIEW':
      return 'قيد التحليل';
    case 'COMPLETED':
      return 'مكتمل';
    case 'CANCELLED':
      return 'ملغى';
    default:
      return status;
  }
}

export function verifyResultStatusAr(status: string | null | undefined): string {
  switch (status) {
    case 'PREPARED':
      return 'جاهز للاعتماد';
    case 'FINAL':
      return 'معتمد';
    case 'SUPERSEDED':
      return 'مستبدَل';
    default:
      return status || '—';
  }
}

export function classificationAr(value: string | null | undefined): string {
  switch (value) {
    case 'FULL':
      return 'تغطية كاملة';
    case 'PARTIAL':
      return 'تغطية جزئية';
    case 'INSUFFICIENT_FOR_RESULT':
      return 'غير كافٍ لنتيجة';
    default:
      return value || '—';
  }
}

export function documentCategoryAr(category: string | null | undefined): string {
  switch (category) {
    case 'QUALIFICATION_SUPPORT':
      return 'دعم التأهيل';
    case 'AGREEMENT_ARTIFACT':
      return 'أثر اتفاقية';
    case 'VERIFY_QUOTE':
      return 'عرض سعر للتوثيق';
    case 'GENERAL':
      return 'عام';
    default:
      return category || '—';
  }
}

export function formatWhen(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
