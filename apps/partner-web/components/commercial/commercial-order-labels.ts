/** Arabic presentation labels for Partner commercial orders — map backend status strings only. */

const STATUS_AR: Record<string, string> = {
  COMMERCIAL_PREP: 'قيد التجهيز التجاري',
  DRAFT: 'قيد التجهيز التجاري',
  PREPARING: 'قيد التجهيز التجاري',
  ORDER_APPROVED: 'تم اعتماد الطلب',
  APPROVED: 'تم اعتماد الطلب',
  PROCUREMENT_IN_PROGRESS: 'جاري الشراء',
  SOURCING: 'جاري الشراء',
  SUPPLY_CONFIRMED: 'تم تأكيد التوريد',
  CONFIRMED: 'تم تأكيد التوريد',
  READY_FOR_FULFILLMENT: 'جاهز للتنفيذ/التسليم',
  READY: 'جاهز للتنفيذ/التسليم',
  FULFILLMENT_READY: 'جاهز للتنفيذ/التسليم',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغى',
  CANCELED: 'ملغى',
};

export function commercialOrderStatusLabelAr(status: string | null | undefined): string {
  if (!status) return '—';
  return STATUS_AR[status] ?? STATUS_AR[status.toUpperCase()] ?? status;
}

export function formatMoneyAr(amount: number | null | undefined, currencyCode: string | null | undefined): string {
  if (amount == null || Number.isNaN(Number(amount))) return '—';
  const currency = currencyCode && currencyCode.length === 3 ? currencyCode : 'SAR';
  try {
    return new Intl.NumberFormat('ar-SA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}

export function formatDateAr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
}
