const STORAGE_KEY = 'sco_partner_company_id';

export function readStoredCompanyId(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeStoredCompanyId(companyId: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (companyId) window.sessionStorage.setItem(STORAGE_KEY, companyId);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}
