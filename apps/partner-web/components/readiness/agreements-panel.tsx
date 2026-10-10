'use client';

import { ApiClientError, type PartnerAgreement } from '@sco/contracts';
import { useId, useState } from 'react';
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
  const dialogId = useId();
  const [busyType, setBusyType] = useState<string>();
  const [pending, setPending] = useState<PartnerAgreement | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const list = agreements ?? [];
  const focused = list.filter((item) => LAUNCH_AGREEMENT_FOCUS.has(item.agreementType));
  const extras = list.filter((item) => !LAUNCH_AGREEMENT_FOCUS.has(item.agreementType) && item.required);
  // Launch package only in primary list; do not promote non-launch types as first-class.
  const visible = focused.length ? focused : [];
  const ignoredExtras = extras.length;

  async function confirmAccept() {
    if (!pending || busyType) return;
    const agreement = pending;
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
      setPending(null);
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
    <section className={styles.panel} aria-labelledby="agree-title" data-testid="agreements-panel">
      <div className={styles.statusRow}>
        <h2 id="agree-title">الاتفاقيات</h2>
        <span className={styles.truth}>LIVE · حزمة الإطلاق</span>
      </div>
      <p className={styles.panelLead}>
        حزمة الإطلاق فقط: السرية الملزمة وشروط الشراكة. لا يُختَرع نص قانوني هنا — يُعرض ما تنشره سكو عبر
        الواجهة فقط.
      </p>

      {!agreements ? <p role="status">جارٍ تحميل الاتفاقيات...</p> : null}

      {agreements && visible.length === 0 ? (
        <p className={styles.note} role="status">
          لا توجد اتفاقيات إطلاق مطلوبة معروضة حاليًا لهذه الشركة.
        </p>
      ) : null}

      {ignoredExtras > 0 ? (
        <p className={styles.hint}>يُعرض مسار الإطلاق فقط؛ أنواع أخرى مطلوبة خارج هذا المسار غير مُروَّجة هنا.</p>
      ) : null}

      {visible.length > 0 ? (
        <ul className={styles.agreementList}>
          {visible.map((agreement) => {
            const reaccept = agreement.acceptanceStatus === 'REACCEPTANCE_REQUIRED';
            return (
              <li key={`${agreement.agreementType}:${agreement.version}`}>
                <div className={styles.statusRow}>
                  <strong>{agreementTypeLabelAr(agreement.agreementType)}</strong>
                  <span className={styles.badge}>{agreementStatusLabelAr(agreement.acceptanceStatus)}</span>
                  <span className={styles.hint}>الإصدار الحالي {agreement.version}</span>
                </div>
                {agreement.acceptedVersion ? (
                  <p className={styles.hint}>
                    آخر قبول مسجّل: إصدار {agreement.acceptedVersion}
                    {reaccept ? ' — يلزم قبول الإصدار الجديد دون محو القبول السابق.' : ''}
                  </p>
                ) : null}
                {agreement.effectiveAt ? (
                  <p className={styles.hint}>
                    ساري من {new Date(agreement.effectiveAt).toLocaleString('ar')}
                  </p>
                ) : null}
                {agreement.content ? (
                  <p className={styles.panelLead}>
                    {agreement.content.slice(0, 480)}
                    {agreement.content.length > 480 ? '…' : ''}
                  </p>
                ) : (
                  <p className={styles.hint}>لا يُعرض نص الاتفاقية هنا — الحالة والإصدار فقط من الخادم.</p>
                )}
                {agreement.actionable ? (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={Boolean(busyType)}
                    onClick={() => {
                      setError('');
                      setPending(agreement);
                    }}
                  >
                    {busyType === agreement.agreementType ? 'جارٍ القبول...' : 'أوافق على هذا الإصدار'}
                  </button>
                ) : null}
              </li>
            );
          })}
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

      {pending ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogId}
          className={styles.panel}
          data-testid="agreement-confirm-dialog"
        >
          <h3 id={dialogId}>تأكيد القبول</h3>
          <p>
            هل تؤكد قبول {agreementTypeLabelAr(pending.agreementType)} — الإصدار {pending.version}؟
          </p>
          <p className={styles.hint}>يُسجَّل القبول لدى سكو عبر واجهة القبول الرسمية فقط.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.button} disabled={Boolean(busyType)} onClick={() => void confirmAccept()}>
              تأكيد القبول
            </button>
            <button
              type="button"
              className={styles.buttonGhost}
              disabled={Boolean(busyType)}
              onClick={() => setPending(null)}
            >
              إلغاء
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
