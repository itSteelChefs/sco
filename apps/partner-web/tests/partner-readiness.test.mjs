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
  businessIdentifier: '',
  responsiblePerson: 'أحمد',
  contactEmail: 'a@example.test',
  contactMobile: '',
  city: 'الرياض',
  sector: 'HVAC_REFRIGERATION',
  needType: 'BOTH',
  procurementSize: 'MONTHLY',
};

test('F-01 readiness page renders for authorized company member surface', async () => {
  const page = await read('../app/portal/readiness/page.tsx');
  const workspace = await read('../components/readiness/readiness-workspace.tsx');
  assert.match(page, /ReadinessWorkspace/);
  assert.match(workspace, /جاهزية الشريك/);
  assert.match(workspace, /partnerJourney/);
  assert.match(workspace, /admissionStatus/);
});

test('F-02 unauthenticated readiness follows auth redirect behavior', async () => {
  const workspace = await read('../components/readiness/readiness-workspace.tsx');
  const middleware = await read('../middleware.ts');
  assert.match(workspace, /replace\('\/login'\)/);
  assert.match(middleware, /PUBLIC_PATHS/);
  assert.doesNotMatch(middleware, /readiness/);
});

test('F-03 launch fields render', async () => {
  const form = await read('../components/readiness/qualification-form.tsx');
  for (const token of [
    'اسم الشركة',
    'السجل التجاري',
    'المسؤول',
    'البريد الإلكتروني',
    'الجوال',
    'المدينة',
    'القطاع',
    'نوع احتياج',
    'حجم أو تكرار',
  ]) {
    assert.match(form, new RegExp(token));
  }
  assert.doesNotMatch(form, /banking|tax id|employee count|financial statement/i);
});

test('F-04 required validation works', () => {
  const errors = validateQualificationForm({ ...complete, companyName: '', city: '' });
  assert.equal(errors.companyName, 'اسم الشركة مطلوب.');
  assert.equal(errors.city, 'المدينة مطلوبة.');
});

test('F-05 optional business identifier may be omitted', () => {
  const errors = validateQualificationForm(complete);
  assert.equal(errors.businessIdentifier, undefined);
  assert.deepEqual(errors, {});
});

test('F-06 draft save uses backend when available — currently waiting', async () => {
  const form = await read('../components/readiness/qualification-form.tsx');
  assert.match(form, /WAITING_BACKEND/);
  assert.match(form, /حفظ مسودة \(غير متاح\)/);
  assert.match(form, /disabled/);
  assert.doesNotMatch(form, /تم الحفظ بنجاح|saved successfully/i);
});

test('F-07 submit calls real backend — currently waiting, not faked', async () => {
  const form = await read('../components/readiness/qualification-form.tsx');
  assert.match(form, /إرسال التأهيل \(غير متاح\)/);
  assert.doesNotMatch(form, /acceptPartnerQualification|qualification\/submit|تم الإرسال بنجاح/);
});

test('F-08 failed submit does not show success', async () => {
  const form = await read('../components/readiness/qualification-form.tsx');
  assert.match(form, /لم يُسجَّل أي إرسال/);
  assert.doesNotMatch(form, /statusMessage\('تم/);
});

test('F-09 approved/submitted states are read-only where contract requires', async () => {
  const form = await read('../components/readiness/qualification-form.tsx');
  assert.match(form, /UNDER_REVIEW/);
  assert.match(form, /APPROVED/);
  assert.match(form, /readOnlyBackend/);
  assert.equal(mapQualificationPresentation('APPROVED'), 'APPROVED');
  assert.equal(mapQualificationPresentation('UNDER_REVIEW'), 'UNDER_REVIEW');
});

test('F-10 agreement statuses render', async () => {
  const panel = await read('../components/readiness/agreements-panel.tsx');
  assert.match(panel, /AgreementsPanel/);
  assert.match(panel, /acceptPartnerAgreement/);
  assert.match(panel, /BINDING_CONFIDENTIALITY|السرية الملزمة/);
  assert.match(panel, /LIVE/);
});

test('F-11 document statuses render when API available — hidden when absent', async () => {
  const workspace = await read('../components/readiness/readiness-workspace.tsx');
  assert.match(workspace, /NOT SHOWN/);
  assert.match(workspace, /المستندات/);
  assert.doesNotMatch(workspace, /تم رفع المستند بنجاح|fakeUpload/);
});

test('F-12 RTL', async () => {
  const layout = await read('../app/layout.tsx');
  const css = await read('../components/readiness/readiness.module.css');
  assert.match(layout, /dir="rtl"/);
  assert.match(layout, /lang="ar"/);
  assert.match(css, /margin-inline|inset-inline|border-inline/);
});

test('F-13 mobile smoke styles present', async () => {
  const css = await read('../components/readiness/readiness.module.css');
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /width: 100%/);
});

test('F-14 no hidden future entitlements implied', async () => {
  const workspace = await read('../components/readiness/readiness-workspace.tsx');
  assert.doesNotMatch(workspace, /Procurement active|marketplace|قريبًا جدًا للشراء|بدء طلب شراء/);
  assert.match(workspace, /WAITING_BACKEND/);
  assert.match(workspace, /NOT SHOWN/);
  assert.match(workspace, /دون RFQ أو تفاوض/);
});
