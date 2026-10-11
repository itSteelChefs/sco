const STATUS_AR: Record<string, string> = {
  DRAFT: 'مسودة',
  SUBMITTED: 'مُرسَل',
  UNDER_REVIEW: 'قيد المراجعة الهندسية',
  UNDER_ENGINEERING_REVIEW: 'قيد المراجعة الهندسية',
  ACTION_REQUIRED: 'يتطلب إجراءً',
  APPROVED: 'معتمد',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغى',
  CANCELED: 'ملغى',
};

export function engineeringStatusLabelAr(status: string | null | undefined): string {
  if (!status) return '—';
  return STATUS_AR[status] ?? STATUS_AR[status.toUpperCase()] ?? status;
}

export function engineeringRequestTypeLabelAr(type: string | null | undefined): string {
  if (!type) return '—';
  switch (type) {
    case 'BOQ_STUDY':
    case 'ENGINEERING_BOQ':
      return 'دراسة كميات';
    case 'DESIGN_REVIEW':
      return 'مراجعة تصميم';
    case 'GENERAL':
      return 'طلب هندسي عام';
    default:
      return type;
  }
}

export function formatDateAr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
}

export const ENGINEERING_SECTOR_OPTIONS = [
  { value: 'HVAC_REFRIGERATION', label: 'التكييف والتبريد' },
  { value: 'ELECTRICAL', label: 'الكهرباء' },
  { value: 'PLUMBING', label: 'السباكة' },
  { value: 'MULTI', label: 'متعدد المجالات' },
] as const;

export const ENGINEERING_REQUEST_TYPE_OPTIONS = [
  { value: 'BOQ_STUDY', label: 'دراسة كميات' },
  { value: 'DESIGN_REVIEW', label: 'مراجعة تصميم' },
  { value: 'GENERAL', label: 'طلب هندسي عام' },
] as const;
