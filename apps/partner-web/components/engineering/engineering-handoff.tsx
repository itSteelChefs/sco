'use client';

import { useId, useRef, useState } from 'react';
import { engineeringApi, EngineeringWaitingError } from '../../lib/engineering-api';
import { canHandoffToProcurement } from './engineering-guards.mjs';
import type { PartnerEngineeringRequestDetail } from './engineering-types';
import styles from './engineering.module.css';

type Props = {
  companyId: string;
  detail: PartnerEngineeringRequestDetail;
  onDone: () => void;
};

export function EngineeringHandoffPanel({ companyId, detail, onDone }: Props) {
  const dialogId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [createdRef, setCreatedRef] = useState<string | null>(
    detail.handoff.procurementRequirementReference ?? detail.handoff.procurementRequirementId ?? null,
  );
  const idempotencyKey = useRef<string | null>(null);
  const allowed = canHandoffToProcurement(detail) && engineeringApi.canHandoffApi();
  const already = Boolean(detail.handoff.handedOff || createdRef);

  async function confirmHandoff() {
    if (!allowed || busy) return;
    if (!idempotencyKey.current) {
      idempotencyKey.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `f2d-${Date.now()}`;
    }
    setBusy(true);
    setError('');
    setMessage('جارٍ إنشاء طلب المشتريات...');
    try {
      const current = detail.resultVersions.find((item) => item.isCurrent);
      const result = await engineeringApi.createProcurement(companyId, detail.requestId, {
        resultVersionId: current?.versionId,
        idempotencyKey: idempotencyKey.current,
      });
      const ref = result.procurementRequirementReference ?? result.procurementRequirementId;
      setCreatedRef(ref);
      setMessage('تم إنشاء طلب المشتريات.');
      setConfirmOpen(false);
      onDone();
    } catch (failure) {
      setMessage('');
      if (failure instanceof EngineeringWaitingError) {
        setError('إنشاء طلب المشتريات بانتظار واجهة الخادم.');
      } else {
        setError('تعذر إنشاء طلب المشتريات.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="eng-handoff-title" data-testid="engineering-handoff">
      <h2 id="eng-handoff-title">التسليم إلى المشتريات</h2>
      <p className={styles.panelLead}>من الدراسة المعتمدة فقط — دون تكرار إنشاء طلب عند إعادة الضغط على نفس العملية.</p>

      {already ? (
        <div className={styles.note} role="status" data-testid="engineering-handoff-done">
          <p>تم إنشاء طلب المشتريات.</p>
          {createdRef ? (
            <p data-testid="engineering-handoff-reference">
              مرجع طلب المشتريات: <strong className={styles.mixed}>{createdRef}</strong>
            </p>
          ) : null}
          {!detail.handoff.canCreateHandoff ? (
            <p className={styles.hint}>لا يتاح إنشاء تسليم مكرر ما لم يسمح الخادم بذلك صراحة.</p>
          ) : null}
        </div>
      ) : null}

      {!already && !allowed ? (
        <p className={styles.hint} role="status" data-testid="engineering-handoff-blocked">
          إنشاء طلب المشتريات متاح فقط بعد اعتماد الدراسة وعند توفر واجهة التسليم.
        </p>
      ) : null}

      {!already && allowed ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            data-testid="engineering-handoff-cta"
            disabled={busy}
            onClick={() => {
              setError('');
              setConfirmOpen(true);
            }}
          >
            إنشاء طلب مشتريات من هذه الدراسة
          </button>
        </div>
      ) : null}

      {confirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogId}
          className={styles.dialog}
          data-testid="engineering-handoff-confirm"
        >
          <h3 id={dialogId}>تأكيد إنشاء طلب المشتريات</h3>
          <p>سيتم إنشاء طلب مشتريات من الإصدار المعتمد الحالي لهذه الدراسة. هل تؤكد؟</p>
          <div className={styles.actions}>
            <button type="button" className={styles.button} disabled={busy} onClick={() => void confirmHandoff()}>
              تأكيد الإنشاء
            </button>
            <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setConfirmOpen(false)}>
              إلغاء
            </button>
          </div>
        </div>
      ) : null}

      <div aria-live="polite">
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
