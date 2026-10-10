'use client';

import { FormEvent, useMemo, useState } from 'react';
import {
  NEED_OPTIONS,
  SECTOR_OPTIONS,
  SIZE_OPTIONS,
  mapQualificationPresentation,
  qualificationLabelAr,
} from './readiness-labels';
import { validateQualificationForm } from './qualification-validation.mjs';
import styles from './readiness.module.css';

type QualificationFormValues = {
  companyName: string;
  businessIdentifier: string;
  responsiblePerson: string;
  contactEmail: string;
  contactMobile: string;
  city: string;
  sector: string;
  needType: string;
  procurementSize: string;
};

const EMPTY: QualificationFormValues = {
  companyName: '',
  businessIdentifier: '',
  responsiblePerson: '',
  contactEmail: '',
  contactMobile: '',
  city: '',
  sector: '',
  needType: '',
  procurementSize: '',
};

type Props = {
  qualificationStatus: string | null | undefined;
  companyNameHint?: string;
};

export function QualificationForm({ qualificationStatus, companyNameHint }: Props) {
  const presentation = mapQualificationPresentation(qualificationStatus);
  const readOnlyBackend = presentation === 'UNDER_REVIEW' || presentation === 'APPROVED';
  const [values, setValues] = useState<QualificationFormValues>({
    ...EMPTY,
    companyName: companyNameHint ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showReview, setShowReview] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const completeness = useMemo(() => Object.keys(validateQualificationForm(values)).length === 0, [values]);

  function update<K extends keyof QualificationFormValues>(key: K, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function onReview(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = { ...validateQualificationForm(values) };
    setErrors(next);
    if (Object.keys(next).length) {
      setShowReview(false);
      setStatusMessage('أكمل الحقول المطلوبة قبل المراجعة.');
      return;
    }
    setShowReview(true);
    setStatusMessage('المراجعة جاهزة. الإرسال غير متاح حتى يتوفر مسار الشريك في الخادم.');
  }

  function onDisabledPersist(kind: 'draft' | 'submit') {
    setStatusMessage(
      kind === 'draft'
        ? 'حفظ المسودة غير متاح: مسار الشريك في الخادم غير مُنفَّذ بعد (WAITING_BACKEND).'
        : 'الإرسال غير متاح: مسار الشريك في الخادم غير مُنفَّذ بعد (WAITING_BACKEND). لم يُسجَّل أي إرسال.',
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="qual-title">
      <div className={styles.statusRow}>
        <h2 id="qual-title">التأهيل</h2>
        <span className={`${styles.badge} ${styles.badgeAccent}`}>{qualificationLabelAr(presentation)}</span>
        <span className={styles.truth}>LIVE status · form WAITING_BACKEND</span>
      </div>
      <p className={styles.panelLead}>
        مسار التأهيل الأساسي للشريك. الحفظ والإرسال يعتمدان على واجهة شريك حقيقية — لا يُعرض نجاح وهمي.
      </p>

      {readOnlyBackend ? (
        <p className={styles.note} role="status">
          حالة التأهيل الحالية من سكو: {qualificationStatus}. النموذج للقراءة فقط في هذه الحالة.
        </p>
      ) : null}

      <form className={styles.form} onSubmit={onReview} noValidate>
        <fieldset className={styles.fieldset} disabled={readOnlyBackend}>
          <legend>بيانات الإطلاق</legend>

          <div className={styles.field}>
            <label htmlFor="qual-company">اسم الشركة</label>
            <input
              id="qual-company"
              name="companyName"
              value={values.companyName}
              onChange={(e) => update('companyName', e.target.value)}
              autoComplete="organization"
              required
              aria-invalid={Boolean(errors.companyName)}
              aria-describedby={errors.companyName ? 'qual-company-error' : undefined}
            />
            {errors.companyName ? (
              <p id="qual-company-error" className={styles.fieldError} role="alert">
                {errors.companyName}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-cr">السجل التجاري / المعرّف التجاري (إن وُجد)</label>
            <input
              id="qual-cr"
              name="businessIdentifier"
              value={values.businessIdentifier}
              onChange={(e) => update('businessIdentifier', e.target.value)}
              aria-describedby="qual-cr-hint"
            />
            <p id="qual-cr-hint" className={styles.hint}>
              اختياري — لا يُفترض وجود نفس نوع المعرّف لكل منشأة.
            </p>
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-person">المسؤول</label>
            <input
              id="qual-person"
              name="responsiblePerson"
              value={values.responsiblePerson}
              onChange={(e) => update('responsiblePerson', e.target.value)}
              autoComplete="name"
              required
              aria-invalid={Boolean(errors.responsiblePerson)}
              aria-describedby={errors.responsiblePerson ? 'qual-person-error' : undefined}
            />
            {errors.responsiblePerson ? (
              <p id="qual-person-error" className={styles.fieldError} role="alert">
                {errors.responsiblePerson}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-email">البريد الإلكتروني</label>
            <input
              id="qual-email"
              name="contactEmail"
              type="email"
              value={values.contactEmail}
              onChange={(e) => update('contactEmail', e.target.value)}
              autoComplete="email"
              aria-invalid={Boolean(errors.contactEmail || errors.contact)}
              aria-describedby={errors.contactEmail || errors.contact ? 'qual-contact-error' : undefined}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-mobile">الجوال</label>
            <input
              id="qual-mobile"
              name="contactMobile"
              type="tel"
              value={values.contactMobile}
              onChange={(e) => update('contactMobile', e.target.value)}
              autoComplete="tel"
              aria-invalid={Boolean(errors.contact)}
            />
            {errors.contact || errors.contactEmail ? (
              <p id="qual-contact-error" className={styles.fieldError} role="alert">
                {errors.contactEmail ?? errors.contact}
              </p>
            ) : (
              <p className={styles.hint}>يلزم وسيلة تواصل واحدة على الأقل (بريد أو جوال).</p>
            )}
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-city">المدينة</label>
            <input
              id="qual-city"
              name="city"
              value={values.city}
              onChange={(e) => update('city', e.target.value)}
              required
              aria-invalid={Boolean(errors.city)}
              aria-describedby={errors.city ? 'qual-city-error' : undefined}
            />
            {errors.city ? (
              <p id="qual-city-error" className={styles.fieldError} role="alert">
                {errors.city}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-sector">القطاع</label>
            <select
              id="qual-sector"
              name="sector"
              value={values.sector}
              onChange={(e) => update('sector', e.target.value)}
              required
              aria-invalid={Boolean(errors.sector)}
            >
              <option value="">اختر القطاع</option>
              {SECTOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.sector ? (
              <p className={styles.fieldError} role="alert">
                {errors.sector}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-need">نوع احتياج المشتريات / الهندسة</label>
            <select
              id="qual-need"
              name="needType"
              value={values.needType}
              onChange={(e) => update('needType', e.target.value)}
              required
            >
              <option value="">اختر الاحتياج</option>
              {NEED_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.needType ? (
              <p className={styles.fieldError} role="alert">
                {errors.needType}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-size">حجم أو تكرار المشتريات التقريبي</label>
            <select
              id="qual-size"
              name="procurementSize"
              value={values.procurementSize}
              onChange={(e) => update('procurementSize', e.target.value)}
              required
            >
              <option value="">اختر التقدير</option>
              {SIZE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.procurementSize ? (
              <p className={styles.fieldError} role="alert">
                {errors.procurementSize}
              </p>
            ) : null}
          </div>
        </fieldset>

        <p className={styles.truth}>اكتمال الحقول (عرض فقط): {completeness ? 'مكتمل' : 'ناقص'}</p>

        <div className={styles.actions}>
          <button type="submit" className={styles.buttonGhost} disabled={readOnlyBackend}>
            مراجعة قبل الإرسال
          </button>
          <button
            type="button"
            className={styles.buttonGhost}
            disabled
            aria-disabled="true"
            title="WAITING_BACKEND"
            onClick={() => onDisabledPersist('draft')}
          >
            حفظ مسودة (غير متاح)
          </button>
          <button
            type="button"
            className={styles.button}
            disabled
            aria-disabled="true"
            title="WAITING_BACKEND"
            onClick={() => onDisabledPersist('submit')}
          >
            إرسال التأهيل (غير متاح)
          </button>
        </div>
      </form>

      <div className={styles.liveRegion} aria-live="polite" aria-atomic="true">
        {statusMessage}
      </div>

      {showReview ? (
        <div className={styles.panel} aria-labelledby="qual-review-title">
          <h2 id="qual-review-title">ملخص المراجعة</h2>
          <dl className={styles.summaryGrid}>
            <dt>الشركة</dt>
            <dd>{values.companyName}</dd>
            <dt>المعرّف التجاري</dt>
            <dd>{values.businessIdentifier.trim() || '— (غير متوفر)'}</dd>
            <dt>المسؤول</dt>
            <dd>{values.responsiblePerson}</dd>
            <dt>التواصل</dt>
            <dd>
              {[values.contactEmail, values.contactMobile].filter(Boolean).join(' · ') || '—'}
            </dd>
            <dt>المدينة</dt>
            <dd>{values.city}</dd>
            <dt>القطاع</dt>
            <dd>{SECTOR_OPTIONS.find((o) => o.value === values.sector)?.label ?? values.sector}</dd>
            <dt>الاحتياج</dt>
            <dd>{NEED_OPTIONS.find((o) => o.value === values.needType)?.label ?? values.needType}</dd>
            <dt>الحجم/التكرار</dt>
            <dd>
              {SIZE_OPTIONS.find((o) => o.value === values.procurementSize)?.label ?? values.procurementSize}
            </dd>
          </dl>
          <p className={styles.note}>
            الإرسال معطّل عمدًا — لا يوجد مسار شريك لحفظ/إرسال مسودة التأهيل في الخادم حاليًا.
          </p>
        </div>
      ) : null}
    </section>
  );
}
