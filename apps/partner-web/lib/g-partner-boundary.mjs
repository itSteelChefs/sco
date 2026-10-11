/**
 * Capability G — Partner confidentiality boundary (internal-first intelligence).
 * No Partner G product surface. Shared helpers for nav/DTO/path/leakage guards.
 */

export const FORBIDDEN_G_NAV_HREFS = [
  '/portal/intelligence',
  '/portal/analytics',
  '/portal/supplier-performance',
  '/portal/price-history',
  '/portal/demand',
  '/portal/decision-support',
  '/intelligence',
  '/analytics',
];

export const FORBIDDEN_G_NAV_LABELS = [
  'Intelligence',
  'Analytics',
  'Supplier Performance',
  'Purchase Price History',
  'Demand Dashboard',
  'ذكاء المشتريات',
  'تحليلات الموردين',
  'تاريخ أسعار الشراء',
  'إشارات الطلب',
];

/** Candidate G HTTP paths — Partner must receive 401/403/404, never 200 with payload. */
export const G_ENDPOINT_CANDIDATES = [
  '/api/v1/partner/intelligence',
  '/api/v1/partner/intelligence/price-history',
  '/api/v1/partner/intelligence/quote-benchmark',
  '/api/v1/partner/intelligence/supplier-metrics',
  '/api/v1/partner/intelligence/category-metrics',
  '/api/v1/partner/intelligence/demand-signals',
  '/api/v1/partner/intelligence/decision-support',
  '/api/v1/partner/intelligence/evidence',
  '/api/v1/partner/intelligence/refresh',
  '/api/v1/partner/intelligence/backfill',
  '/api/v1/partner/procurement-intelligence',
  '/api/v1/partner/procurement-intelligence/price-history',
  '/api/v1/partner/procurement-intelligence/supplier-performance',
  '/api/v1/partner/procurement-intelligence/demand',
  '/api/v1/partner/price-history',
  '/api/v1/partner/supplier-performance',
  '/api/v1/partner/demand-signals',
  '/api/v1/internal/intelligence/price-history',
  '/api/v1/internal/procurement-intelligence/summary',
  '/api/v1/internal/procurement-intelligence/lineage',
  '/api/v1/internal/procurement-intelligence/decision-support',
];

export const FORBIDDEN_PARTNER_INTELLIGENCE_KEYS = [
  'purchaseCost',
  'unitPurchaseCost',
  'purchase_cost',
  'historicalPurchasePrice',
  'historical_purchase_price',
  'margin',
  'markup',
  'grossMargin',
  'lineGrossMargin',
  'supplierCanonicalName',
  'supplierCompanyId',
  'supplierLegalName',
  'supplierContact',
  'supplierEmail',
  'supplierPhone',
  'supplierScore',
  'supplierRanking',
  'partnerAggregateDemand',
  'crossPartnerDemand',
  'internalBenchmark',
  'benchmarkPurchaseCost',
  'evidenceInternal',
  'decisionSupportPayload',
  'priceHistory',
  'quoteBenchmark',
];

export function findForbiddenKeys(value, forbiddenKeys = FORBIDDEN_PARTNER_INTELLIGENCE_KEYS, path = '') {
  const hits = [];
  if (value == null) return hits;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      hits.push(...findForbiddenKeys(item, forbiddenKeys, `${path}[${index}]`));
    });
    return hits;
  }
  if (typeof value !== 'object') return hits;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (forbiddenKeys.includes(key)) hits.push(next);
    hits.push(...findForbiddenKeys(child, forbiddenKeys, next));
  }
  return hits;
}

export function stripForbiddenKeys(value, forbiddenKeys = FORBIDDEN_PARTNER_INTELLIGENCE_KEYS) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => stripForbiddenKeys(item, forbiddenKeys));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.includes(key)) continue;
    out[key] = stripForbiddenKeys(child, forbiddenKeys);
  }
  return out;
}

export function navContainsForbiddenG(navItems) {
  const hits = [];
  for (const item of navItems ?? []) {
    const href = String(item.href ?? '');
    const label = String(item.label ?? '');
    if (FORBIDDEN_G_NAV_HREFS.some((blocked) => href === blocked || href.startsWith(`${blocked}/`))) {
      hits.push(`href:${href}`);
    }
    if (FORBIDDEN_G_NAV_LABELS.some((blocked) => label.includes(blocked))) {
      hits.push(`label:${label}`);
    }
  }
  return hits;
}

/** Filter nav to enforce G isolation even if a future edit adds entries. */
export function filterPartnerNav(navItems) {
  return (navItems ?? []).filter((item) => navContainsForbiddenG([item]).length === 0);
}

export function contractsClientExposesPartnerG(apiSourceText) {
  const patterns = [
    /partnerIntelligence/,
    /partnerPriceHistory/,
    /partnerSupplierPerformance/,
    /partnerDemandSignals/,
    /partnerDecisionSupport/,
    /partnerProcurementIntelligence/,
    /\/api\/v1\/partner\/intelligence/,
    /\/api\/v1\/partner\/price-history/,
    /\/api\/v1\/partner\/supplier-performance/,
    /\/api\/v1\/partner\/demand/,
  ];
  return patterns.filter((re) => re.test(apiSourceText)).map((re) => String(re));
}

export function partnerDtoTypeHasForbiddenFields(apiSourceText) {
  const hits = [];
  const typeRe = /export type (Partner\w+)\s*=\s*\{([\s\S]*?)\n\};/g;
  let match;
  while ((match = typeRe.exec(apiSourceText))) {
    const name = match[1];
    const body = match[2];
    for (const key of FORBIDDEN_PARTNER_INTELLIGENCE_KEYS) {
      // Allow comments mentioning forbidden words; flag property-like occurrences.
      const prop = new RegExp(`(^|\\n)\\s*${key}\\??\\s*:`);
      if (prop.test(body)) hits.push(`${name}.${key}`);
    }
  }
  return hits;
}

export function isDeniedPartnerStatus(status) {
  return status === 401 || status === 403 || status === 404;
}

export function errorPayloadLooksSafe(payloadText) {
  if (!payloadText) return true;
  const lower = payloadText.toLowerCase();
  const bad = [
    'select ',
    ' from ',
    'purchasecost',
    'grossmargin',
    'suppliercanonical',
    'benchmarksample',
    'pg_catalog',
    'stack trace',
  ];
  return !bad.some((snippet) => lower.includes(snippet));
}
