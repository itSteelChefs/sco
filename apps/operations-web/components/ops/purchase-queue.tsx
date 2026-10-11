'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiClientError, type InternalProcurementRequirementListItem } from '@sco/contracts';
import { api } from '../../lib/api';
import { formatWhen } from '../../lib/labels';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import styles from './ops.module.css';

/**
 * Purchase queue uses only signed contracts:
 * - D GET /api/v1/internal/procurement/requirements
 * - E POST /api/v1/internal/commercial/purchases/from-selection
 * Does not call unsigned commercial list endpoints.
 */
export function PurchaseQueue() {
  const router = useRouter();
  const search = useSearchParams();
  const presetSelection = search.get('selection') ?? '';

  const [requirements, setRequirements] = useState<InternalProcurementRequirementListItem[]>();
  const [manualSelectionId, setManualSelectionId] = useState(presetSelection);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [partial, setPartial] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(undefined);
      const warnings: string[] = [];
      try {
        const reqs = await api.internalProcurementRequirements();
        if (!cancelled) {
          setRequirements(reqs.filter((row) => row.status === 'SELECTION_READY' || row.status === 'SELECTED'));
        }
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        warnings.push('متطلبات D');
        if (!cancelled) {
          setRequirements([]);
          setError(mapOpsError(failure, 'تعذر تحميل متطلبات الاختيار من العقد الموقّع.'));
        }
      }
      if (!cancelled) setPartial(warnings);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function openPurchase(selectionCandidateId: string) {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `sel-${selectionCandidateId}-${Date.now()}`;
      const intent = await api.internalPurchaseCreateFromSelection({
        selectionCandidateId,
        idempotencyKey,
      });
      setMessage('تم فتح نية شراء للمعالجة التجارية.');
      router.push(`/commercial/purchases/${intent.id}`);
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر إنشاء نية الشراء من الاختيار.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitManual(event: FormEvent) {
    event.preventDefault();
    if (!manualSelectionId.trim()) {
      setError('معرّف مرشّح الاختيار مطلوب.');
      return;
    }
    await openPurchase(manualSelectionId.trim());
  }

  if (requirements === undefined && !error) return <LoadingState />;
  if (error && requirements === undefined) return <ErrorState message={error} />;

  return (
    <div className={styles.panel} aria-labelledby="purchase-queue-title">
      <h2 id="purchase-queue-title">طابور الشراء التجاري</h2>
      <p className={styles.muted}>
        اختيار D جاهز → نية شراء → اعتماد → تجميع في أمر مورّد → إصدار → تأكيد → توزيع → إعادة بيع.
      </p>

      {partial.length ? (
        <p className={styles.note} role="status">
          مصدر الطابور الجزئي: {partial.join(' · ')}. لا تُستدعى عقود قوائم تجارية غير موقّعة.
        </p>
      ) : null}
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

      <form className={styles.confirmBox} onSubmit={(e) => void submitManual(e)} aria-labelledby="manual-sel-title">
        <h3 id="manual-sel-title" className={styles.muted}>
          فتح تحضير شراء من مرشّح اختيار
        </h3>
        <label className={styles.field}>
          معرّف مرشّح الاختيار (selectionCandidateId)
          <input
            value={manualSelectionId}
            onChange={(e) => setManualSelectionId(e.target.value)}
            dir="ltr"
            required
            disabled={busy}
            autoComplete="off"
          />
        </label>
        <button type="submit" className={styles.button} disabled={busy}>
          {busy ? 'جارٍ الفتح…' : 'فتح نية شراء'}
        </button>
      </form>

      {(requirements ?? []).length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.muted}>
              متطلبات D بحالة اختيار جاهز (مرجع موقّع — افتح الشراء بمعرّف مرشّح الاختيار)
            </caption>
            <thead>
              <tr>
                <th scope="col">العنوان</th>
                <th scope="col">الشريك (شركة)</th>
                <th scope="col">الحالة</th>
                <th scope="col">آخر تحديث</th>
              </tr>
            </thead>
            <tbody>
              {(requirements ?? []).map((row) => (
                <tr key={row.id}>
                  <td>
                    <div>{row.title}</div>
                    <div className={styles.muted} dir="ltr">
                      {row.id}
                    </div>
                  </td>
                  <td dir="ltr">{row.companyId}</td>
                  <td>
                    <span className={styles.badge}>{row.status}</span>
                  </td>
                  <td>{formatWhen(row.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState message="لا متطلبات اختيار جاهزة من عقد D، أو أن القائمة غير متاحة — استخدم معرّف مرشّح الاختيار." />
      )}

      <p className={styles.note}>
        بعد إنشاء نية الشراء انتقل لتفاصيلها للاعتماد ثم إنشاء أمر المورّد.{' '}
        <Link className={styles.rowLink} href="/documents">
          مركز المستندات
        </Link>
      </p>
    </div>
  );
}
