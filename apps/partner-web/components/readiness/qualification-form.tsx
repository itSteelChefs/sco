'use client';

import { ApiClientError, type PartnerQualification } from '@sco/contracts';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { readinessApi } from '../../lib/readiness-api';
import {
  FREQUENCY_OPTIONS,
  NEED_OPTIONS,
  SECTOR_OPTIONS,
  SIZE_OPTIONS,
  mapQualificationPresentation,
  qualificationLabelAr,
} from './readiness-labels';
import { toDraftBody, validateQualificationForm } from './qualification-validation.mjs';
import styles from './readiness.module.css';

type FormValues = {
  companyName: string;
  commercialIdentifier: string;
  responsiblePerson: string;
  contact: string;
  city: string;
  sector: string;
  needType: string;
  procurementSize: string;
  procurementFrequency: string;
};

const EMPTY: FormValues = {
  companyName: '',
  commercialIdentifier: '',
  responsiblePerson: '',
  contact: '',
  city: '',
  sector: '',
  needType: '',
  procurementSize: '',
  procurementFrequency: '',
};

type Props = {
  companyId: string;
  companyNameHint?: string;
  onChanged?: () => void;
};

function fromQualification(q: PartnerQualification | null, hint?: string): FormValues {
  if (!q) return { ...EMPTY, companyName: hint ?? '' };
  return {
    companyName: q.companyName ?? hint ?? '',
    commercialIdentifier: q.commercialIdentifier ?? '',
    responsiblePerson: q.responsiblePerson ?? '',
    contact: q.contact ?? '',
    city: q.city ?? '',
    sector: q.sector ?? '',
    needType: q.needType ?? '',
    procurementSize: q.procurementSize ?? '',
    procurementFrequency: q.procurementFrequency ?? '',
  };
}

function mapSaveError(failure: unknown): string {
  if (!(failure instanceof ApiClientError)) return 'تعذر حفظ المسودة. حاول مرة أخرى.';
  if (failure.status === 401) return 'انتهت الجلسة. أعد تسجيل الدخول.';
  if (failure.status === 403) return 'لا تملك صلاحية حفظ مسودة التأهيل.';
  if (failure.code === 'QUALIFICATION_ALREADY_SUBMITTED' || failure.status === 409) {
    return 'التأهيل مُرسَل مسبقًا ولا يمكن تعديل المسودة.';
  }
  if (failure.code === 'VALIDATION_FAILED' || failure.status === 400) return 'تحقق من الحقول المطلوبة.';
  return 'تعذر حفظ المسودة. حاول مرة أخرى.';
}

export function QualificationForm({ companyId, companyNameHint, onChanged }: Props) {
  const [qualification, setQualification] = useState<PartnerQualification | null>();
  const [values, setValues] = useState<FormValues>({ ...EMPTY, companyName: companyNameHint ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'submitting' | 'failed'>('loading');
  const [statusMessage, setStatusMessage] = useState('');
  const [showReview, setShowReview] = useState(false);

  const status = qualification?.status ?? 'NONE';
  const presentation = mapQualificationPresentation(status);
  const readOnly = status === 'SUBMITTED' || status === 'UNDER_REVIEW' || status === 'APPROVED';

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setStatusMessage('جارٍ تحميل التأهيل...');
    void readinessApi
      .qualificationCurrent(companyId)
      .then((current) => {
        if (cancelled) return;
        setQualification(current);
        setValues(fromQualification(current, companyNameHint));
        setPhase('idle');
        setStatusMessage(current ? `الحالة: ${current.status}` : 'لا توجد مسودة بعد — ابدأ بالحفظ لإنشائها.');
      })
      .catch((failure) => {
        if (cancelled) return;
        if (failure instanceof ApiClientError && failure.status === 401) {
          setStatusMessage('انتهت الجلسة.');
          return;
        }
        setPhase('failed');
        setStatusMessage(mapSaveError(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, companyNameHint]);

  const completeness = useMemo(() => Object.keys(validateQualificationForm(values)).length === 0, [values]);

  function update<K extends keyof FormValues>(key: K, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    if (phase === 'saved') setPhase('idle');
  }

  async function saveDraft() {
    const next = { ...validateQualificationForm(values) } as Record<string, string>;
    setErrors(next);
    if (Object.keys(next).length) {
      setPhase('failed');
      setStatusMessage('أكمل الحقول المطلوبة قبل الحفظ.');
      return;
    }
    setPhase('saving');
    setStatusMessage('جارٍ الحفظ...');
    try {
      const body = toDraftBody(values);
      const saved = qualification
        ? await readinessApi.qualificationSaveDraft(companyId, body)
        : await readinessApi.qualificationCreateDraft(companyId, body);
      setQualification(saved);
      setValues(fromQualification(saved, companyNameHint));
      setPhase('saved');
      setStatusMessage(`تم الحفظ · الحالة ${saved.status} · ${new Date(saved.updatedAt).toLocaleString('ar')}`);
      onChanged?.();
    } catch (failure) {
      setPhase('failed');
      setStatusMessage(mapSaveError(failure));
      if (failure instanceof ApiClientError && (failure.code === 'QUALIFICATION_ALREADY_SUBMITTED' || failure.status === 409)) {
        const current = await readinessApi.qualificationCurrent(companyId).catch(() => null);
        if (current) {
          setQualification(current);
          setValues(fromQualification(current, companyNameHint));
        }
      }
    }
  }

  function onReview(event: FormEvent) {
    event.preventDefault();
    const next = { ...validateQualificationForm(values) } as Record<string, string>;
    setErrors(next);
    if (Object.keys(next).length) {
      setShowReview(false);
      setStatusMessage('أكمل الحقول المطلوبة قبل المراجعة.');
      return;
    }
    setShowReview(true);
    setStatusMessage('راجع الملخص ثم أرسل عند الجاهزية.');
  }

  async function submitQualification() {
    if (readOnly) return;
    setPhase('submitting');
    setStatusMessage('جارٍ الإرسال...');
    try {
      if (!qualification || qualification.status === 'DRAFT') {
        const body = toDraftBody(values);
        await (qualification
          ? readinessApi.qualificationSaveDraft(companyId, body)
          : readinessApi.qualificationCreateDraft(companyId, body));
      }
      const submitted = await readinessApi.qualificationSubmit(companyId);
      setQualification(submitted);
      setValues(fromQualification(submitted, companyNameHint));
      setPhase('saved');
      setStatusMessage(`تم الإرسال · الحالة ${submitted.status}`);
      setShowReview(false);
      onChanged?.();
    } catch (failure) {
      setPhase('failed');
      if (failure instanceof ApiClientError && failure.status === 409) {
        setStatusMessage('التأهيل مُرسَل مسبقًا.');
        const current = await readinessApi.qualificationCurrent(companyId).catch(() => null);
        if (current) {
          setQualification(current);
          setValues(fromQualification(current, companyNameHint));
        }
      } else {
        setStatusMessage(mapSaveError(failure));
      }
    }
  }

  if (phase === 'loading' && qualification === undefined) {
    return (
      <section className={styles.panel}>
        <p role="status">جارٍ تحميل التأهيل...</p>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="qual-title" data-testid="qualification-form">
      <div className={styles.statusRow}>
        <h2 id="qual-title">التأهيل</h2>
        <span className={`${styles.badge} ${styles.badgeAccent}`}>{qualificationLabelAr(presentation)}</span>
        <span className={styles.truth}>LIVE</span>
      </div>
      <p className={styles.panelLead}>مسار التأهيل الذاتي للشريك — الحفظ والإرسال عبر واجهة سكو الحقيقية.</p>

      {readOnly ? (
        <p className={styles.note} role="status">
          الحالة {status} — النموذج للقراءة فقط.
        </p>
      ) : null}

      <form className={styles.form} onSubmit={onReview} noValidate>
        <fieldset className={styles.fieldset} disabled={readOnly || phase === 'saving' || phase === 'submitting'}>
          <legend>بيانات الإطلاق</legend>

          <div className={styles.field}>
            <label htmlFor="qual-company">اسم الشركة</label>
            <input id="qual-company" value={values.companyName} onChange={(e) => update('companyName', e.target.value)} required aria-invalid={Boolean(errors.companyName)} />
            {errors.companyName ? <p className={styles.fieldError} role="alert">{errors.companyName}</p> : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-cr">السجل التجاري / المعرّف التجاري (إن وُجد)</label>
            <input id="qual-cr" value={values.commercialIdentifier} onChange={(e) => update('commercialIdentifier', e.target.value)} aria-describedby="qual-cr-hint" />
            <p id="qual-cr-hint" className={styles.hint}>اختياري.</p>
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-person">المسؤول</label>
            <input id="qual-person" value={values.responsiblePerson} onChange={(e) => update('responsiblePerson', e.target.value)} required />
            {errors.responsiblePerson ? <p className={styles.fieldError} role="alert">{errors.responsiblePerson}</p> : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-contact">البريد الإلكتروني للتواصل</label>
            <input id="qual-contact" type="email" value={values.contact} onChange={(e) => update('contact', e.target.value)} required autoComplete="email" />
            {errors.contact ? <p className={styles.fieldError} role="alert">{errors.contact}</p> : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-city">المدينة</label>
            <input id="qual-city" value={values.city} onChange={(e) => update('city', e.target.value)} required />
            {errors.city ? <p className={styles.fieldError} role="alert">{errors.city}</p> : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-sector">القطاع</label>
            <select id="qual-sector" value={values.sector} onChange={(e) => update('sector', e.target.value)} required>
              <option value="">اختر القطاع</option>
              {SECTOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {errors.sector ? <p className={styles.fieldError} role="alert">{errors.sector}</p> : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-need">نوع احتياج المشتريات / الهندسة</label>
            <select id="qual-need" value={values.needType} onChange={(e) => update('needType', e.target.value)} required>
              <option value="">اختر الاحتياج</option>
              {NEED_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {errors.needType ? <p className={styles.fieldError} role="alert">{errors.needType}</p> : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-size">حجم المشتريات التقريبي</label>
            <select id="qual-size" value={values.procurementSize} onChange={(e) => update('procurementSize', e.target.value)} required>
              <option value="">اختر الحجم</option>
              {SIZE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {errors.procurementSize ? <p className={styles.fieldError} role="alert">{errors.procurementSize}</p> : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="qual-freq">تكرار المشتريات التقريبي</label>
            <select id="qual-freq" value={values.procurementFrequency} onChange={(e) => update('procurementFrequency', e.target.value)} required>
              <option value="">اختر التكرار</option>
              {FREQUENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {errors.procurementFrequency ? <p className={styles.fieldError} role="alert">{errors.procurementFrequency}</p> : null}
          </div>
        </fieldset>

        <p className={styles.truth}>اكتمال الحقول (عرض): {completeness ? 'مكتمل' : 'ناقص'}</p>

        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={readOnly || phase === 'saving'} onClick={() => void saveDraft()}>
            {phase === 'saving' ? 'جارٍ الحفظ...' : 'حفظ المسودة'}
          </button>
          <button type="submit" className={styles.buttonGhost} disabled={readOnly}>
            مراجعة قبل الإرسال
          </button>
          <button type="button" className={styles.button} disabled={readOnly || !showReview || phase === 'submitting'} onClick={() => void submitQualification()}>
            {phase === 'submitting' ? 'جارٍ الإرسال...' : 'إرسال التأهيل'}
          </button>
        </div>
      </form>

      <div className={styles.liveRegion} aria-live="polite" aria-atomic="true" data-phase={phase}>
        {statusMessage}
      </div>

      {showReview && !readOnly ? (
        <div className={styles.panel} aria-labelledby="qual-review-title">
          <h2 id="qual-review-title">ملخص المراجعة</h2>
          <dl className={styles.summaryGrid}>
            <dt>الشركة</dt><dd>{values.companyName}</dd>
            <dt>المعرّف</dt><dd>{values.commercialIdentifier.trim() || '—'}</dd>
            <dt>المسؤول</dt><dd>{values.responsiblePerson}</dd>
            <dt>التواصل</dt><dd>{values.contact}</dd>
            <dt>المدينة</dt><dd>{values.city}</dd>
            <dt>القطاع</dt><dd>{SECTOR_OPTIONS.find((o) => o.value === values.sector)?.label ?? values.sector}</dd>
            <dt>الاحتياج</dt><dd>{NEED_OPTIONS.find((o) => o.value === values.needType)?.label ?? values.needType}</dd>
            <dt>الحجم</dt><dd>{SIZE_OPTIONS.find((o) => o.value === values.procurementSize)?.label ?? values.procurementSize}</dd>
            <dt>التكرار</dt><dd>{FREQUENCY_OPTIONS.find((o) => o.value === values.procurementFrequency)?.label ?? values.procurementFrequency}</dd>
          </dl>
        </div>
      ) : null}
    </section>
  );
}
