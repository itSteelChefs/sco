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

test('F-I01 engineering queue filters actionable statuses', async () => {
  const queue = await read('components/ops/engineering-queue.tsx');
  assert.match(queue, /internalEngineeringRequests/);
  assert.match(queue, /SUBMITTED/);
  assert.match(queue, /ASSIGNED/);
  assert.match(queue, /IN_REVIEW/);
  assert.match(queue, /ACTION_REQUIRED/);
  assert.match(queue, /PENDING_APPROVAL/);
  assert.match(queue, /APPROVED/);
  assert.doesNotMatch(queue, /KPI|vanity|revenue/i);
});

test('F-I02 request detail surface', async () => {
  const ws = await read('components/ops/engineering-workspace.tsx');
  const page = await read('app/engineering/[id]/page.tsx');
  assert.match(page, /EngineeringWorkspace/);
  assert.match(ws, /internalEngineeringRequestGet/);
  assert.match(ws, /companyId/);
  assert.match(ws, /partnerVisibleNotes/);
  assert.match(ws, /internalNotes/);
});

test('F-I03 assignment', async () => {
  const ws = await read('components/ops/engineering-workspace.tsx');
  assert.match(ws, /internalEngineeringAssign/);
  assert.match(ws, /engineerUserId/);
  assert.doesNotMatch(ws, /workforce|capacity planner/i);
});

test('F-I04 document access via Document Center', async () => {
  const ws = await read('components/ops/engineering-workspace.tsx');
  assert.match(ws, /internalDocuments/);
  assert.match(ws, /ENGINEERING_REQUEST/);
  assert.match(ws, /\/documents/);
  assert.doesNotMatch(ws, /pdfjs|univer|exceljs|cad viewer/i);
});

test('F-I05/F-I06 BOQ draft add/edit lines', async () => {
  const ws = await read('components/ops/engineering-workspace.tsx');
  assert.match(ws, /internalEngineeringBoqVersionCreate/);
  assert.match(ws, /internalEngineeringBoqLineUpsert/);
  assert.match(ws, /description/);
  assert.match(ws, /specification/);
  assert.match(ws, /discipline/);
  assert.match(ws, /quantity/);
  assert.match(ws, /brandPreference/);
  assert.match(ws, /engineeringNotes/);
});

test('F-I07 quantity validation', async () => {
  const ws = await read('components/ops/engineering-workspace.tsx');
  assert.match(ws, /qty <= 0/);
  assert.match(ws, /الكمية يجب أن تكون أكبر من صفر/);
});

test('F-I08 source reference', async () => {
  const ws = await read('components/ops/engineering-workspace.tsx');
  assert.match(ws, /sourceDocumentId/);
  assert.match(ws, /sourceReference/);
});

test('F-I09 review transitions', async () => {
  const ws = await read('components/ops/engineering-workspace.tsx');
  assert.match(ws, /internalEngineeringTransition/);
  assert.match(ws, /IN_REVIEW/);
  assert.match(ws, /ACTION_REQUIRED/);
  assert.match(ws, /PENDING_APPROVAL/);
});

test('F-I10 Partner-visible / internal note separation', async () => {
  const ws = await read('components/ops/engineering-workspace.tsx');
  assert.match(ws, /partnerMessage/);
  assert.match(ws, /internalScratch/);
  assert.match(ws, /لا تُرسل|لن تُضمَّن|intentionally discarded/);
  assert.match(ws, /engineeringNotes/);
  assert.match(ws, /partnerVisibleNotes/);
});

test('F-I11 approval with confirmation', async () => {
  const ws = await read('components/ops/engineering-workspace.tsx');
  assert.match(ws, /internalEngineeringBoqApprove/);
  assert.match(ws, /approveAck/);
  assert.match(ws, /approveToken/);
  assert.match(ws, /الاعتماد ليس نقرة واحدة/);
});

test('F-I12 approved version immutable UI', async () => {
  const ws = await read('components/ops/engineering-workspace.tsx');
  assert.match(ws, /boqImmutable/);
  assert.match(ws, /APPROVED.*SUPERSEDED|SUPERSEDED.*APPROVED/);
  assert.match(ws, /غير قابل للتعديل/);
});

test('F-I13 revision via backend create', async () => {
  const ws = await read('components/ops/engineering-workspace.tsx');
  assert.match(ws, /internalEngineeringBoqVersionCreate/);
  assert.match(ws, /versions\.map/);
});

test('F-I14 publish / partner preview hides internal notes', async () => {
  const ws = await read('components/ops/engineering-workspace.tsx');
  assert.match(ws, /معاينة نتيجة الشريك/);
  assert.match(ws, /بلا ملاحظات داخلية/);
  assert.match(ws, /الملاحظات الداخلية مخفية/);
});

test('F-I15/F-I16 D handoff + duplicate-safe idempotency', async () => {
  const ws = await read('components/ops/engineering-workspace.tsx');
  assert.match(ws, /internalEngineeringHandoffToD/);
  assert.match(ws, /handoff-to-d|idempotencyKey/);
  assert.match(ws, /f-d-handoff-/);
  assert.match(ws, /procurementRequirementId/);
  assert.match(ws, /التسليم المكرر/);
});

test('F-I17 permissions / safe errors', async () => {
  const safe = await read('components/ops/safe-error.ts');
  assert.match(safe, /ENGINEERING_REVIEW_FORBIDDEN/);
  assert.match(safe, /ENGINEERING_BOQ_APPROVE_FORBIDDEN/);
  assert.match(safe, /ENGINEERING_QUANTITY_INVALID/);
});

test('contracts expose Cursor3 engineering routes; no Univer/ExcelJS', async () => {
  const contracts = await readContracts();
  const pkg = await read('package.json');
  assert.match(contracts, /\/api\/v1\/internal\/engineering\/requests/);
  assert.match(contracts, /boq-versions/);
  assert.match(contracts, /handoff-to-d/);
  assert.match(contracts, /internalEngineeringBoqLineUpsert/);
  assert.doesNotMatch(pkg, /univer|exceljs|ag-grid|handsontable/i);
});

test('Arabic RTL engineering nav', async () => {
  const layout = await read('app/layout.tsx');
  const chrome = await read('components/ops/ops-chrome.tsx');
  assert.match(layout, /lang="ar"/);
  assert.match(layout, /dir="rtl"/);
  assert.match(chrome, /\/engineering/);
  assert.match(chrome, /الهندسة/);
});
