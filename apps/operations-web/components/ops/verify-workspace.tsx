'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useMemo, useState } from 'react';
import { ApiClientError } from '@sco/contracts';
import { api } from '../../lib/api';
import { mapOpsError } from './safe-error';
import styles from './ops.module.css';

type Props = { requestId: string };

/**
 * Analyst + Approver workspace.
 * Raw evidence is not rendered — VERIFY_RAW_REVIEW_ACCESS has no HTTP delivery surface yet.
 * Coverage/classification come from backend prepare/approve responses only.
 */
export function VerifyWorkspace({ requestId }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const initialRevisionId = search.get('revisionId') || '';
  const initialRunId = search.get('runId') || '';
  const initialResultId = search.get('resultId') || '';

  const [revisionId, setRevisionId] = useState(initialRevisionId);
  const [runId, setRunId] = useState(initialRunId);
  const [resultId, setResultId] = useState(initialResultId);
  const [methodologyVersion, setMethodologyVersion] = useState('v1');
  const [evidenceFingerprint, setEvidenceFingerprint] = useState('');
  const [lineId, setLineId] = useState('');
  const [lineOutcome, setLineOutcome] = useState<'VERIFIED' | 'INSUFFICIENT_EVIDENCE' | 'EXCLUDED'>('VERIFIED');
  const [lineReason, setLineReason] = useState('');
  const [offerValue, setOfferValue] = useState('{}');
  const [verifiedReferenceScope, setVerifiedReferenceScope] = useState('{}');
  const [gap, setGap] = useState('{}');
  const [confidence, setConfidence] = useState('{}');
  const [proposedAction, setProposedAction] = useState('HOLD_FOR_CLARIFICATION');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [confirmApprove, setConfirmApprove] = useState(false);

  const partnerPreview = useMemo(
    () => ({
      requestId,
      proposedAction,
      note: 'معاينة ما سيُعرض للشريك تقتصر على الحقول المصرّح بها في عقد النتيجة. لا تُعرض أدلة خام هنا.',
    }),
    [requestId, proposedAction],
  );

  function parseJson(label: string, raw: string): unknown {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      throw new Error(`${label}_JSON_INVALID`);
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await action();
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      if (failure instanceof Error && failure.message.endsWith('_JSON_INVALID')) {
        setError('تحقق من صيغة JSON في حقول التحليل.');
      } else {
        setError(mapOpsError(failure, 'تعذر إكمال إجراء التوثيق.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.split}>
      <section className={styles.panel} aria-labelledby="analyst-title">
        <h2 id="analyst-title">مساحة المحلل</h2>
        <p className={styles.muted}>طلب: <span dir="ltr">{requestId}</span></p>
        <dl className={styles.dl}>
          <div>
            <dt>المراجعة الحالية</dt>
            <dd dir="ltr">{revisionId || '—'}</dd>
          </div>
          <div>
            <dt>التشغيل</dt>
            <dd dir="ltr">{runId || '—'}</dd>
          </div>
          <div>
            <dt>النتيجة</dt>
            <dd dir="ltr">{resultId || '—'}</dd>
          </div>
        </dl>

        <label className={styles.field}>
          معرّف المراجعة (revision)
          <input dir="ltr" value={revisionId} disabled={busy} onChange={(e) => setRevisionId(e.target.value)} />
        </label>
        <label className={styles.field}>
          إصدار المنهجية
          <input value={methodologyVersion} disabled={busy} onChange={(e) => setMethodologyVersion(e.target.value)} />
        </label>
        <label className={styles.field}>
          بصمة الدليل
          <input
            dir="ltr"
            value={evidenceFingerprint}
            disabled={busy}
            onChange={(e) => setEvidenceFingerprint(e.target.value)}
            placeholder="fingerprint"
          />
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={busy || !revisionId || !evidenceFingerprint}
            onClick={() =>
              void run(async () => {
                const started = await api.internalVerifyStartRun(revisionId, {
                  methodologyVersion,
                  evidenceFingerprint,
                });
                setRunId(started.runId);
                setMessage(`بدأ التشغيل · ${started.status}`);
              })
            }
          >
            بدء تشغيل تحليل
          </button>
        </div>

        <label className={styles.field}>
          معرّف السطر
          <input dir="ltr" value={lineId} disabled={busy} onChange={(e) => setLineId(e.target.value)} />
        </label>
        <label className={styles.field}>
          نتيجة السطر
          <select value={lineOutcome} disabled={busy} onChange={(e) => setLineOutcome(e.target.value as typeof lineOutcome)}>
            <option value="VERIFIED">موثّق</option>
            <option value="INSUFFICIENT_EVIDENCE">دليل غير كافٍ</option>
            <option value="EXCLUDED">مستبعد</option>
          </select>
        </label>
        <label className={styles.field}>
          سبب (اختياري)
          <input value={lineReason} disabled={busy} onChange={(e) => setLineReason(e.target.value)} />
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.buttonGhost}
            disabled={busy || !runId || !lineId}
            onClick={() =>
              void run(async () => {
                await api.internalVerifyLineResult(runId, lineId, {
                  outcome: lineOutcome,
                  reason: lineReason || undefined,
                });
                setMessage('تم تسجيل نتيجة السطر.');
              })
            }
          >
            حفظ نتيجة السطر
          </button>
          <button
            type="button"
            className={styles.buttonGhost}
            disabled={busy || !runId}
            onClick={() =>
              void run(async () => {
                const completed = await api.internalVerifyCompleteRun(runId);
                setMessage(`اكتمل التشغيل · ${completed.status}`);
              })
            }
          >
            إكمال التشغيل
          </button>
        </div>

        <h3 style={{ margin: '0.5rem 0 0', fontSize: '1.05rem' }}>تحليل تشغيلي (عقد Codex1)</h3>
        <label className={styles.field}>
          offerValue (JSON)
          <textarea dir="ltr" value={offerValue} disabled={busy} onChange={(e) => setOfferValue(e.target.value)} />
        </label>
        <label className={styles.field}>
          verifiedReferenceScope (JSON)
          <textarea
            dir="ltr"
            value={verifiedReferenceScope}
            disabled={busy}
            onChange={(e) => setVerifiedReferenceScope(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          gap (JSON)
          <textarea dir="ltr" value={gap} disabled={busy} onChange={(e) => setGap(e.target.value)} />
        </label>
        <label className={styles.field}>
          confidence (JSON)
          <textarea dir="ltr" value={confidence} disabled={busy} onChange={(e) => setConfidence(e.target.value)} />
        </label>
        <label className={styles.field}>
          الإجراء المقترح
          <input value={proposedAction} disabled={busy} onChange={(e) => setProposedAction(e.target.value)} maxLength={120} />
        </label>
        <button
          type="button"
          className={styles.button}
          disabled={busy || !runId}
          onClick={() =>
            void run(async () => {
              const prepared = await api.internalVerifyPrepareAnalysis(runId, {
                offerValue: parseJson('offerValue', offerValue),
                verifiedReferenceScope: parseJson('scope', verifiedReferenceScope),
                gap: parseJson('gap', gap),
                confidence: parseJson('confidence', confidence),
                proposedAction: proposedAction.trim(),
              });
              setResultId(prepared.resultId);
              setMessage(`أُعدّت النتيجة · ${prepared.status}. التغطية/التصنيف يُحسبان في الخادم.`);
            })
          }
        >
          حفظ التحليل (PREPARED)
        </button>
        <p className={styles.note}>
          الأدلة الخام غير معروضة: لا يوجد سطح HTTP لتسليم raw review بعد. إن وُجدت صلاحية raw لاحقًا فستُربط بسطح
          خلفي مصرّح فقط.
        </p>
      </section>

      <section className={styles.panel} aria-labelledby="approver-title">
        <h2 id="approver-title">مساحة المعتمد</h2>
        <p className={styles.muted}>الاعتماد لا يغيّر نتيجة التحليل بصمت — يستدعي إنهاء النتيجة فقط.</p>
        <div className={styles.confirmBox}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>معاينة مخرجات الشريك</h3>
          <dl className={styles.dl}>
            <div>
              <dt>الطلب</dt>
              <dd dir="ltr">{partnerPreview.requestId}</dd>
            </div>
            <div>
              <dt>الإجراء المقترح</dt>
              <dd>{partnerPreview.proposedAction}</dd>
            </div>
            <div>
              <dt>ملاحظة</dt>
              <dd>{partnerPreview.note}</dd>
            </div>
          </dl>
        </div>
        <label className={styles.field}>
          معرّف النتيجة للاعتماد
          <input dir="ltr" value={resultId} disabled={busy} onChange={(e) => setResultId(e.target.value)} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={confirmApprove}
            disabled={busy}
            onChange={(e) => setConfirmApprove(e.target.checked)}
          />{' '}
          أؤكد اعتماد النتيجة الظاهرة للشريك دون تعديل صامت.
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={busy || !resultId || !confirmApprove}
            onClick={() =>
              void run(async () => {
                const approved = await api.internalVerifyApproveResult(resultId);
                setMessage(`تم الاعتماد · ${approved.status}`);
                setConfirmApprove(false);
              })
            }
          >
            اعتماد النتيجة
          </button>
          <Link href="/verify" className={styles.buttonGhost}>
            العودة للطابور
          </Link>
        </div>
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className={styles.ok} role="status">
            {message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
