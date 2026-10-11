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

export function purchaseStatusAr(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'مسودة';
    case 'PENDING_APPROVAL':
      return 'بانتظار الاعتماد التجاري';
    case 'APPROVED':
      return 'معتمد تجاريًا';
    case 'ISSUED':
      return 'مُصدَر للمورّد';
    case 'CONFIRMED':
      return 'مؤكد من المورّد';
    case 'PARTIALLY_ALLOCATED':
      return 'توزيع جزئي';
    case 'ALLOCATED':
      return 'موزَّع';
    case 'CANCELLED':
      return 'ملغى';
    case 'REVISED':
      return 'مراجَع';
    default:
      return status;
  }
}

export function resaleStatusAr(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'مسودة';
    case 'PENDING_CONFIRMATION':
      return 'بانتظار التأكيد';
    case 'CONFIRMED':
      return 'مؤكد';
    case 'CANCELLED':
      return 'ملغى';
    default:
      return status;
  }
}

export function moneyAr(amount: number | null | undefined, currency = 'SAR'): string {
  if (amount == null || Number.isNaN(amount)) return '—';
  return new Intl.NumberFormat('ar-SA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
}

export function readinessReasonAr(reason: string): string {
  switch (reason) {
    case 'SUPPLIER_CONFIRMATION_MISSING':
      return 'تأكيد المورّد ناقص';
    case 'ALLOCATION_INCOMPLETE':
      return 'التوزيع غير مكتمل';
    case 'RESALE_NOT_CONFIRMED':
      return 'أمر إعادة البيع للشريك غير مؤكد';
    case 'COMMERCIAL_APPROVAL_MISSING':
      return 'الاعتماد التجاري ناقص';
    case 'PO_NOT_ISSUED':
      return 'أمر الشراء غير مُصدَر';
    default:
      return reason;
  }
}

export function engineeringStatusAr(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'مسودة شريك';
    case 'SUBMITTED':
      return 'جديد / مُرسَل';
    case 'ASSIGNED':
      return 'مُسنَد';
    case 'IN_REVIEW':
      return 'قيد المراجعة';
    case 'ACTION_REQUIRED':
      return 'يتطلب معلومات من الشريك';
    case 'BOQ_IN_PROGRESS':
      return 'جداول كميات قيد الإعداد';
    case 'PENDING_APPROVAL':
      return 'بانتظار الاعتماد';
    case 'APPROVED':
      return 'معتمد / مكتمل';
    case 'CANCELLED':
      return 'ملغى';
    case 'SUPERSEDED':
      return 'مُستبدَل';
    default:
      return status;
  }
}

export function boqVersionStatusAr(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'مسودة';
    case 'IN_REVIEW':
      return 'قيد المراجعة';
    case 'APPROVED':
      return 'معتمد';
    case 'SUPERSEDED':
      return 'مُستبدَل';
    default:
      return status;
  }
}

export function engineeringDocClassAr(value: string | null | undefined): string {
  switch (value) {
    case 'DRAWING':
    case 'ENGINEERING_DRAWING':
      return 'مخطط';
    case 'SPECIFICATION':
    case 'ENGINEERING_SPECIFICATION':
      return 'مواصفات';
    case 'SCHEDULE':
    case 'ENGINEERING_SCHEDULE':
      return 'جدول';
    case 'SPREADSHEET':
    case 'ENGINEERING_SPREADSHEET':
      return 'جدول بيانات';
    case 'IMAGE':
    case 'ENGINEERING_IMAGE':
      return 'صورة';
    case 'OTHER':
    case 'ENGINEERING_OTHER':
      return 'أخرى';
    default:
      return value || '—';
  }
}

export function gBenchmarkSignalAr(signal: string): string {
  switch (signal) {
    case 'ABOVE_HISTORICAL_RANGE':
      return 'أعلى من النطاق التاريخي';
    case 'WITHIN_HISTORICAL_RANGE':
      return 'ضمن النطاق التاريخي';
    case 'BELOW_HISTORICAL_RANGE':
      return 'أقل من النطاق التاريخي';
    case 'INSUFFICIENT_EVIDENCE':
      return 'بيانات غير كافية';
    default:
      return signal;
  }
}

export function gFactKindAr(kind: string): string {
  switch (kind) {
    case 'QUOTE_OBSERVED':
      return 'أسعار العروض';
    case 'QUOTE_SELECTED':
      return 'الأسعار المختارة';
    case 'SUPPLIER_CONFIRMED':
      return 'أسعار الشراء المؤكدة';
    case 'ENGINEERING_DEMAND':
      return 'طلب هندسي';
    default:
      return kind;
  }
}
