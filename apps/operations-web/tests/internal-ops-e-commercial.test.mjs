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

test('E-I01 purchase queue lists D requirements only (no unsigned selections list)', async () => {
  const queue = await read('components/ops/purchase-queue.tsx');
  assert.match(queue, /internalProcurementRequirements/);
  assert.match(queue, /SELECTION_READY/);
  assert.match(queue, /فتح نية شراء|فتح تحضير شراء/);
  assert.doesNotMatch(queue, /internalSelectionCandidates|internalCommercialQueues|\/commercial\/queues|\/commercial\/selections/);
});

test('E-I02 create/open purchase from selection', async () => {
  const queue = await read('components/ops/purchase-queue.tsx');
  const page = await read('app/commercial/purchases/[id]/page.tsx');
  const contracts = await readContracts();
  assert.match(queue, /internalPurchaseCreateFromSelection/);
  assert.match(queue, /selectionCandidateId/);
  assert.match(queue, /idempotencyKey/);
  assert.match(contracts, /purchases\/from-selection/);
  assert.match(page, /PurchaseWorkspace/);
});

test('E-I03 purchase cost visible internal', async () => {
  const workspace = await read('components/ops/purchase-workspace.tsx');
  const supplier = await read('components/ops/supplier-order-workspace.tsx');
  assert.match(workspace, /purchaseTotal/);
  assert.match(workspace, /purchaseUnitPrice/);
  assert.match(workspace, /تكلفة الشراء/);
  assert.match(supplier, /purchaseTotal/);
  assert.doesNotMatch(workspace, /Partner sale as cost/);
});

test('E-I04 approval action is explicit confirmation', async () => {
  const workspace = await read('components/ops/purchase-workspace.tsx');
  assert.match(workspace, /internalPurchaseApprove/);
  assert.match(workspace, /approveAck/);
  assert.match(workspace, /الاعتماد ليس نقرة واحدة/);
});

test('E-I05 issue action on supplier order', async () => {
  const supplier = await read('components/ops/supplier-order-workspace.tsx');
  const contracts = await readContracts();
  assert.match(supplier, /internalSupplierOrderIssue/);
  assert.match(supplier, /issueAck/);
  assert.match(supplier, /إصدار أمر الشراء/);
  assert.match(contracts, /supplier-orders\/\$\{.*\}\/issue/);
});

test('E-I06 supplier confirmation', async () => {
  const supplier = await read('components/ops/supplier-order-workspace.tsx');
  assert.match(supplier, /internalSupplierOrderConfirm/);
  assert.match(supplier, /confirmationReference/);
  assert.match(supplier, /expectedDeliveryDate/);
  assert.match(supplier, /lineConfirmations/);
});

test('E-I07 consolidation workspace', async () => {
  const panel = await read('components/ops/consolidation-panel.tsx');
  const intent = await read('components/ops/purchase-workspace.tsx');
  const supplier = await read('components/ops/supplier-order-workspace.tsx');
  assert.match(intent, /internalSupplierOrderCreate/);
  assert.match(intent, /intentIds/);
  assert.match(intent, /مورّدين/);
  assert.match(supplier, /ConsolidationPanel/);
  assert.match(panel, /requestedQuantity/);
  assert.match(panel, /allocatedQuantity/);
  assert.match(panel, /remainingQuantity/);
  assert.match(panel, /crossSupplier|مورّدين مختلفين/);
});

test('E-I08 allocation UI binds partner to line', async () => {
  const panel = await read('components/ops/allocation-panel.tsx');
  const supplier = await read('components/ops/supplier-order-workspace.tsx');
  const contracts = await readContracts();
  assert.match(supplier, /internalAllocationCreate/);
  assert.match(contracts, /orderLineId/);
  assert.match(panel, /purchasedQuantity/);
  assert.match(panel, /remainingQuantity/);
  assert.match(panel, /resaleLineStatus/);
  assert.match(panel, /partnerCompanyId: selectedLine\.partnerCompanyId/);
  assert.match(panel, /لا يُستبدل من الواجهة/);
  assert.doesNotMatch(panel, /setPartnerCompanyId/);
});

test('E-I09 over-allocation client guard', async () => {
  const panel = await read('components/ops/allocation-panel.tsx');
  assert.match(panel, /remainingQuantity/);
  assert.match(panel, /لا يمكن تجاوز الكمية المتبقية/);
  assert.match(panel, /الخادم هو المرجع/);
});

test('E-I10 resale creation', async () => {
  const resale = await read('components/ops/resale-ops.tsx');
  const contracts = await readContracts();
  assert.match(resale, /internalResaleCreate/);
  assert.match(resale, /saleUnitPrice/);
  assert.match(resale, /paymentTerms:\s*'CASH'/);
  assert.match(contracts, /saleUnitPrice/);
});

test('E-I11 separate Partner orders', async () => {
  const resale = await read('components/ops/resale-ops.tsx');
  const supplier = await read('components/ops/supplier-order-workspace.tsx');
  assert.match(resale, /شريك واحد/);
  assert.match(resale, /لا يُدمج شركاء/);
  assert.match(supplier, /partnerCompanyId/);
  assert.match(supplier, /أمر لكل شريك/);
});

test('E-I12 margin permission honored', async () => {
  const workspace = await read('components/ops/purchase-workspace.tsx');
  const resale = await read('components/ops/resale-ops.tsx');
  assert.match(workspace, /canViewMargin/);
  assert.match(workspace, /يُحترم إذن الهامش/);
  assert.match(resale, /canViewMargin/);
  assert.match(resale, /غير متاح لدورك/);
});

test('E-I13 fulfillment readiness from backend field', async () => {
  const ready = await read('components/ops/fulfillment-readiness.tsx');
  const resale = await read('components/ops/resale-ops.tsx');
  assert.match(resale, /fulfillmentReady/);
  assert.match(ready, /fulfillmentReady/);
  assert.match(ready, /دون قواعد منافسة/);
});

test('E-I14 cancellation/revision safe path without delete', async () => {
  const supplier = await read('components/ops/supplier-order-workspace.tsx');
  assert.match(supplier, /لا يوجد زر حذف/);
  assert.match(supplier, /الإلغاء\/المراجعة/);
  assert.doesNotMatch(supplier, /deletePurchase|onDelete|internalPurchaseCancel/);
});

test('ops home E queues use signed D count only — no unsigned commercial queue API', async () => {
  const home = await read('components/ops/ops-home.tsx');
  assert.match(home, /internalProcurementRequirements/);
  assert.match(home, /selectionsReady/);
  assert.match(home, /اختيارات جاهزة للمعالجة التجارية/);
  assert.match(home, /نوايا\/أوامر شراء بانتظار الاعتماد/);
  assert.match(home, /بلا عدّاد غير موقّع/);
  assert.doesNotMatch(home, /internalCommercialQueues|\/commercial\/queues|\/commercial\/selections/);
  assert.doesNotMatch(home, /KPI|revenue chart|vanity/i);
});

test('P1 closure: supplier order does not invent fulfillmentReady=false', async () => {
  const supplier = await read('components/ops/supplier-order-workspace.tsx');
  assert.doesNotMatch(supplier, /FulfillmentReadinessPanel/);
  assert.doesNotMatch(supplier, /ready:\s*false/);
  assert.match(supplier, /fulfillmentReady/);
});

test('P1 closure: contracts omit unsigned commercial list routes', async () => {
  const contracts = await readContracts();
  assert.doesNotMatch(contracts, /\/api\/v1\/internal\/commercial\/queues/);
  assert.doesNotMatch(contracts, /\/api\/v1\/internal\/commercial\/selections/);
  assert.match(contracts, /\/api\/v1\/internal\/commercial\/purchases\/from-selection/);
  assert.match(contracts, /\/api\/v1\/internal\/procurement\/requirements/);
});

test('Arabic-first RTL and commercial nav', async () => {
  const layout = await read('app/layout.tsx');
  const chrome = await read('components/ops/ops-chrome.tsx');
  assert.match(layout, /lang="ar"/);
  assert.match(layout, /dir="rtl"/);
  assert.match(chrome, /\/commercial/);
  assert.match(chrome, /التجاري/);
});

test('contracts expose Cursor3 commercial routes; no new OSS', async () => {
  const contracts = await readContracts();
  const pkg = await read('package.json');
  assert.match(contracts, /\/api\/v1\/internal\/commercial\/purchases\/from-selection/);
  assert.match(contracts, /\/api\/v1\/internal\/commercial\/supplier-orders/);
  assert.match(contracts, /\/api\/v1\/internal\/commercial\/allocations/);
  assert.match(contracts, /\/api\/v1\/internal\/commercial\/resale-orders/);
  assert.match(contracts, /internalSupplierOrderIssue/);
  assert.match(contracts, /internalResaleConfirm/);
  assert.doesNotMatch(pkg, /ag-grid|tanstack\/react-table|shadcn|recharts/i);
});

test('sale price columns separated from purchase cost', async () => {
  const resale = await read('components/ops/resale-ops.tsx');
  assert.match(resale, /تكلفة الشراء/);
  assert.match(resale, /سعر البيع للشريك/);
  assert.match(resale, /أعمدة التكلفة وسعر البيع منفصلة/);
});
