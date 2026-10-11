import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FORBIDDEN_G_NAV_HREFS,
  FORBIDDEN_PARTNER_INTELLIGENCE_KEYS,
  contractsClientExposesPartnerG,
  findForbiddenKeys,
  filterPartnerNav,
  navContainsForbiddenG,
  partnerDtoTypeHasForbiddenFields,
  stripForbiddenKeys,
  isDeniedPartnerStatus,
  errorPayloadLooksSafe,
} from '../lib/g-partner-boundary.mjs';
import {
  findForbiddenCommercialKeys,
  stripForbiddenCommercialFields,
} from '../components/commercial/commercial-confidentiality.mjs';

async function read(relative) {
  return readFile(new URL(relative, import.meta.url), 'utf8');
}

const here = path.dirname(fileURLToPath(import.meta.url));

test('G-PARTNER-01 no G navigation in Partner chrome/routes', async () => {
  const chrome = await read('../components/portal/portal-chrome.tsx');
  assert.match(chrome, /filterPartnerNav/);
  assert.doesNotMatch(chrome, /\/portal\/intelligence|\/portal\/analytics|Price History|Demand Dashboard|ذكاء المشتريات/);
  const portalDir = path.join(here, '../app/portal');
  const entries = await readdir(portalDir);
  for (const blocked of ['intelligence', 'analytics', 'price-history', 'demand', 'supplier-performance']) {
    assert.equal(entries.includes(blocked), false, `unexpected portal route ${blocked}`);
  }
  const hits = navContainsForbiddenG([
    { href: '/portal/readiness', label: 'الجاهزية' },
    { href: '/portal/orders', label: 'مشترياتي' },
  ]);
  assert.deepEqual(hits, []);
  assert.equal(filterPartnerNav([{ href: '/portal/intelligence', label: 'Intelligence' }]).length, 0);
});

test('G-PARTNER-02..06 contracts client has no Partner intelligence methods', async () => {
  const contracts = await read('../../../packages/contracts/src/api.ts');
  const exposed = contractsClientExposesPartnerG(contracts);
  assert.deepEqual(exposed, []);
  assert.doesNotMatch(contracts, /\/api\/v1\/partner\/intelligence/);
  assert.doesNotMatch(contracts, /partnerPriceHistory|partnerSupplierPerformance|partnerDemandSignals/);
});

test('G-PARTNER-07 purchase cost absent from Partner DTOs + strip', async () => {
  const contracts = await read('../../../packages/contracts/src/api.ts');
  const dtoHits = partnerDtoTypeHasForbiddenFields(contracts).filter((h) => h.endsWith('.purchaseCost') || h.includes('historicalPurchase'));
  assert.deepEqual(dtoHits, []);
  const cleaned = stripForbiddenCommercialFields({
    saleTotal: 10,
    purchaseCost: 4,
    historicalPurchasePrice: 3,
  });
  assert.equal('purchaseCost' in cleaned, false);
  assert.equal('historicalPurchasePrice' in cleaned, false);
});

test('G-PARTNER-08 margin absent from Partner DTOs + strip', async () => {
  const contracts = await read('../../../packages/contracts/src/api.ts');
  const dtoHits = partnerDtoTypeHasForbiddenFields(contracts).filter((h) => /margin|grossMargin|markup/i.test(h));
  assert.deepEqual(dtoHits, []);
  const cleaned = stripForbiddenKeys({ saleTotal: 10, margin: 1, grossMargin: 2, lineGrossMargin: 3 });
  assert.equal('margin' in cleaned, false);
  assert.equal('grossMargin' in cleaned, false);
});

test('G-PARTNER-09 canonical supplier absent from Partner DTOs', async () => {
  const contracts = await read('../../../packages/contracts/src/api.ts');
  const dtoHits = partnerDtoTypeHasForbiddenFields(contracts).filter((h) =>
    /supplierCompanyId|supplierCanonicalName|supplierScore|supplierContact/.test(h),
  );
  assert.deepEqual(dtoHits, []);
});

test('G-PARTNER-10 D Partner comparison serializer stays alias-safe in source', async () => {
  const service = await read('../../../apps/api/src/modules/procurement-core/partner-procurement.service.ts');
  assert.match(service, /partner_procurement_comparison_get/);
  // Partner comparison mapping must not inject supplierCompanyId into response assembly.
  const comparisonBlock = service.slice(service.indexOf('comparison('), service.indexOf('private toRequirementDto'));
  assert.doesNotMatch(comparisonBlock, /supplierCompanyId\s*:/);
  assert.doesNotMatch(comparisonBlock, /purchaseCost|grossMargin|historicalPurchasePrice/);
});

test('G-PARTNER-11 E Partner commercial surfaces remain sale-price only', async () => {
  const detail = await read('../components/commercial/commercial-order-detail.tsx');
  const types = await read('../components/commercial/commercial-order-types.ts');
  assert.match(detail, /unitSalePrice|saleUnitPrice|سعر البيع/);
  assert.doesNotMatch(detail, /purchaseCost|grossMargin|historicalPurchasePrice|supplierScore/);
  // Presentation model fields (not the forbidden-key catalog) must stay sale-side.
  assert.match(types, /unitSalePrice/);
  assert.doesNotMatch(types, /unitSalePrice[\s\S]*purchaseCost\s*:/);
  assert.doesNotMatch(types, /^\s*grossMargin\s*:/m);
  const hostile = {
    saleTotal: 100,
    purchaseCost: 40,
    margin: 60,
    supplierCanonicalName: 'X',
    supplierScore: 99,
    priceHistory: [{ purchaseCost: 1 }],
  };
  assert.ok(findForbiddenCommercialKeys(hostile).length >= 3);
  assert.deepEqual(findForbiddenKeys(stripForbiddenCommercialFields(hostile)), []);
});

test('G-PARTNER-12 F Partner engineering result omits intelligence fields', async () => {
  const boq = await read('../components/engineering/engineering-boq-result.tsx');
  const detail = await read('../components/engineering/engineering-request-detail.tsx');
  assert.doesNotMatch(boq, /purchaseCost|supplierScore|priceHistory|internalBenchmark/);
  assert.doesNotMatch(detail, /purchaseCost|grossMargin|partnerAggregateDemand/);
  assert.match(detail, /لا تُعرض ملاحظات هندسية داخلية/);
});

test('G-PARTNER-13 cross-Partner intelligence keys blocked', () => {
  const payload = {
    partnerAggregateDemand: { companyB: 12 },
    crossPartnerDemand: true,
    demandSignals: [{ companyId: 'other' }],
  };
  // demandSignals is not in key list unless we add it — ensure aggregate keys stripped
  const cleaned = stripForbiddenKeys(payload);
  assert.equal('partnerAggregateDemand' in cleaned, false);
  assert.equal('crossPartnerDemand' in cleaned, false);
  assert.ok(FORBIDDEN_PARTNER_INTELLIGENCE_KEYS.includes('partnerAggregateDemand'));
});

test('G-PARTNER-14 mobile/RTL unaffected (layout + commercial/engineering media)', async () => {
  const layout = await read('../app/layout.tsx');
  const commercialCss = await read('../components/commercial/commercial.module.css');
  const engCss = await read('../components/engineering/engineering.module.css');
  assert.match(layout, /dir="rtl"/);
  assert.match(layout, /lang="ar"/);
  assert.match(commercialCss, /@media \(max-width: 640px\)/);
  assert.match(engCss, /@media \(max-width: 640px\)/);
});

test('G-PARTNER-15 accessibility regression — portal chrome remains labeled', async () => {
  const chrome = await read('../components/portal/portal-chrome.tsx');
  assert.match(chrome, /aria-label="تنقل البوابة"|aria-label=\{?/);
  assert.match(chrome, /aria-current/);
});

test('G forbidden nav href catalog covers product rule surface', () => {
  for (const href of [
    '/portal/intelligence',
    '/portal/analytics',
    '/portal/price-history',
    '/portal/demand',
  ]) {
    assert.ok(FORBIDDEN_G_NAV_HREFS.includes(href));
  }
});

test('denied status helper accepts 401/403/404 only', () => {
  assert.equal(isDeniedPartnerStatus(200), false);
  assert.equal(isDeniedPartnerStatus(403), true);
  assert.equal(isDeniedPartnerStatus(404), true);
  assert.equal(errorPayloadLooksSafe('{"error":{"code":"FORBIDDEN"}}'), true);
  assert.equal(errorPayloadLooksSafe('SELECT * FROM purchase_cost'), false);
});
