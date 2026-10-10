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

const complete = {
  companyName: 'شركة الاختبار',
  commercialIdentifier: '',
  responsiblePerson: 'أحمد',
  contact: 'a@example.test',
  city: 'الرياض',
  sector: 'HVAC_REFRIGERATION',
  needType: 'BOTH',
  procurementSize: 'MEDIUM',
  procurementFrequency: 'MONTHLY',
};

test('F-01 readiness page renders for authorized company member surface', async () => {
  const page = await read('../app/portal/readiness/page.tsx');
  const workspace = await read('../components/readiness/readiness-workspace.tsx');
  assert.match(page, /ReadinessWorkspace/);
  assert.match(workspace, /جاهزية الشريك/);
  assert.match(workspace, /partnerJourney/);
});

test('F-02 unauthenticated readiness follows auth redirect behavior', async () => {
  const workspace = await read('../components/readiness/readiness-workspace.tsx');
  const middleware = await read('../middleware.ts');
  assert.match(workspace, /replace\('\/login'\)/);
  assert.doesNotMatch(middleware, /readiness/);
});

test('F-03 launch fields render', async () => {
  const form = await read('../components/readiness/qualification-form.tsx');
  for (const token of ['اسم الشركة', 'السجل التجاري', 'المسؤول', 'البريد الإلكتروني', 'المدينة', 'القطاع', 'نوع احتياج', 'حجم المشتريات', 'تكرار المشتريات']) {
    assert.match(form, new RegExp(token));
  }
});

test('F-04 required validation works', () => {
  const errors = validateQualificationForm({ ...complete, companyName: '', city: '' });
  assert.equal(errors.companyName, 'اسم الشركة مطلوب.');
  assert.equal(errors.city, 'المدينة مطلوبة.');
});

test('F-05 optional business identifier may be omitted', () => {
  assert.deepEqual(validateQualificationForm(complete), {});
});

test('F-06 draft save uses real backend client', async () => {
  const form = await read('../components/readiness/qualification-form.tsx');
  assert.match(form, /qualificationSaveDraft|qualificationCreateDraft/);
  assert.match(form, /تم الحفظ/);
});

test('F-07 submit calls real backend', async () => {
  const form = await read('../components/readiness/qualification-form.tsx');
  assert.match(form, /qualificationSubmit/);
});

test('F-08 failed submit does not show success', async () => {
  const form = await read('../components/readiness/qualification-form.tsx');
  assert.match(form, /setPhase\('failed'\)/);
});

test('F-09 submitted/approved states are read-only', async () => {
  const form = await read('../components/readiness/qualification-form.tsx');
  assert.match(form, /SUBMITTED/);
  assert.match(form, /readOnly/);
  assert.equal(mapQualificationPresentation('APPROVED'), 'APPROVED');
});

test('F-10 agreement statuses render', async () => {
  const panel = await read('../components/readiness/agreements-panel.tsx');
  assert.match(panel, /acceptPartnerAgreement/);
  assert.match(panel, /LIVE/);
});

test('F-11 document statuses render when API available', async () => {
  const panel = await read('../components/readiness/documents-panel.tsx');
  assert.match(panel, /documentUpload/);
  assert.match(panel, /LIVE/);
});

test('F-12 RTL', async () => {
  const layout = await read('../app/layout.tsx');
  const css = await read('../components/readiness/readiness.module.css');
  assert.match(layout, /dir="rtl"/);
  assert.match(css, /margin-inline|border-inline/);
});

test('F-13 mobile smoke styles present', async () => {
  const css = await read('../components/readiness/readiness.module.css');
  assert.match(css, /@media \(max-width: 420px\)/);
});

test('F-14 no hidden future entitlements implied', async () => {
  const workspace = await read('../components/readiness/readiness-workspace.tsx');
  assert.doesNotMatch(workspace, /Procurement active|marketplace|بدء طلب شراء/);
  assert.match(workspace, /Quote Check/);
});
