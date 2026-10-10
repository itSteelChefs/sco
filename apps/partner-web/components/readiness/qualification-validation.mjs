export function validateQualificationForm(values) {
  const errors = {};
  if (!values.companyName?.trim()) errors.companyName = 'اسم الشركة مطلوب.';
  if (!values.responsiblePerson?.trim()) errors.responsiblePerson = 'اسم المسؤول مطلوب.';
  if (!values.contactEmail?.trim() && !values.contactMobile?.trim()) {
    errors.contact = 'يلزم بريد إلكتروني أو رقم جوال.';
  } else if (values.contactEmail?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contactEmail.trim())) {
    errors.contactEmail = 'صيغة البريد غير صحيحة.';
  }
  if (!values.city?.trim()) errors.city = 'المدينة مطلوبة.';
  if (!values.sector) errors.sector = 'القطاع مطلوب.';
  if (!values.needType) errors.needType = 'نوع احتياج مطلوب.';
  if (!values.procurementSize) errors.procurementSize = 'حجم/تكرار المشتريات مطلوب.';
  return errors;
}

export function mapQualificationPresentation(qualification) {
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
