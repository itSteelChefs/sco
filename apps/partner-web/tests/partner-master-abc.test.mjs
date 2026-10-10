import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  mapQualificationPresentation,
  validateQualificationForm,
} from '../components/readiness/qualification-validation.mjs';

async function read(relative) {
  return readFile(new URL(relative, import.meta.url), 'utf8');
}

async function loadLabels() {
  // Compile-free: re-export mapper already in .mjs; labels TS is asserted via source.
  return {
    mapQualificationPresentation,
  };
}

test('P-A REJECTED maps to ACTION_REQUIRED presentation (no invented backend enum)', async () => {
  const { mapQualificationPresentation: map } = await loadLabels();
  assert.equal(map('REJECTED'), 'ACTION_REQUIRED');
  assert.equal(map('APPROVED'), 'APPROVED');
  assert.equal(map('UNDER_REVIEW'), 'UNDER_REVIEW');
  const labels = await read('../components/readiness/readiness-labels.ts');
  assert.match(labels, /case 'REJECTED':\s*return 'ACTION_REQUIRED'/);
  assert.doesNotMatch(labels, /ACTION_REQUIRED.*=.*'ACTION_REQUIRED'/);
});

test('P-A admission status UI uses journey qualification authority', async () => {
  const admission = await read('../components/readiness/admission-status.tsx');
  assert.match(admission, /admission-status/);
  assert.match(admission, /يتطلب إجراءً/);
  assert.match(admission, /membershipPresent/);
  assert.match(admission, /لا تعني الاعتماد|لا يعني اعتماد/);
  assert.match(admission, /\/portal\/qualification/);
});

test('P-A honest resubmit gating after QUALIFICATION_ALREADY_SUBMITTED', async () => {
  const form = await read('../components/readiness/qualification-form.tsx');
  assert.match(form, /QUALIFICATION_ALREADY_SUBMITTED/);
  assert.match(form, /qualification-action-required/);
  assert.match(form, /لا يُعرض نجاح وهمي/);
  assert.doesNotMatch(form, /fakeSuccess|pretend/);
});

test('P-B agreements page + confirm accept + reacceptance', async () => {
  const page = await read('../app/portal/agreements/page.tsx');
  const panel = await read('../components/readiness/agreements-panel.tsx');
  assert.match(page, /AgreementsPanel/);
  assert.match(panel, /agreement-confirm-dialog/);
  assert.match(panel, /تأكيد القبول/);
  assert.match(panel, /REACCEPTANCE_REQUIRED/);
  assert.match(panel, /LAUNCH_AGREEMENT_FOCUS/);
  assert.match(panel, /acceptedVersion/);
  assert.match(panel, /acceptPartnerAgreement/);
});

test('P-D Document Center upload live; server list waiting', async () => {
  const page = await read('../app/portal/documents/page.tsx');
  const panel = await read('../components/readiness/documents-panel.tsx');
  assert.match(page, /DocumentsPanel/);
  assert.match(panel, /documentUpload/);
  assert.match(panel, /documents-server-list-waiting/);
  assert.match(panel, /بانتظار/);
  assert.doesNotMatch(panel, /fakeDocument|fabricat/i);
  assert.doesNotMatch(panel, /download\(|storageKey|s3:\/\//);
});

test('P-V verify getResult + coverage; no invented rich fields', async () => {
  const page = await read('../app/portal/verify/page.tsx');
  const panel = await read('../components/readiness/verify-panel.tsx');
  const contracts = await read('../../../packages/contracts/src/api.ts');
  const api = await read('../lib/readiness-api.ts');
  assert.match(page, /VerifyPanel/);
  assert.match(panel, /verifyGetResult/);
  assert.match(panel, /verify-result/);
  assert.match(panel, /coverage/);
  assert.match(panel, /lineCoveragePercent/);
  assert.match(panel, /verifiedLineCount/);
  assert.match(contracts, /partnerVerifyGetResult/);
  assert.match(api, /verifyGetResult/);
  assert.doesNotMatch(panel, /confidence|proposedAction|gapAmount|offerValue/);
});

test('shell chrome nav covers readiness surfaces', async () => {
  const chrome = await read('../components/portal/portal-chrome.tsx');
  for (const href of [
    '/portal/readiness',
    '/portal/qualification',
    '/portal/agreements',
    '/portal/documents',
    '/portal/verify',
  ]) {
    assert.match(chrome, new RegExp(href.replace('/', '\\/')));
  }
  assert.match(chrome, /الجاهزية/);
  assert.match(chrome, /تأكّد/);
});

test('validation still rejects incomplete qualification', () => {
  const errors = validateQualificationForm({
    companyName: '',
    commercialIdentifier: '',
    responsiblePerson: '',
    contact: 'bad',
    city: '',
    sector: '',
    needType: '',
    procurementSize: '',
    procurementFrequency: '',
  });
  assert.ok(errors.companyName);
  assert.ok(errors.contact);
});
