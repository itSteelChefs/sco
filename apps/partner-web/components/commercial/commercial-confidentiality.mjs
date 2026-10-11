/** Pure helpers for E commercial + G intelligence confidentiality (no React). */

import {
  FORBIDDEN_PARTNER_INTELLIGENCE_KEYS,
  findForbiddenKeys,
  stripForbiddenKeys,
} from '../../lib/g-partner-boundary.mjs';

export const FORBIDDEN_COMMERCIAL_KEYS = [
  'purchaseCost',
  'unitPurchaseCost',
  'purchase_cost',
  'historicalPurchasePrice',
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
  'supplierPo',
  'supplierPO',
  'supplierPurchaseOrder',
  'supplierScore',
  'partnerAggregateDemand',
  'internalBenchmark',
  'evidenceInternal',
  'priceHistory',
  'quoteBenchmark',
];

export function findForbiddenCommercialKeys(value, path = '') {
  return findForbiddenKeys(value, FORBIDDEN_COMMERCIAL_KEYS, path);
}

export function stripForbiddenCommercialFields(value) {
  return stripForbiddenKeys(value, FORBIDDEN_COMMERCIAL_KEYS);
}

export function assertNoConfidentialRender(text) {
  const forbiddenSnippets = [
    'purchaseCost',
    'unitPurchaseCost',
    'historicalPurchasePrice',
    'margin',
    'markup',
    'grossMargin',
    'supplierCanonicalName',
    'supplierCompanyId',
    'supplierScore',
    'partnerAggregateDemand',
    'internalBenchmark',
    'Contact supplier',
    'Supplier checkout',
    'Supplier payment',
    'Buy directly',
    'تواصل مع المورد',
    'دفع للمورد',
  ];
  return forbiddenSnippets.filter((snippet) => text.includes(snippet));
}

export { FORBIDDEN_PARTNER_INTELLIGENCE_KEYS };
