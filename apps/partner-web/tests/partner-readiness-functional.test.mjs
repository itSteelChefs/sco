import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  mapQualificationPresentation,
  toDraftBody,
  validateQualificationForm,
} from '../components/readiness/qualification-validation.mjs';

async function read(relative) {
  return readFile(new URL(relative, import.meta.url), 'utf8');
}

const complete = {
  companyName: 'شركة',
  commercialIdentifier: '',
  responsiblePerson: 'أحمد',
  contact: 'a@example.test',
  city: 'الرياض',
  sector: 'HVAC_REFRIGERATION',
  needType: 'VERIFY_QUOTE_CHECK',
  procurementSize: 'MEDIUM',
  procurementFrequency: 'MONTHLY',
};

test('FQ-01/02/03 form wires current + save draft APIs', async () => {
  const form = await read('../components/readiness/qualification-form.tsx');
  assert.match(form, /qualificationCurrent/);
  assert.match(form, /qualificationSaveDraft|qualificationCreateDraft/);
  assert.match(form, /تم الحفظ/);
  assert.doesNotMatch(form, /WAITING_BACKEND/);
});

test('FQ-04 server validation path and local required validation', () => {
  const errors = validateQualificationForm({ ...complete, city: '' });
  assert.equal(errors.city, 'المدينة مطلوبة.');
  assert.deepEqual(validateQualificationForm(complete), {});
});

test('FQ-05 failed save never pretends success without API', async () => {
  const form = await read('../components/readiness/qualification-form.tsx');
  assert.match(form, /setPhase\('failed'\)/);
  assert.match(form, /mapSaveError/);
  assert.doesNotMatch(form, /setPhase\('saved'\).*catch/);
});

test('FQ-06/07/08 submit + immutable submitted mapping', async () => {
  const form = await read('../components/readiness/qualification-form.tsx');
  assert.match(form, /qualificationSubmit/);
  assert.match(form, /SUBMITTED/);
  assert.match(form, /QUALIFICATION_ALREADY_SUBMITTED|status === 409/);
  assert.match(form, /readOnly/);
  assert.equal(mapQualificationPresentation('SUBMITTED'), 'SUBMITTED');
  assert.equal(mapQualificationPresentation('DRAFT'), 'IN_PROGRESS');
});

test('FQ draft body omits empty commercial identifier', () => {
  const body = toDraftBody(complete);
  assert.equal('commercialIdentifier' in body, false);
  assert.equal(toDraftBody({ ...complete, commercialIdentifier: 'CR-1' }).commercialIdentifier, 'CR-1');
});

test('FD-01..07 document upload wires real endpoint and categories', async () => {
  const panel = await read('../components/readiness/documents-panel.tsx');
  assert.match(panel, /documentUpload/);
  assert.match(panel, /VERIFY_QUOTE/);
  assert.match(panel, /DOCUMENT_TYPE_NOT_ALLOWED|DOCUMENT_TOO_LARGE/);
  assert.match(panel, /contentBase64/);
  assert.doesNotMatch(panel, /تم الرفع بنجاح.*catch|fakeUpload/);
  assert.doesNotMatch(panel, /otherCompany|foreign/);
});

test('FV-01..09 verify Quote Check only wiring', async () => {
  const panel = await read('../components/readiness/verify-panel.tsx');
  assert.match(panel, /verifyCreate/);
  assert.match(panel, /Quote Check/);
  assert.doesNotMatch(panel, /PRICE_CHECK|Price Check/);
  assert.match(panel, /verifyAttachQuote/);
  assert.match(panel, /verifySubmit/);
  assert.match(panel, /VERIFY_QUOTE/);
  assert.match(panel, /RFQ/);
  assert.match(panel, /تفاوض/);
  assert.doesNotMatch(panel, /confidence|classification/);
  assert.match(panel, /DOCUMENT_LINK_INVALID/);
  assert.match(panel, /status === 403/);
  const contracts = await read('../../../packages/contracts/src/api.ts');
  assert.match(contracts, /productMode: 'QUOTE_CHECK'/);
});

test('contracts client exposes Wave2 partner surfaces', async () => {
  const contracts = await read('../../../packages/contracts/src/api.ts');
  assert.match(contracts, /partnerQualificationCurrent/);
  assert.match(contracts, /partnerDocumentUpload/);
  assert.match(contracts, /partnerVerifyCreate/);
  assert.match(contracts, /DRAFT.*SUBMITTED/);
});
