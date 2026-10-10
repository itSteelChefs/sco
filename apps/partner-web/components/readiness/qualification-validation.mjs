export function validateQualificationForm(values) {
  const errors = {};
  if (!values.companyName?.trim()) errors.companyName = 'اسم الشركة مطلوب.';
  if (!values.responsiblePerson?.trim()) errors.responsiblePerson = 'اسم المسؤول مطلوب.';
  if (!values.contact?.trim()) errors.contact = 'البريد الإلكتروني مطلوب.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contact.trim())) errors.contact = 'صيغة البريد غير صحيحة.';
  if (!values.city?.trim()) errors.city = 'المدينة مطلوبة.';
  if (!values.sector) errors.sector = 'القطاع مطلوب.';
  if (!values.needType) errors.needType = 'نوع الاحتياج مطلوب.';
  if (!values.procurementSize) errors.procurementSize = 'حجم المشتريات مطلوب.';
  if (!values.procurementFrequency) errors.procurementFrequency = 'تكرار المشتريات مطلوب.';
  return errors;
}

export function mapQualificationPresentation(qualification) {
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

export function toDraftBody(values) {
  const body = {
    companyName: values.companyName.trim(),
    responsiblePerson: values.responsiblePerson.trim(),
    contact: values.contact.trim(),
    city: values.city.trim(),
    sector: values.sector,
    needType: values.needType,
    procurementSize: values.procurementSize,
    procurementFrequency: values.procurementFrequency,
  };
  if (values.commercialIdentifier?.trim()) body.commercialIdentifier = values.commercialIdentifier.trim();
  return body;
}
