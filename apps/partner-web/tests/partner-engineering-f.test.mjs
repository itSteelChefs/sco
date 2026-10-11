import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertNoInternalNotesInText,
  canHandoffToProcurement,
  findForbiddenEngineeringKeys,
  stripForbiddenEngineeringFields,
} from '../components/engineering/engineering-guards.mjs';

async function read(relative) {
  return readFile(new URL(relative, import.meta.url), 'utf8');
}

const hostile = {
  requestId: 'r1',
  status: 'APPROVED',
  internalEngineeringNotes: 'secret sco note',
  internalNotes: 'nope',
  handoff: { handedOff: false, canCreateHandoff: true },
  resultVersions: [{ versionId: 'v1', isCurrent: true, lines: [] }],
};

test('F-P01 request list surface', async () => {
  const page = await read('../app/portal/engineering/page.tsx');
  const list = await read('../components/engineering/engineering-request-list.tsx');
  assert.match(page, /EngineeringWorkspace/);
  assert.match(list, /engineering-request-list/);
  assert.match(list, /reference|المرجع|item\.reference/);
});

test('F-P02 create draft form', async () => {
  const page = await read('../app/portal/engineering/new/page.tsx');
  const form = await read('../components/engineering/engineering-create-form.tsx');
  assert.match(page, /EngineeringCreateWorkspace/);
  assert.match(form, /createDraft|engineeringApi\.createDraft/);
  assert.match(form, /eng-create-submit/);
  assert.doesNotMatch(form, /KYC|سجل تجاري إلزامي/);
  assert.match(form, /حقول الحد الأدنى/);
});

test('F-P03 upload/link docs reuses Document Center', async () => {
  const detail = await read('../components/engineering/engineering-request-detail.tsx');
  assert.match(detail, /DocumentsPanel/);
  assert.match(detail, /engineering-documents/);
  assert.doesNotMatch(detail, /Univer|ExcelJS|OpenSeadragon|tesseract|ocr/i);
});

test('F-P04 submit action wired', async () => {
  const detail = await read('../components/engineering/engineering-request-detail.tsx');
  assert.match(detail, /engineeringApi\.submit|engineering-submit/);
});

test('F-P05 status mapping Arabic', async () => {
  const labels = await read('../components/engineering/engineering-labels.ts');
  assert.match(labels, /مسودة/);
  assert.match(labels, /مُرسَل/);
  assert.match(labels, /قيد المراجعة الهندسية/);
  assert.match(labels, /يتطلب إجراءً/);
  assert.match(labels, /معتمد|مكتمل/);
  const detail = await read('../components/engineering/engineering-request-detail.tsx');
  assert.doesNotMatch(detail, /progressPercent|fakeProgress|٪\s*مكتمل/);
});

test('F-P06 action required UI', async () => {
  const detail = await read('../components/engineering/engineering-request-detail.tsx');
  assert.match(detail, /engineering-action-required/);
  assert.match(detail, /actionRequired/);
  assert.match(detail, /إرسال الرد/);
});

test('F-P07 Partner internal note absent', () => {
  const cleaned = stripForbiddenEngineeringFields(hostile);
  assert.equal('internalEngineeringNotes' in cleaned, false);
  assert.equal('internalNotes' in cleaned, false);
  assert.deepEqual(findForbiddenEngineeringKeys(cleaned), []);
  assert.deepEqual(assertNoInternalNotesInText(JSON.stringify(cleaned)), []);
});

test('F-P07b UI sources omit internal notes', async () => {
  const detail = await read('../components/engineering/engineering-request-detail.tsx');
  assert.match(detail, /لا تُعرض ملاحظات هندسية داخلية/);
  assert.doesNotMatch(detail, /internalEngineeringNotes|engineeringInternalNote/);
});

test('F-P08 approved result surface', async () => {
  const boq = await read('../components/engineering/engineering-boq-result.tsx');
  assert.match(boq, /engineering-boq-result/);
  assert.match(boq, /eng-current-version|versionLabel/);
});

test('F-P09 BOQ lines columns', async () => {
  const boq = await read('../components/engineering/engineering-boq-result.tsx');
  for (const col of ['البند', 'الوصف', 'المواصفة', 'الوحدة', 'الكمية', 'التصنيف', 'ملاحظات']) {
    assert.match(boq, new RegExp(col));
  }
});

test('F-P10 version visible + previous retained', async () => {
  const boq = await read('../components/engineering/engineering-boq-result.tsx');
  assert.match(boq, /engineering-previous-versions|إصدارات سابقة/);
  assert.match(boq, /لا تُحذف/);
});

test('F-P11 unapproved handoff blocked', () => {
  assert.equal(
    canHandoffToProcurement({ status: 'SUBMITTED', handoff: { handedOff: false, canCreateHandoff: true } }),
    false,
  );
  assert.equal(
    canHandoffToProcurement({ status: 'APPROVED', handoff: { handedOff: false, canCreateHandoff: false } }),
    false,
  );
});

test('F-P12 approved handoff works when permitted', () => {
  assert.equal(
    canHandoffToProcurement({ status: 'APPROVED', handoff: { handedOff: false, canCreateHandoff: true } }),
    true,
  );
  assert.equal(
    canHandoffToProcurement({ status: 'COMPLETED', handoff: { handedOff: false, canCreateHandoff: true } }),
    true,
  );
});

test('F-P13 duplicate handoff safe UX', async () => {
  const handoff = await read('../components/engineering/engineering-handoff.tsx');
  assert.match(handoff, /idempotencyKey/);
  assert.match(handoff, /engineering-handoff-done|تم إنشاء طلب المشتريات/);
  assert.match(handoff, /canCreateHandoff/);
});

test('F-P14 created D reference shown', async () => {
  const handoff = await read('../components/engineering/engineering-handoff.tsx');
  assert.match(handoff, /engineering-handoff-reference/);
  assert.match(handoff, /procurementRequirementReference|createdRef/);
});

test('F-P15 foreign request unavailable messaging', async () => {
  const workspace = await read('../components/engineering/engineering-detail-workspace.tsx');
  assert.match(workspace, /لا يخص شركتك|404|NOT_FOUND/);
});

test('F-P16 mobile BOQ collapse', async () => {
  const css = await read('../components/engineering/engineering.module.css');
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.boqCards/);
});

test('F-P17 RTL root', async () => {
  const layout = await read('../app/layout.tsx');
  assert.match(layout, /dir="rtl"/);
  assert.match(layout, /lang="ar"/);
  const css = await read('../components/engineering/engineering.module.css');
  assert.match(css, /unicode-bidi:\s*plaintext/);
});

test('F-P18 accessibility structure', async () => {
  const list = await read('../components/engineering/engineering-request-list.tsx');
  const form = await read('../components/engineering/engineering-create-form.tsx');
  const boq = await read('../components/engineering/engineering-boq-result.tsx');
  const handoff = await read('../components/engineering/engineering-handoff.tsx');
  assert.match(list, /aria-labelledby/);
  assert.match(form, /htmlFor|label htmlFor/);
  assert.match(boq, /scope="col"/);
  assert.match(handoff, /role="dialog"/);
  assert.match(handoff, /aria-modal/);
});

test('F nav gated until engineering contract ready', async () => {
  const chrome = await read('../components/portal/portal-chrome.tsx');
  assert.match(chrome, /isPartnerEngineeringContractReady/);
  assert.match(chrome, /الدراسات الهندسية/);
  const api = await read('../lib/engineering-api.ts');
  assert.match(api, /WAITING_BACKEND/);
});

test('no new OSS engineering viewers', async () => {
  const pkg = await read('../package.json');
  assert.doesNotMatch(pkg, /univer|exceljs|openseadragon|tesseract/i);
});
