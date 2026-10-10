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
  return fallback;
}
