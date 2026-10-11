import { ApiClientError } from '@sco/contracts';

/** Calm, non-leaking error copy for internal operations UI. */
export function mapOpsError(failure: unknown, fallback: string): string {
  if (!(failure instanceof ApiClientError)) return fallback;
  if (failure.status === 401) return 'انتهت الجلسة. أعد تسجيل الدخول.';
  if (failure.status === 403) return 'غير مصرح بهذا الإجراء في هذا السياق.';
  if (failure.status === 404) return 'المورد غير متاح.';
  if (failure.status === 409 || failure.code === 'CONFLICT') return 'تعارض في الحالة. حدّث الصفحة وراجع الحالة الحالية.';
  if (failure.code === 'VALIDATION_FAILED') return 'تحقق من الحقول المطلوبة.';
  if (failure.code === 'QUALIFICATION_STATE_INVALID' || failure.code === 'QUALIFICATION_MANAGE_FORBIDDEN') {
    return 'تعذر تطبيق قرار التأهيل في الحالة الحالية.';
  }
  if (failure.code === 'VERIFY_QUEUE_FORBIDDEN' || failure.code === 'VERIFY_ANALYST_FORBIDDEN') {
    return 'غير مصرح بعرض أو تعديل مسار التوثيق.';
  }
  if (failure.code === 'DOCUMENT_READ_FORBIDDEN') return 'غير مصرح بعرض مستندات الشركاء.';
  if (
    failure.code === 'COMMERCIAL_FORBIDDEN' ||
    failure.code === 'PURCHASE_FORBIDDEN' ||
    failure.code === 'MARGIN_FORBIDDEN' ||
    failure.code === 'ALLOCATION_FORBIDDEN' ||
    failure.code === 'RESALE_FORBIDDEN'
  ) {
    return 'غير مصرح بهذا الإجراء التجاري في هذا السياق.';
  }
  if (
    failure.code === 'ALLOCATION_EXCEEDS_AVAILABLE' ||
    failure.code === 'OVER_ALLOCATION' ||
    failure.code === 'ALLOCATION_INVALID'
  ) {
    return 'التوزيع يتجاوز الكمية المتاحة. صحّح الكميات ثم أعد المحاولة.';
  }
  if (failure.code === 'CROSS_SUPPLIER_MERGE_FORBIDDEN') {
    return 'لا يمكن دمج طلبات من مورّدين مختلفين في أمر شراء واحد.';
  }
  if (failure.code === 'SELECTION_NOT_READY' || failure.code === 'E_HANDOFF_NOT_READY') {
    return 'مرشّح الاختيار غير جاهز للمعالجة التجارية.';
  }
  return fallback;
}
