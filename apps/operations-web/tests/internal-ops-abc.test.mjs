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

test('I-A01 queue renders and filters by status', async () => {
  const queue = await read('components/ops/qualification-queue.tsx');
  assert.match(queue, /internalQualifications/);
  assert.match(queue, /statusFilter/);
  assert.match(queue, /SUBMITTED/);
  assert.match(queue, /ACTION_REQUIRED/);
});

test('I-A02/I-A03 detail loads and exposes review surface', async () => {
  const detail = await read('components/ops/qualification-review.tsx');
  const page = await read('app/qualifications/[id]/page.tsx');
  assert.match(detail, /QualificationReview/);
  assert.match(detail, /internalQualificationDecide/);
  assert.match(page, /QualificationReview/);
  assert.match(page, /qualificationId/);
});

test('I-A04/I-A05 action-required separates partner-visible reason from internal scratch', async () => {
  const detail = await read('components/ops/qualification-review.tsx');
  assert.match(detail, /ACTION_REQUIRED/);
  assert.match(detail, /partnerVisibleReason/);
  assert.match(detail, /internalScratch/);
  assert.match(detail, /لا تُرسل|لن يُضمَّن|never sent/i);
  assert.match(
    detail,
    /internalQualificationDecide\(\s*qualificationId,\s*\{\s*status:\s*decision,\s*reason:\s*partnerVisibleReason\.trim\(\),\s*\}\)/,
  );
});

test('I-A06/I-A07/I-A08 approval call + safe 403/conflict mapping', async () => {
  const detail = await read('components/ops/qualification-review.tsx');
  const safe = await read('components/ops/safe-error.ts');
  assert.match(detail, /APPROVED/);
  assert.match(detail, /confirm/);
  assert.match(safe, /status === 403/);
  assert.match(safe, /409|CONFLICT/);
});

test('I-B01..I-B06 agreements ops stay launch-focused without inventing legal text', async () => {
  const agreements = await read('components/ops/agreements-ops.tsx');
  assert.match(agreements, /requiredAgreementsSatisfied/);
  assert.match(agreements, /internalPartnerships/);
  assert.match(agreements, /internalPartnershipReadiness/);
  assert.match(agreements, /internalAgreementPolicyPublish/);
  assert.match(agreements, /لا نص قانوني|دون تأليف|لا إنشاء محتوى قانوني/);
  assert.doesNotMatch(agreements, /لوريم|lorem ipsum|fake legal/i);
});

test('I-D01..I-D05 documents list is metadata-only and hides storage keys', async () => {
  const docs = await read('components/ops/documents-ops.tsx');
  assert.match(docs, /internalDocuments/);
  assert.match(docs, /filename/);
  assert.match(docs, /document_category/);
  assert.doesNotMatch(docs, /storageKey|storage_key|s3:\/\/|bucket/i);
});

test('I-V01..I-V10 verify queue/analyst/approver/raw gate/preview wiring', async () => {
  const queue = await read('components/ops/verify-queue.tsx');
  const workspace = await read('components/ops/verify-workspace.tsx');
  const contracts = await readContracts();
  assert.match(queue, /internalVerifyQueue/);
  assert.match(queue, /SUBMITTED/);
  assert.match(queue, /IN_REVIEW/);
  assert.match(queue, /PREPARED/);
  assert.match(workspace, /internalVerifyPrepareAnalysis/);
  assert.match(workspace, /internalVerifyApproveResult/);
  assert.match(workspace, /partnerPreview|معاينة مخرجات الشريك/);
  assert.match(workspace, /Raw evidence is not rendered|الأدلة الخام غير معروضة/);
  assert.match(contracts, /internalVerifyQueue/);
  assert.match(contracts, /internalVerifyApproveResult/);
  assert.doesNotMatch(workspace, /partner\.verify|Partner role|ROLE_PARTNER/);
});

test('ops home exposes actionable queues only', async () => {
  const home = await read('components/ops/ops-home.tsx');
  assert.match(home, /طوابير قابلة للتنفيذ/);
  assert.doesNotMatch(home, /KPI|revenue|dashboard chart/i);
});

test('Arabic-first layout and RTL root preserved', async () => {
  const layout = await read('app/layout.tsx');
  assert.match(layout, /lang="ar"/);
  assert.match(layout, /dir="rtl"/);
});

test('contracts expose internal A+B+C client methods without new npm deps', async () => {
  const contracts = await readContracts();
  const pkg = await read('package.json');
  assert.match(contracts, /internalQualifications/);
  assert.match(contracts, /internalQualificationDecide/);
  assert.match(contracts, /internalDocuments/);
  assert.match(contracts, /internalVerifyPrepareAnalysis/);
  assert.doesNotMatch(pkg, /ag-grid|tanstack\/react-table|shadcn/i);
});
