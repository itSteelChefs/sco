import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractsRoot = join(root, '../../packages/contracts/src');

async function read(rel) {
  return readFile(join(root, rel), 'utf8');
}

async function readContracts() {
  return readFile(join(contractsRoot, 'api.ts'), 'utf8');
}

test('G-I01 overview loads', async () => {
  const page = await read('app/intelligence/page.tsx');
  const overview = await read('components/ops/intelligence-overview.tsx');
  assert.match(page, /IntelligenceOverview/);
  assert.match(overview, /internalGDemandSignals/);
  assert.match(overview, /ماذا يتغيّر الآن/);
});

test('G-I02 no fake zeros', async () => {
  const overview = await read('components/ops/intelligence-overview.tsx');
  assert.match(overview, /بلا أصفار ملفّقة/);
  assert.match(overview, /openCount == null \? '—' : openCount/);
  assert.doesNotMatch(overview, /KPI|vanity|revenue dashboard/i);
});

test('G-I03 freshness visible', async () => {
  const shared = await read('components/ops/intelligence-shared.tsx');
  const overview = await read('components/ops/intelligence-overview.tsx');
  assert.match(shared, /آخر تحديث/);
  assert.match(shared, /أحدث مصدر/);
  assert.match(overview, /FreshnessBlock/);
});

test('G-I04 insufficient evidence state', async () => {
  const bench = await read('components/ops/intelligence-benchmark.tsx');
  assert.match(bench, /INSUFFICIENT_EVIDENCE/);
  assert.match(bench, /بيانات غير كافية|لا توجد بيانات شراء مؤكدة كافية/);
});

test('G-I05 quote/purchase separation', async () => {
  const prices = await read('components/ops/intelligence-prices.tsx');
  const shared = await read('components/ops/intelligence-shared.tsx');
  assert.match(prices, /أسعار العروض/);
  assert.match(prices, /الأسعار المختارة/);
  assert.match(prices, /أسعار الشراء المؤكدة/);
  assert.match(shared, /QUOTE_OBSERVED/);
  assert.match(shared, /QUOTE_SELECTED/);
  assert.match(shared, /SUPPLIER_CONFIRMED/);
  assert.match(prices, /سلاسل.*منفصلة|seriesKind/);
});

test('G-I06/G-I07/G-I08 latest min max mean median sample', async () => {
  const shared = await read('components/ops/intelligence-shared.tsx');
  assert.match(shared, /آخر سعر/);
  assert.match(shared, /الحد الأدنى/);
  assert.match(shared, /الحد الأعلى/);
  assert.match(shared, /المتوسط/);
  assert.match(shared, /الوسيط/);
  assert.match(shared, /عدد العينات/);
});

test('G-I09/G-I10 currency and unit context', async () => {
  const prices = await read('components/ops/intelligence-prices.tsx');
  assert.match(prices, /currencyCode/);
  assert.match(prices, /unitId/);
  assert.match(prices, /العملة/);
  assert.match(prices, /الوحدة/);
});

test('G-I11 evidence drilldown', async () => {
  const evidence = await read('components/ops/intelligence-evidence.tsx');
  const prices = await read('components/ops/intelligence-prices.tsx');
  assert.match(evidence, /internalGEvidence/);
  assert.match(evidence, /offset/);
  assert.match(prices, /\/intelligence\/evidence/);
});

test('G-I12/G-I13/G-I14 benchmark range signals', async () => {
  const bench = await read('components/ops/intelligence-benchmark.tsx');
  const shared = await read('components/ops/intelligence-shared.tsx');
  assert.match(shared, /أعلى من النطاق التاريخي/);
  assert.match(shared, /ضمن النطاق التاريخي/);
  assert.match(shared, /أقل من النطاق التاريخي/);
  assert.match(bench, /ABOVE_HISTORICAL_RANGE/);
  assert.match(bench, /WITHIN_HISTORICAL_RANGE/);
  assert.match(bench, /BELOW_HISTORICAL_RANGE/);
});

test('G-I15/G-I16 insufficient + neutral language', async () => {
  const bench = await read('components/ops/intelligence-benchmark.tsx');
  assert.match(bench, /بيانات غير كافية/);
  assert.doesNotMatch(bench, /اشترِ|ارفض|اختر المورد|BUY_NOW|CHOOSE_SUPPLIER/);
});

test('G-I17 no automatic buy action', async () => {
  const bench = await read('components/ops/intelligence-benchmark.tsx');
  const ds = await read('components/ops/intelligence-decision-support.tsx');
  const all = bench + ds;
  assert.doesNotMatch(all, /اختيار أفضل مورد تلقائي|شراء الآن بناءً على الذكاء|auto.?buy|executePurchase/i);
  assert.match(ds, /actionExecution/);
  assert.match(ds, /لا تنفيذ شراء تلقائي/);
});

test('G-I18 supplier list', async () => {
  const suppliers = await read('components/ops/intelligence-suppliers.tsx');
  assert.match(suppliers, /IntelligenceSuppliers/);
  assert.match(suppliers, /\/intelligence\/suppliers\//);
});

test('G-I19/G-I20/G-I21 confirmation latency revisions cancellations', async () => {
  const suppliers = await read('components/ops/intelligence-suppliers.tsx');
  assert.match(suppliers, /confirmationLatencySecondsMean/);
  assert.match(suppliers, /confirmationRevisionRate/);
  assert.match(suppliers, /cancellationRate/);
});

test('G-I22 no unsupported delivery score', async () => {
  const suppliers = await read('components/ops/intelligence-suppliers.tsx');
  assert.match(suppliers, /deliveryMetrics == null/);
  assert.match(suppliers, /غير مدعومة في G V1/);
  assert.doesNotMatch(suppliers, /five.?star|⭐|deliveryScore|qualityStars/i);
});

test('G-I23/G-I24 category activity and supplier count', async () => {
  const cats = await read('components/ops/intelligence-categories.tsx');
  assert.match(cats, /internalGCategoryIntelligence/);
  assert.match(cats, /quoteActivity/);
  assert.match(cats, /supplierCount/);
});

test('G-I25/G-I26 30-day and 90-day demand', async () => {
  const demand = await read('components/ops/intelligence-demand.tsx');
  const cats = await read('components/ops/intelligence-categories.tsx');
  assert.match(demand, /windowDays/);
  assert.match(demand, /نشاط آخر 30 يوم/);
  assert.match(demand, /نشاط آخر 90 يوم/);
  assert.match(cats, /demandActivity30d/);
  assert.match(cats, /demandActivity90d/);
});

test('G-I27 mixed-unit safety', async () => {
  const demand = await read('components/ops/intelligence-demand.tsx');
  assert.match(demand, /quantityBuckets/);
  assert.match(demand, /وحدات مختلطة/);
  assert.match(demand, /لا جمع كمي عبر وحدات غير متوافقة/);
});

test('G-I28/G-I29/G-I30 unauthorized cost evidence permissions', async () => {
  const overview = await read('components/ops/intelligence-overview.tsx');
  const suppliers = await read('components/ops/intelligence-suppliers.tsx');
  const evidence = await read('components/ops/intelligence-evidence.tsx');
  const safe = await read('components/ops/safe-error.ts');
  assert.match(overview, /غير مصرح بعرض ذكاء المشتريات/);
  assert.match(suppliers, /إذن التكلفة|commercialPurchaseValue == null/);
  assert.match(evidence, /غير مصرح بتفصيل الأدلة/);
  assert.match(safe, /G_INTELLIGENCE_READ_FORBIDDEN/);
});

test('G-I31 no Partner route', async () => {
  const contracts = await readContracts();
  assert.match(contracts, /\/api\/v1\/internal\/g-intelligence/);
  assert.doesNotMatch(contracts, /\/api\/v1\/partner\/g-intelligence/);
  const chrome = await read('components/ops/ops-chrome.tsx');
  assert.match(chrome, /ذكاء المشتريات/);
  assert.match(chrome, /\/intelligence/);
});

test('contracts expose Cursor3 G routes; no chart/BI OSS', async () => {
  const contracts = await readContracts();
  const pkg = await read('package.json');
  assert.match(contracts, /internalGPriceHistory/);
  assert.match(contracts, /internalGQuoteBenchmark/);
  assert.match(contracts, /internalGSupplierPerformance/);
  assert.match(contracts, /internalGCategoryIntelligence/);
  assert.match(contracts, /internalGDemandSignals/);
  assert.match(contracts, /internalGDecisionSupport/);
  assert.match(contracts, /internalGEvidence/);
  assert.doesNotMatch(pkg, /recharts|chart\.js|d3|univer|exceljs|ag-grid|highcharts/i);
});

test('Arabic RTL intelligence nav + decision support embed', async () => {
  const chrome = await read('components/ops/ops-chrome.tsx');
  const purchase = await read('components/ops/purchase-workspace.tsx');
  const layout = await read('app/layout.tsx');
  assert.match(chrome, /ذكاء المشتريات/);
  assert.match(purchase, /IntelligenceDecisionSupportPanel/);
  assert.match(layout, /dir=["']rtl["']|lang=["']ar["']/);
});
