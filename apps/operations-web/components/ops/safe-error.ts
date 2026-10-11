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
  if (
    failure.code === 'ENGINEERING_REVIEW_FORBIDDEN' ||
    failure.code === 'ENGINEERING_ASSIGN_FORBIDDEN' ||
    failure.code === 'ENGINEERING_BOQ_EDIT_FORBIDDEN' ||
    failure.code === 'ENGINEERING_BOQ_APPROVE_FORBIDDEN'
  ) {
    return 'غير مصرح بهذا الإجراء الهندسي في هذا السياق.';
  }
  if (failure.code === 'ENGINEERING_QUANTITY_INVALID') {
    return 'الكمية غير صالحة — يجب أن تكون أكبر من صفر.';
  }
  if (failure.code === 'ENGINEERING_BOQ_NOT_EDITABLE' || failure.code === 'ENGINEERING_BOQ_NOT_APPROVABLE') {
    return 'إصدار جداول الكميات غير قابل للتعديل أو الاعتماد في حالته الحالية.';
  }
  if (failure.code === 'ENGINEERING_STATE_INVALID' || failure.code === 'ENGINEERING_ASSIGN_STATE_INVALID') {
    return 'انتقال الحالة غير مسموح من الحالة الحالية.';
  }
  if (failure.code === 'ENGINEERING_BOQ_DRAFT_EXISTS') {
    return 'توجد مسودة جداول كميات بالفعل لهذا الطلب.';
  }
  if (failure.code === 'ENGINEERING_BOQ_EMPTY') {
    return 'لا يمكن اعتماد جداول كميات بلا بنود.';
  }
  if (
    failure.code === 'G_INTELLIGENCE_READ_FORBIDDEN' ||
    failure.code === 'G_INTELLIGENCE_REFRESH_FORBIDDEN' ||
    /G_INTELLIGENCE_.*FORBIDDEN/.test(failure.message || '')
  ) {
    return 'غير مصرح بعرض أو تحديث ذكاء المشتريات.';
  }
  if (failure.code === 'G_QUOTE_LINE_NOT_FOUND') {
    return 'سطر العرض غير موجود.';
  }
  if (failure.code === 'G_SUPPLIER_REQUIRED' || failure.code === 'G_SECTOR_REQUIRED') {
    return 'المعرّف المطلوب ناقص (مورّد أو فئة).';
  }
  if (failure.code === 'G_INTELLIGENCE_BACKFILL_IN_PROGRESS') {
    return 'تحديث الأدلة جارٍ — أعد المحاولة بعد لحظات.';
  }
  return fallback;
}
