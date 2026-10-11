import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertNoConfidentialRender,
  findForbiddenCommercialKeys,
  stripForbiddenCommercialFields,
} from '../components/commercial/commercial-confidentiality.mjs';

async function read(relative) {
  return readFile(new URL(relative, import.meta.url), 'utf8');
}

const hostileOrder = {
  orderId: 'ord-1',
  reference: 'SCO-CO-1',
  createdAt: '2026-10-11T10:00:00.000Z',
  status: 'ORDER_APPROVED',
  currencyCode: 'SAR',
  commercialTotal: 1200,
  itemCount: 1,
  purchaseCost: 700,
  margin: 500,
  supplierCanonicalName: 'Secret Supplier LLC',
  supplierContact: 'vendor@evil.test',
  lines: [
    {
      lineNumber: 1,
      specification: 'AHU-100',
      quantity: 2,
      unitSalePrice: 600,
      lineTotal: 1200,
      unitPurchaseCost: 350,
      markup: 0.7,
    },
  ],
};

test('E-PUI01 own order list surface exists with company-scoped waiting/live wiring', async () => {
  const page = await read('../app/portal/orders/page.tsx');
  const list = await read('../components/commercial/commercial-order-list.tsx');
  const workspace = await read('../components/commercial/commercial-orders-workspace.tsx');
  const api = await read('../lib/commercial-orders-api.ts');
  assert.match(page, /CommercialOrdersWorkspace/);
  assert.match(list, /commercial-order-list/);
  assert.match(list, /مشترياتي من سكو/);
  assert.match(workspace, /commercialOrdersApi[\s\S]*\.list\(/);
  assert.match(api, /partnerCommercialOrders/);
  assert.match(workspace, /selected/);
});

test('E-PUI02 order detail surface exists', async () => {
  const page = await read('../app/portal/orders/[orderId]/page.tsx');
  const detail = await read('../components/commercial/commercial-order-detail.tsx');
  assert.match(page, /CommercialOrderDetailWorkspace/);
  assert.match(detail, /commercial-order-detail/);
  assert.match(detail, /unit-sale-price|unitSalePrice/);
  assert.match(detail, /commercial-total/);
});

test('E-PUI03 sale price visible in detail markup', async () => {
  const detail = await read('../components/commercial/commercial-order-detail.tsx');
  assert.match(detail, /سعر البيع للوحدة/);
  assert.match(detail, /unitSalePrice/);
  assert.doesNotMatch(detail, /unitPurchaseCost|purchaseCost/);
});

test('E-PUI04 purchase cost absent from strip + render guards', () => {
  const cleaned = stripForbiddenCommercialFields(hostileOrder);
  assert.equal('purchaseCost' in cleaned, false);
  assert.equal('unitPurchaseCost' in (cleaned.lines?.[0] ?? {}), false);
  assert.deepEqual(findForbiddenCommercialKeys(cleaned), []);
  const hits = assertNoConfidentialRender(JSON.stringify(cleaned));
  assert.deepEqual(hits, []);
});

test('E-PUI05 margin absent', () => {
  const cleaned = stripForbiddenCommercialFields(hostileOrder);
  assert.equal('margin' in cleaned, false);
  assert.equal('markup' in (cleaned.lines?.[0] ?? {}), false);
});

test('E-PUI06 supplier identity absent from sanitized model and UI sources', async () => {
  const cleaned = stripForbiddenCommercialFields(hostileOrder);
  assert.equal('supplierCanonicalName' in cleaned, false);
  assert.equal('supplierContact' in cleaned, false);
  const files = [
    '../components/commercial/commercial-order-list.tsx',
    '../components/commercial/commercial-order-detail.tsx',
    '../components/commercial/commercial-orders-workspace.tsx',
    '../components/commercial/commercial-order-detail-workspace.tsx',
  ];
  for (const file of files) {
    const source = await read(file);
    assert.doesNotMatch(source, /supplierCanonicalName|purchaseCost|\bmargin\b|Contact supplier|Buy directly/);
    assert.doesNotMatch(source, /تواصل مع المورد|دفع للمورد/);
  }
});


test('E-PUI07 foreign order denied messaging present', async () => {
  const workspace = await read('../components/commercial/commercial-order-detail-workspace.tsx');
  assert.match(workspace, /404|NOT_FOUND|لا يخص شركتك|لا تملك صلاحية/);
});

test('E-PUI08 status mapping Arabic business language', async () => {
  const labels = await read('../components/commercial/commercial-order-labels.ts');
  assert.match(labels, /قيد التجهيز التجاري/);
  assert.match(labels, /تم اعتماد الطلب/);
  assert.match(labels, /جاري الشراء/);
  assert.match(labels, /تم تأكيد التوريد/);
  assert.match(labels, /جاهز للتنفيذ\/التسليم/);
});

test('E-PUI09 payment terms only when authorized field present', async () => {
  const detail = await read('../components/commercial/commercial-order-detail.tsx');
  assert.match(detail, /paymentTerms/);
  assert.match(detail, /order\.paymentTerms \?/);
});

test('E-PUI10 mobile collapse styles', async () => {
  const css = await read('../components/commercial/commercial.module.css');
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.lineCards/);
  assert.match(css, /display: none/);
});

test('E-PUI11 RTL root preserved', async () => {
  const layout = await read('../app/layout.tsx');
  assert.match(layout, /dir="rtl"/);
  assert.match(layout, /lang="ar"/);
});

test('E-PUI12 accessibility structure', async () => {
  const list = await read('../components/commercial/commercial-order-list.tsx');
  const detail = await read('../components/commercial/commercial-order-detail.tsx');
  assert.match(list, /aria-labelledby/);
  assert.match(detail, /scope="col"/);
  assert.match(detail, /aria-label="الإجمالي التجاري"/);
  assert.match(detail, /role="alert"/);
  assert.match(list, /role="status"/);
});

test('E nav gated until commercial contract ready', async () => {
  const chrome = await read('../components/portal/portal-chrome.tsx');
  assert.match(chrome, /isPartnerCommercialOrdersContractReady/);
  assert.match(chrome, /مشترياتي/);
  const api = await read('../lib/commercial-orders-api.ts');
  assert.match(api, /WAITING_BACKEND/);
  assert.match(api, /isPartnerCommercialOrdersContractReady/);
});

test('hostile payload forbidden keys detected before strip', () => {
  const hits = findForbiddenCommercialKeys(hostileOrder);
  assert.ok(hits.includes('purchaseCost'));
  assert.ok(hits.includes('margin'));
  assert.ok(hits.includes('supplierCanonicalName'));
  assert.ok(hits.some((path) => path.includes('unitPurchaseCost')));
});

test('no fake success language in commercial waiting states', async () => {
  const list = await read('../components/commercial/commercial-order-list.tsx');
  assert.match(list, /لا تُعرض طلبات تجريبية|بيانات وهمية/);
  assert.doesNotMatch(list, /demo order|fakeOrder|sampleOrder/);
});
