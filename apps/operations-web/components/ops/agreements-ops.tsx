'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiClientError, type InternalPartnershipReadiness } from '@sco/contracts';
import { api } from '../../lib/api';
import { formatWhen, partnershipStatusAr, qualificationStatusAr } from '../../lib/labels';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import styles from './ops.module.css';

/**
 * Agreements ops — readiness + launch agreement satisfaction.
 * No legal-text authoring. Policy publish only when staff supplies an existing policy id.
 */
export function AgreementsOps() {
  const router = useRouter();
  const [items, setItems] = useState<InternalPartnershipReadiness[]>();
  const [selected, setSelected] = useState<InternalPartnershipReadiness>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [policyId, setPolicyId] = useState('');

  async function load() {
    setError(undefined);
    try {
      const rows = await api.internalPartnerships();
      setItems(rows);
      if (selected) {
        const refreshed = rows.find((row) => row.partnershipId === selected.partnershipId);
        setSelected(refreshed);
      }
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      setError(mapOpsError(failure, 'تعذر تحميل جاهزية الشراكات والاتفاقيات.'));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function openReadiness(partnershipId: string) {
    setMessage(undefined);
    setError(undefined);
    setBusy(true);
    try {
      const detail = await api.internalPartnershipReadiness(partnershipId);
      setSelected(detail);
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر تحميل تفاصيل الجاهزية.'));
    } finally {
      setBusy(false);
    }
  }

  async function publishPolicy() {
    setMessage(undefined);
    setError(undefined);
    if (!/^[0-9a-f-]{36}$/i.test(policyId.trim())) {
      setError('معرّف إصدار السياسة غير صالح.');
      return;
    }
    setBusy(true);
    try {
      await api.internalAgreementPolicyPublish(policyId.trim());
      setMessage('تم نشر إصدار السياسة.');
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر نشر السياسة. قد تكون غير مصرح أو الحالة غير صالحة.'));
    } finally {
      setBusy(false);
    }
  }

  if (error && !items) return <ErrorState message={error} />;
  if (!items) return <LoadingState />;

  return (
    <div className={styles.split}>
      <section className={styles.panel} aria-labelledby="agreements-queue-title">
        <h2 id="agreements-queue-title">جاهزية الشراكة والاتفاقيات</h2>
        <p className={styles.muted}>
          أنواع الإطلاق المعتمدة تشغيليًا: السرية الملزمة وشروط الشراكة. لا نص قانوني يُنشأ من الواجهة.
        </p>
        {!items.length ? (
          <EmptyState message="لا توجد شراكات في طابور العمليات." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">الشركة</th>
                  <th scope="col">حالة الشراكة</th>
                  <th scope="col">التأهيل</th>
                  <th scope="col">الاتفاقيات المطلوبة</th>
                  <th scope="col">تحديث</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.partnershipId}>
                    <td>
                      <button
                        type="button"
                        className={styles.rowLink}
                        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                        onClick={() => void openReadiness(item.partnershipId)}
                      >
                        {item.companyDisplayName}
                      </button>
                    </td>
                    <td>{partnershipStatusAr(item.partnershipStatus)}</td>
                    <td>{qualificationStatusAr(item.qualificationStatus ?? 'NONE')}</td>
                    <td>
                      <span className={item.requiredAgreementsSatisfied ? styles.badgeOk : styles.badgeWarn}>
                        {item.requiredAgreementsSatisfied ? 'مستوفاة' : 'غير مستوفاة / إعادة قبول محتملة'}
                      </span>
                    </td>
                    <td>{formatWhen(item.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="agreements-detail-title">
        <h2 id="agreements-detail-title">تفاصيل / إدارة محدودة</h2>
        {!selected ? (
          <EmptyState message="اختر شركة من القائمة لعرض الجاهزية." />
        ) : (
          <>
            <dl className={styles.dl}>
              <div>
                <dt>الشركة</dt>
                <dd>{selected.companyDisplayName}</dd>
              </div>
              <div>
                <dt>الشراكة</dt>
                <dd>
                  {partnershipStatusAr(selected.partnershipStatus)} · {selected.partnershipType}
                </dd>
              </div>
              <div>
                <dt>الاتفاقيات المطلوبة</dt>
                <dd>{selected.requiredAgreementsSatisfied ? 'مستوفاة' : 'غير مستوفاة'}</dd>
              </div>
              <div>
                <dt>عوائِّق</dt>
                <dd>{selected.blockers?.length ? selected.blockers.join(' · ') : 'لا يوجد'}</dd>
              </div>
              <div>
                <dt>الإجراء الداخلي التالي</dt>
                <dd>{selected.nextInternalAction}</dd>
              </div>
            </dl>
            <p className={styles.note}>
              حالة القبول/إعادة القبول تُستنتج من جاهزية الشراكة والعوائق الخلفية. لا تُعرض هنا صياغة قانونية.
            </p>
          </>
        )}

        <div className={styles.confirmBox}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>نشر إصدار سياسة موجود</h3>
          <p className={styles.muted}>فقط إن كان لديك معرّف إصدار سياسة مصرّح. لا إنشاء محتوى قانوني من الواجهة.</p>
          <label className={styles.field}>
            معرّف إصدار السياسة
            <input
              dir="ltr"
              value={policyId}
              disabled={busy}
              onChange={(event) => setPolicyId(event.target.value)}
              placeholder="UUID"
            />
          </label>
          <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => void publishPolicy()}>
            نشر الإصدار الحالي
          </button>
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
