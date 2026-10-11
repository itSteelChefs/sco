'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ApiClientError, type InternalQualificationDecisionStatus, type InternalQualificationListItem } from '@sco/contracts';
import { api } from '../../lib/api';
import { formatWhen, qualificationStatusAr } from '../../lib/labels';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import styles from './ops.module.css';

type Props = { qualificationId: string };

export function QualificationReview({ qualificationId }: Props) {
  const router = useRouter();
  const [item, setItem] = useState<InternalQualificationListItem>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<InternalQualificationDecisionStatus>('UNDER_REVIEW');
  const [partnerVisibleReason, setPartnerVisibleReason] = useState('');
  const [internalScratch, setInternalScratch] = useState('');
  const [confirm, setConfirm] = useState(false);

  async function reload() {
    setError(undefined);
    try {
      const rows = await api.internalQualifications();
      const found = rows.find((row) => row.id === qualificationId);
      if (!found) {
        setError('المورد غير متاح.');
        setItem(undefined);
        return;
      }
      setItem(found);
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      setError(mapOpsError(failure, 'تعذر تحميل طلب التأهيل.'));
    }
  }

  useEffect(() => {
    void reload();
  }, [qualificationId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(undefined);
    setError(undefined);
    if (!confirm) {
      setError('أكد القرار قبل الإرسال.');
      return;
    }
    if (!partnerVisibleReason.trim()) {
      setError(
        decision === 'ACTION_REQUIRED'
          ? 'رسالة الشريك مطلوبة عند طلب إجراء.'
          : 'سبب القرار مطلوب.',
      );
      return;
    }
    setBusy(true);
    try {
      // Internal scratch is never sent — only partner-visible/decision reason goes to backend.
      const result = await api.internalQualificationDecide(qualificationId, {
        status: decision,
        reason: partnerVisibleReason.trim(),
      });
      setMessage(`تم تطبيق القرار · الحالة: ${qualificationStatusAr(String(result.status ?? decision))}`);
      setConfirm(false);
      await reload();
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر تطبيق قرار التأهيل.'));
    } finally {
      setBusy(false);
    }
  }

  if (error && !item) return <ErrorState message={error} />;
  if (!item) return <LoadingState />;

  const canAct = ['SUBMITTED', 'UNDER_REVIEW', 'ACTION_REQUIRED'].includes(item.status);

  return (
    <div className={styles.split}>
      <section className={styles.panel} aria-labelledby="qual-detail-title">
        <h2 id="qual-detail-title">مراجعة التأهيل</h2>
        <dl className={styles.dl}>
          <div>
            <dt>الشركة</dt>
            <dd>{item.legalName}</dd>
          </div>
          <div>
            <dt>بريد التواصل</dt>
            <dd dir="ltr">{item.contactEmail}</dd>
          </div>
          <div>
            <dt>الحالة</dt>
            <dd>
              <span className={styles.badge}>{qualificationStatusAr(item.status)}</span>
            </dd>
          </div>
          <div>
            <dt>تاريخ الإنشاء</dt>
            <dd>{formatWhen(item.createdAt)}</dd>
          </div>
          <div>
            <dt>معرّف الطلب</dt>
            <dd dir="ltr">{item.id}</dd>
          </div>
        </dl>
        <p className={styles.note}>
          حقول الإطلاق التفصيلية (القطاع/المدينة/نوع الاحتياج) تظهر هنا عندما يوسّع العقد الداخلي قائمة/تفصيل
          التأهيل. لا اختراع بيانات من الواجهة.
        </p>
        <p>
          <Link className={styles.rowLink} href="/documents">
            مستندات الشركاء
          </Link>
          {' · '}
          <Link className={styles.rowLink} href="/agreements">
            حالة الاتفاقيات
          </Link>
        </p>
      </section>

      <section className={styles.panel} aria-labelledby="qual-actions-title">
        <h2 id="qual-actions-title">إجراءات المراجعة</h2>
        {!canAct ? (
          <EmptyState message="لا تتوفر إجراءات انتقال على هذه الحالة." />
        ) : (
          <form className={styles.panel} onSubmit={submit}>
            <label className={styles.field}>
              القرار
              <select
                value={decision}
                disabled={busy}
                onChange={(event) => setDecision(event.target.value as InternalQualificationDecisionStatus)}
              >
                <option value="UNDER_REVIEW">بدء/تأكيد قيد المراجعة</option>
                <option value="ACTION_REQUIRED">طلب إجراء من الشريك</option>
                <option value="APPROVED">اعتماد</option>
                <option value="REJECTED">رفض</option>
              </select>
            </label>

            <label className={styles.field}>
              {decision === 'ACTION_REQUIRED' ? 'رسالة ظاهرة للشريك (إلزامية)' : 'سبب القرار (يُسجَّل تشغيليًا)'}
              <textarea
                value={partnerVisibleReason}
                disabled={busy}
                onChange={(event) => setPartnerVisibleReason(event.target.value)}
                required
                maxLength={1000}
                aria-describedby="partner-reason-help"
              />
            </label>
            <p id="partner-reason-help" className={styles.muted}>
              عند «يتطلب إجراءً» تُرسل هذه الرسالة إلى الشريك عبر الحقل الخلفي المخصص لذلك. لا تضع ملاحظات داخلية هنا.
            </p>

            <label className={styles.field}>
              ملاحظة داخلية (محلية فقط — لا تُرسل)
              <textarea
                value={internalScratch}
                disabled={busy}
                onChange={(event) => setInternalScratch(event.target.value)}
                maxLength={2000}
                aria-describedby="internal-note-help"
              />
            </label>
            <p id="internal-note-help" className={styles.note}>
              الواجهة لا تدعم حفظ ملاحظة داخلية في الخادم حاليًا. هذا الحقل للتذكير المحلي أثناء الجلسة ولن يُضمَّن في
              طلب القرار.
            </p>

            <div className={styles.confirmBox}>
              <label>
                <input
                  type="checkbox"
                  checked={confirm}
                  disabled={busy}
                  onChange={(event) => setConfirm(event.target.checked)}
                />{' '}
                أؤكد تطبيق القرار «{qualificationStatusAr(decision)}» على هذا الطلب.
              </label>
              <div className={styles.actions}>
                <button type="submit" className={styles.button} disabled={busy || !confirm}>
                  {busy ? 'جارٍ التطبيق...' : 'تطبيق القرار'}
                </button>
                <Link href="/qualifications" className={styles.buttonGhost}>
                  العودة للطابور
                </Link>
              </div>
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
          </form>
        )}
      </section>
    </div>
  );
}
