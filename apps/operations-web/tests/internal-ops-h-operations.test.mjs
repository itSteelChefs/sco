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

test('H-I01 operations center', async () => {
  const page = await read('app/operations/page.tsx');
  const queue = await read('components/ops/h-operations-queue.tsx');
  assert.match(page, /HOperationsQueue/);
  assert.match(page, /defaultView="all"/);
  assert.match(queue, /internalHWorkQueue/);
  assert.match(queue, /actionRequired/);
  assert.doesNotMatch(queue, /KPI|vanity|fake metric/i);
});

test('H-I02 my work', async () => {
  const page = await read('app/operations/my-work/page.tsx');
  assert.match(page, /defaultView="my"/);
  assert.match(page, /HOperationsQueue/);
});

test('H-I03 assignment', async () => {
  const queue = await read('components/ops/h-operations-queue.tsx');
  assert.match(queue, /internalHWorkAssign/);
  assert.match(queue, /assigneeUserId/);
});

test('H-I04 blocked item', async () => {
  const queue = await read('components/ops/h-operations-queue.tsx');
  assert.match(queue, /blocked/);
  assert.match(queue, /BLOCKED/);
  assert.match(queue, /blockedReason/);
});

test('H-I05 source deep link', async () => {
  const shared = await read('components/ops/h-operations-shared.tsx');
  assert.match(shared, /sourceDeepLink/);
  assert.match(shared, /\/qualifications\//);
  assert.match(shared, /\/engineering\//);
  assert.match(shared, /\/intelligence/);
  assert.match(shared, /\/commercial/);
  const queue = await read('components/ops/h-operations-queue.tsx');
  assert.match(queue, /SourceLink/);
});

test('H-I06 exception list', async () => {
  const ex = await read('components/ops/h-operations-exceptions.tsx');
  assert.match(ex, /internalHExceptionGet/);
  assert.match(ex, /safeErrorCode/);
  assert.match(ex, /safeErrorMessage/);
  assert.doesNotMatch(ex, /stackTrace|stack_trace|at Object\./);
});

test('H-I07 retry', async () => {
  const ex = await read('components/ops/h-operations-exceptions.tsx');
  assert.match(ex, /internalHExceptionRetry/);
  assert.match(ex, /retryable/);
});

test('H-I08 resolution', async () => {
  const ex = await read('components/ops/h-operations-exceptions.tsx');
  assert.match(ex, /internalHExceptionResolve/);
  assert.match(ex, /note/);
  assert.match(ex, /حل مع ملاحظة/);
});

test('H-I09 weekly cycle', async () => {
  const cycles = await read('components/ops/h-operations-cycles.tsx');
  assert.match(cycles, /internalHCycleCreate/);
  assert.match(cycles, /internalHCycleGet/);
  assert.match(cycles, /cutoffAt/);
  assert.match(cycles, /الأحد|خميس|سبت|Sunday|Thursday|Saturday|جمع/);
});

test('H-I10 lock', async () => {
  const cycles = await read('components/ops/h-operations-cycles.tsx');
  assert.match(cycles, /internalHCycleLock/);
  assert.match(cycles, /lockAck/);
  assert.match(cycles, /أؤكّد قفل/);
});

test('H-I11 post-cutoff display', async () => {
  const cycles = await read('components/ops/h-operations-cycles.tsx');
  assert.match(cycles, /pastCutoff/);
  assert.match(cycles, /بعد القطع/);
  assert.match(cycles, /internalHCycleOverrideInclude/);
  assert.match(cycles, /reason/);
});

test('H-I12 notifications', async () => {
  const n = await read('components/ops/h-operations-notifications.tsx');
  assert.match(n, /internalHNotifications/);
  assert.match(n, /internalHNotificationRead/);
  assert.match(n, /unreadOnly/);
  assert.match(n, /SourceLink/);
});

test('H-I13 jobs', async () => {
  const jobs = await read('components/ops/h-operations-jobs.tsx');
  assert.match(jobs, /internalHJobEnqueue/);
  assert.match(jobs, /internalHJobRun/);
  assert.match(jobs, /idempotencyKey/);
  assert.match(jobs, /G_REFRESH/);
});

test('H-I14 health', async () => {
  const health = await read('components/ops/h-operations-health.tsx');
  assert.match(health, /internalHHealth/);
  assert.match(health, /database/);
  assert.match(health, /gRefresh/);
  assert.match(health, /documents/);
  assert.doesNotMatch(health, /recharts|Chart\.js|sparkline/i);
});

test('H-I15 audit', async () => {
  const audit = await read('components/ops/h-operations-audit.tsx');
  assert.match(audit, /internalHAuditEvidence/);
  assert.match(audit, /actorUserId/);
  assert.match(audit, /entityType/);
  assert.match(audit, /action/);
});

test('H-I16 config', async () => {
  const cfg = await read('components/ops/h-operations-config.tsx');
  assert.match(cfg, /internalHConfigGet/);
  assert.match(cfg, /internalHConfigSet/);
  assert.match(cfg, /weekly_cutoff/);
  assert.match(cfg, /retry_limits/);
  assert.match(cfg, /notification_toggles/);
  assert.match(cfg, /operational_thresholds/);
  assert.match(cfg, /لا سياسة أعمال/);
});

test('H-I17 permission denied', async () => {
  const queue = await read('components/ops/h-operations-queue.tsx');
  const safe = await read('components/ops/safe-error.ts');
  assert.match(queue, /غير مصرح بعرض طابور العمليات/);
  assert.match(safe, /H_OPS_READ_FORBIDDEN/);
});

test('H-I18 RTL', async () => {
  const layout = await read('app/layout.tsx');
  const chrome = await read('components/ops/ops-chrome.tsx');
  assert.match(layout, /dir=["']rtl["']/);
  assert.match(layout, /lang=["']ar["']/);
  assert.match(chrome, /العمليات/);
});

test('H-I19 tablet', async () => {
  const css = await read('components/ops/ops.module.css');
  assert.match(css, /tableWrap/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /@media/);
});

test('H-I20 accessibility', async () => {
  const queue = await read('components/ops/h-operations-queue.tsx');
  const cycles = await read('components/ops/h-operations-cycles.tsx');
  assert.match(queue, /scope="col"/);
  assert.match(queue, /aria-labelledby/);
  assert.match(queue, /role="alert"|role="status"/);
  assert.match(cycles, /type="checkbox"/);
  assert.match(cycles, /confirmBox/);
});

test('contracts expose Cursor3 H routes; no new OSS', async () => {
  const contracts = await readContracts();
  const pkg = await read('package.json');
  assert.match(contracts, /\/api\/v1\/internal\/h-operations\/work-items/);
  assert.match(contracts, /internalHWorkQueue/);
  assert.match(contracts, /internalHExceptionRetry/);
  assert.match(contracts, /internalHCycleLock/);
  assert.match(contracts, /internalHNotifications/);
  assert.match(contracts, /internalHJobRun/);
  assert.match(contracts, /internalHHealth/);
  assert.match(contracts, /internalHConfigSet/);
  assert.match(contracts, /internalHAuditEvidence/);
  assert.doesNotMatch(contracts, /\/api\/v1\/partner\/h-operations/);
  assert.doesNotMatch(pkg, /recharts|chart\.js|d3|bullmq|temporal|agenda/i);
});
