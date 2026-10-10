'use client';

import { ApiClientError, type PartnerAgreement } from '@sco/contracts';
import { useState } from 'react';
import { readinessApi } from '../../lib/readiness-api';
import {
  LAUNCH_AGREEMENT_FOCUS,
  agreementStatusLabelAr,
  agreementTypeLabelAr,
} from './readiness-labels';
import styles from './readiness.module.css';

type Props = {
  companyId: string;
  agreements: PartnerAgreement[] | undefined;
  onAccepted: () => void;
};

export function AgreementsPanel({ companyId, agreements, onAccepted }: Props) {
  const [busyType, setBusyType] = useState<string>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const list = agreements ?? [];
  const focused = list.filter((item) => LAUNCH_AGREEMENT_FOCUS.has(item.agreementType));
  const extras = list.filter((item) => !LAUNCH_AGREEMENT_FOCUS.has(item.agreementType) && item.required);
  const visible = [...focused, ...extras];

  async function accept(agreement: PartnerAgreement) {
    if (!agreement.actionable || busyType) return;
    setBusyType(agreement.agreementType);
    setError('');
    setMessage('جارٍ تسجيل القبول...');
    try {
      const result = await readinessApi.acceptPartnerAgreement(companyId, {
        agreementType: agreement.agreementType,
        versionCode: agreement.version,
        idempotencyKey:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${agreement.agreementType}-${agreement.version}-${Date.now()}`,
      });
      setMessage(`تم تسجيل القبول: ${agreementTypeLabelAr(result.agreementType)} (${result.version}).`);
      onAccepted();
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        setError('انتهت الجلسة. أعد تسجيل الدخول.');
      } else if (failure instanceof ApiClientError && failure.status === 403) {
        setError('لا تملك صلاحية قبول هذه الاتفاقية.');
      } else if (failure instanceof ApiClientError && failure.code === 'CONFLICT') {
        setError('تعارض في حالة القبول. حدّث الصفحة وحاول مرة أخرى.');
      } else {
        setError('تعذر تسجيل القبول. حاول مرة أخرى.');
      }
      setMessage('');
    } finally {
      setBusyType(undefined);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="agree-title">
      <div className={styles.statusRow}>
        <h2 id="agree-title">الاتفاقيات</h2>
        <span className={styles.truth}>LIVE</span>
      </div>
      <p className={styles.panelLead}>
        حزمة الإطلاق: السرية الملزمة وشروط الشراكة عند نشرها. لا يُختَرع نص قانوني هنا — يُعرض ما
        تنشره سكو عبر الواجهة فقط.
      </p>

      {!agreements ? <p role="status">جارٍ تحميل الاتفاقيات...</p> : null}

      {agreements && visible.length === 0 ? (
        <p className={styles.note} role="status">
          لا توجد اتفاقيات مطلوبة معروضة حاليًا لهذه الشركة.
        </p>
      ) : null}

      {visible.length > 0 ? (
        <ul className={styles.agreementList}>
          {visible.map((agreement) => (
            <li key={`${agreement.agreementType}:${agreement.version}`}>
              <div className={styles.statusRow}>
                <strong>{agreementTypeLabelAr(agreement.agreementType)}</strong>
                <span className={styles.badge}>{agreementStatusLabelAr(agreement.acceptanceStatus)}</span>
                <span className={styles.hint}>إصدار {agreement.version}</span>
              </div>
              {agreement.content ? (
                <p className={styles.panelLead}>{agreement.content.slice(0, 280)}{agreement.content.length > 280 ? '…' : ''}</p>
              ) : (
                <p className={styles.hint}>لا يُعرض نص الاتفاقية في هذه الخلاصة — الحالة فقط.</p>
              )}
              {agreement.actionable ? (
                <button
                  type="button"
                  className={styles.button}
                  disabled={Boolean(busyType)}
                  onClick={() => void accept(agreement)}
                >
                  {busyType === agreement.agreementType ? 'جارٍ القبول...' : 'أوافق على هذه الاتفاقية'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {!list.some((item) => item.agreementType === 'PARTNERSHIP_TERMS') ? (
        <p className={styles.hint}>شروط الشراكة تظهر هنا عند نشر سياسة بهذا النوع من سكو.</p>
      ) : null}

      <div className={styles.liveRegion} aria-live="polite">
        {message}
        {error ? (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
