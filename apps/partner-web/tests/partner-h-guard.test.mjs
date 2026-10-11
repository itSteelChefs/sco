import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FORBIDDEN_H_NAV_HREFS,
  FORBIDDEN_PARTNER_OPERATIONS_KEYS,
  contractsClientExposesPartnerH,
  findForbiddenKeys,
  filterPartnerHNav,
  navContainsForbiddenH,
  partnerDtoTypeHasForbiddenHFields,
  stripForbiddenKeys,
  isDeniedPartnerStatus,
  errorPayloadLooksSafe,
} from '../lib/h-partner-boundary.mjs';
import { filterPartnerNav, navContainsForbiddenG } from '../lib/g-partner-boundary.mjs';

async function read(relative) {
  return readFile(new URL(relative, import.meta.url), 'utf8');
}

const here = path.dirname(fileURLToPath(import.meta.url));

test('H-PARTNER-01 no H operations navigation in Partner chrome/routes', async () => {
  const chrome = await read('../components/portal/portal-chrome.tsx');
  assert.match(chrome, /filterPartnerHNav/);
  assert.match(chrome, /filterPartnerNav/);
  assert.doesNotMatch(chrome, /href:\s*'\/portal\/operations'|href:\s*'\/portal\/work-queue'/);
  assert.doesNotMatch(chrome, /label:\s*'Work Queue'|label:\s*'Operations'|طابور العمل|المنصة التشغيلية/);
  const portalDir = path.join(here, '../app/portal');
  const entries = await readdir(portalDir);
  for (const blocked of [
    'operations',
    'work-queue',
    'work-items',
    'exceptions',
    'jobs',
    'ops-health',
    'ops-config',
    'cycles',
    'audit',
  ]) {
    assert.equal(entries.includes(blocked), false, `unexpected portal route ${blocked}`);
  }
  const hits = navContainsForbiddenH([
    { href: '/portal/readiness', label: 'الجاهزية' },
    { href: '/portal/orders', label: 'مشترياتي' },
    { href: '/portal/engineering', label: 'الدراسات الهندسية' },
  ]);
  assert.deepEqual(hits, []);
  assert.equal(filterPartnerHNav([{ href: '/portal/operations', label: 'Operations' }]).length, 0);
  assert.equal(filterPartnerHNav([{ href: '/portal/work-queue', label: 'Work Queue' }]).length, 0);
});

test('H-PARTNER-02 contracts client has no Partner operations methods', async () => {
  const contracts = await read('../../../packages/contracts/src/api.ts');
  const exposed = contractsClientExposesPartnerH(contracts);
  assert.deepEqual(exposed, []);
  assert.doesNotMatch(contracts, /\/api\/v1\/partner\/operations/);
  assert.doesNotMatch(contracts, /\/api\/v1\/partner\/work-items/);
  assert.doesNotMatch(contracts, /partnerWorkQueue|partnerOpsHealth|partnerAuditEvidence/);
});

test('H-PARTNER-03 Partner DTOs omit assignment / exception / job / audit fields', async () => {
  const contracts = await read('../../../packages/contracts/src/api.ts');
  const dtoHits = partnerDtoTypeHasForbiddenHFields(contracts);
  assert.deepEqual(dtoHits, []);
  for (const key of [
    'assignedTo',
    'assignedUserId',
    'blockedReason',
    'exceptionMessage',
    'jobId',
    'retryCount',
    'auditEvidence',
  ]) {
    assert.ok(FORBIDDEN_PARTNER_OPERATIONS_KEYS.includes(key));
  }
});

test('H-PARTNER-04 strip + findForbiddenKeys hide internal ops payload', () => {
  const hostile = {
    status: 'OPEN',
    assignedUserId: 'u1',
    blockedReason: 'supplier late',
    exceptionMessage: 'boom',
    jobId: 'j1',
    retryCount: 3,
    operationalPriority: 1,
    cycleId: 'c1',
    auditEvidence: { raw: true },
    jobPayload: { purchaseCost: 9 },
  };
  assert.ok(findForbiddenKeys(hostile).length >= 6);
  const cleaned = stripForbiddenKeys(hostile);
  assert.equal('assignedUserId' in cleaned, false);
  assert.equal('blockedReason' in cleaned, false);
  assert.equal('jobId' in cleaned, false);
  assert.equal('auditEvidence' in cleaned, false);
  assert.deepEqual(findForbiddenKeys(cleaned), []);
  assert.equal(cleaned.status, 'OPEN');
});

test('H-PARTNER-05 A Partner admission/readiness surfaces intact (no H product)', async () => {
  const chrome = await read('../components/portal/portal-chrome.tsx');
  assert.match(chrome, /\/portal\/readiness/);
  assert.match(chrome, /\/portal\/qualification/);
  assert.match(chrome, /\/portal\/agreements/);
  const readiness = await read('../lib/readiness-api.ts');
  assert.match(readiness, /partner/);
  assert.doesNotMatch(readiness, /h-operations|work-items|assignedUserId/);
});

test('H-PARTNER-06 B Partner documents route remains', async () => {
  const chrome = await read('../components/portal/portal-chrome.tsx');
  assert.match(chrome, /\/portal\/documents/);
  const entries = await readdir(path.join(here, '../app/portal'));
  assert.ok(entries.includes('documents'));
});

test('H-PARTNER-07 C Partner Verify route remains', async () => {
  const chrome = await read('../components/portal/portal-chrome.tsx');
  assert.match(chrome, /\/portal\/verify/);
  const entries = await readdir(path.join(here, '../app/portal'));
  assert.ok(entries.includes('verify'));
});

test('H-PARTNER-08 D Partner procurement comparison stays alias-safe', async () => {
  const service = await read('../../../apps/api/src/modules/procurement-core/partner-procurement.service.ts');
  assert.match(service, /partner_procurement_comparison_get/);
  const comparisonBlock = service.slice(service.indexOf('comparison('), service.indexOf('private toRequirementDto'));
  assert.doesNotMatch(comparisonBlock, /assignedUserId|blockedReason|jobPayload|h_work_items/);
});

test('H-PARTNER-09 E Partner commercial remains sale-side (no ops leakage)', async () => {
  const detail = await read('../components/commercial/commercial-order-detail.tsx');
  const api = await read('../lib/commercial-orders-api.ts');
  assert.match(detail, /unitSalePrice|saleUnitPrice|سعر البيع/);
  assert.doesNotMatch(detail, /assignedUserId|blockedReason|workQueue|retryCount|auditEvidence/);
  assert.doesNotMatch(api, /h-operations|\/work-items|\/exceptions/);
  assert.match(api, /isPartnerCommercialOrdersContractReady/);
});

test('H-PARTNER-10 F Partner engineering omits internal assignment/ops fields', async () => {
  const boq = await read('../components/engineering/engineering-boq-result.tsx');
  const detail = await read('../components/engineering/engineering-request-detail.tsx');
  const api = await read('../lib/engineering-api.ts');
  assert.doesNotMatch(boq, /assignedUserId|blockedReason|jobPayload|auditEvidence/);
  assert.doesNotMatch(detail, /assignedUserId|blockedReason|retryCount|opsHealth/);
  assert.match(detail, /لا تُعرض ملاحظات هندسية داخلية/);
  assert.doesNotMatch(api, /h-operations|\/work-items/);
});

test('H-PARTNER-11 G Partner remains hidden (composed with H filter)', async () => {
  const chrome = await read('../components/portal/portal-chrome.tsx');
  assert.match(chrome, /filterPartnerNav/);
  assert.match(chrome, /filterPartnerHNav/);
  const composed = filterPartnerHNav(
    filterPartnerNav([
      { href: '/portal/readiness', label: 'الجاهزية' },
      { href: '/portal/intelligence', label: 'Intelligence' },
      { href: '/portal/operations', label: 'Operations' },
    ]),
  );
  assert.deepEqual(
    composed.map((i) => i.href),
    ['/portal/readiness'],
  );
  assert.ok(navContainsForbiddenG([{ href: '/portal/intelligence', label: 'Intelligence' }]).length > 0);
  const portalDir = path.join(here, '../app/portal');
  const entries = await readdir(portalDir);
  assert.equal(entries.includes('intelligence'), false);
});

test('H-PARTNER-12 no Partner H product UI pages created', async () => {
  const portalDir = path.join(here, '../app/portal');
  const entries = await readdir(portalDir);
  for (const name of ['operations', 'work-queue', 'exceptions', 'jobs', 'cycles', 'audit']) {
    assert.equal(entries.includes(name), false);
  }
  // Boundary module must not be a product page
  const boundary = await read('../lib/h-partner-boundary.mjs');
  assert.match(boundary, /No Partner H product surface/);
});

test('H-PARTNER-13 mobile/RTL unaffected', async () => {
  const layout = await read('../app/layout.tsx');
  const commercialCss = await read('../components/commercial/commercial.module.css');
  const engCss = await read('../components/engineering/engineering.module.css');
  assert.match(layout, /dir="rtl"/);
  assert.match(layout, /lang="ar"/);
  assert.match(commercialCss, /@media \(max-width: 640px\)/);
  assert.match(engCss, /@media \(max-width: 640px\)/);
});

test('H-PARTNER-14 accessibility — portal chrome remains labeled', async () => {
  const chrome = await read('../components/portal/portal-chrome.tsx');
  assert.match(chrome, /aria-label="تنقل البوابة"|aria-label=\{?/);
  assert.match(chrome, /aria-current/);
});

test('H forbidden nav href catalog covers order attack surface', () => {
  for (const href of [
    '/portal/operations',
    '/portal/work-queue',
    '/operations',
    '/work-items',
    '/exceptions',
    '/jobs',
    '/retry',
    '/config',
    '/cycles/manage',
    '/audit/evidence',
  ]) {
    assert.ok(FORBIDDEN_H_NAV_HREFS.includes(href), `missing ${href}`);
  }
});

test('denied status helper accepts 401/403/404 only', () => {
  assert.equal(isDeniedPartnerStatus(200), false);
  assert.equal(isDeniedPartnerStatus(403), true);
  assert.equal(isDeniedPartnerStatus(404), true);
  assert.equal(errorPayloadLooksSafe('{"error":{"code":"FORBIDDEN"}}'), true);
  assert.equal(errorPayloadLooksSafe('assignedUserId=abc blockedReason=x'), false);
  assert.equal(errorPayloadLooksSafe('SELECT * FROM h_work_items'), false);
});
