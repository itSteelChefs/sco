'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiClientError,
  type InternalProcurementRequirementListItem,
  type InternalSelectionCandidate,
} from '@sco/contracts';
import { api } from '../../lib/api';
import { formatWhen, moneyAr } from '../../lib/labels';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import styles from './ops.module.css';

export function PurchaseQueue() {
  const router = useRouter();
  const search = useSearchParams();
  const presetSelection = search.get('selection') ?? '';

  const [selections, setSelections] = useState<InternalSelectionCandidate[]>();
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
        const rows = await api.internalSelectionCandidates();
        if (!cancelled) setSelections(rows.filter((row) => row.eHandoffReady));
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        warnings.push('قائمة الاختيارات التجارية');
        if (!cancelled) setSelections([]);
      }
      try {
        const reqs = await api.internalProcurementRequirements();
        if (!cancelled) {
          setRequirements(reqs.filter((row) => row.status === 'SELECTION_READY' || row.status === 'SELECTED'));
        }
      } catch {
        warnings.push('متطلبات D');
        if (!cancelled) setRequirements([]);
      }
      if (!cancelled) {
        setPartial(warnings);
        if (warnings.length === 2) {
          setError('طوابير الاختيار غير متاحة بعد من الخادم. يمكن فتح شراء بمعرّف مرشّح الاختيار.');
        }
      }
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

  if (!selections || !requirements) {
    if (error && selections === undefined && requirements === undefined) return <ErrorState message={error} />;
    if (selections === undefined && requirements === undefined) return <LoadingState />;
  }

  const readySelections = selections ?? [];

  return (
    <div className={styles.panel} aria-labelledby="purchase-queue-title">
      <h2 id="purchase-queue-title">طابور الشراء التجاري</h2>
      <p className={styles.muted}>
        اختيار D جاهز → نية شراء → اعتماد → تجميع في أمر مورّد → إصدار → تأكيد → توزيع → إعادة بيع.
      </p>

      {partial.length ? (
        <p className={styles.note} role="status">
          بعض مصادر الطابور غير متاحة ({partial.join(' · ')}). تُعرض المسارات المتاحة فقط.
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

      {readySelections.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.muted}>اختيارات جاهزة للمعالجة التجارية</caption>
            <thead>
              <tr>
                <th scope="col">المتطلب / الشريك</th>
                <th scope="col">المورّد</th>
                <th scope="col">التكلفة المقارنة</th>
                <th scope="col">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {readySelections.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div>{row.requirementTitle || row.requirementId}</div>
                    <div className={styles.muted}>{row.partnerDisplayName || row.companyId}</div>
                  </td>
                  <td>
                    {row.supplierName || row.supplierCompanyId}
                    {row.aliasLabel ? <div className={styles.muted}>اسم مستعار: {row.aliasLabel}</div> : null}
                  </td>
                  <td dir="ltr">{moneyAr(row.comparableTotal ?? null, row.currencyCode || 'SAR')}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={busy}
                      onClick={() => void openPurchase(row.id)}
                    >
                      فتح تحضير شراء
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState message="لا قائمة اختيارات تجارية من الخادم بعد — استخدم معرّف مرشّح الاختيار أعلاه." />
      )}

      {(requirements ?? []).length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.muted}>متطلبات D بحالة اختيار جاهز (مرجع)</caption>
            <thead>
              <tr>
                <th scope="col">العنوان</th>
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
                  <td>
                    <span className={styles.badge}>{row.status}</span>
                  </td>
                  <td>{formatWhen(row.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className={styles.note}>
        بعد إنشاء نية الشراء انتقل لتفاصيلها للاعتماد ثم إنشاء أمر المورّد (تجميع النوايا المتوافقة).{' '}
        <Link className={styles.rowLink} href="/documents">
          مركز المستندات
        </Link>
      </p>
    </div>
  );
}
