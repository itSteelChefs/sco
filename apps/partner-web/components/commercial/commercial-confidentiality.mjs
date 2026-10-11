/** Pure helpers for E commercial confidentiality tests (no React). */

export const FORBIDDEN_COMMERCIAL_KEYS = [
  'purchaseCost',
  'unitPurchaseCost',
  'purchase_cost',
  'margin',
  'markup',
  'supplierCanonicalName',
  'supplierCompanyId',
  'supplierLegalName',
  'supplierContact',
  'supplierEmail',
  'supplierPhone',
  'supplierPo',
  'supplierPO',
  'supplierPurchaseOrder',
];

/**
 * Deep-scan any value for forbidden commercial keys.
 * Returns list of offending key paths.
 */
export function findForbiddenCommercialKeys(value, path = '') {
  const hits = [];
  if (value == null) return hits;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      hits.push(...findForbiddenCommercialKeys(item, `${path}[${index}]`));
    });
    return hits;
  }
  if (typeof value !== 'object') return hits;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (FORBIDDEN_COMMERCIAL_KEYS.includes(key)) hits.push(next);
    hits.push(...findForbiddenCommercialKeys(child, next));
  }
  return hits;
}

/**
 * Strip forbidden keys from an object graph before Partner render.
 * Does not invent fields — only removes confidential ones if present.
 */
export function stripForbiddenCommercialFields(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => stripForbiddenCommercialFields(item));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_COMMERCIAL_KEYS.includes(key)) continue;
    out[key] = stripForbiddenCommercialFields(child);
  }
  return out;
}

/** Assert rendered HTML/text never contains confidential markers. */
export function assertNoConfidentialRender(text) {
  const forbiddenSnippets = [
    'purchaseCost',
    'unitPurchaseCost',
    'margin',
    'markup',
    'supplierCanonicalName',
    'supplierCompanyId',
    'Contact supplier',
    'Supplier checkout',
    'Supplier payment',
    'Buy directly',
    'تواصل مع المورد',
    'دفع للمورد',
  ];
  const hits = forbiddenSnippets.filter((snippet) => text.includes(snippet));
  return hits;
}
