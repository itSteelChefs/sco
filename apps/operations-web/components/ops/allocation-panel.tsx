'use client';

import { FormEvent, useMemo, useState } from 'react';
import type { InternalAllocationLine } from '@sco/contracts';
import { EmptyState } from '../product-state';
import styles from './ops.module.css';

type Props = {
  rows: InternalAllocationLine[];
  disabled?: boolean;
  onAllocate: (input: {
    purchaseLineId: string;
    partnerCompanyId: string;
    quantity: number;
    requirementId?: string;
  }) => Promise<void>;
};

export function AllocationPanel({ rows, disabled, onAllocate }: Props) {
  const [purchaseLineId, setPurchaseLineId] = useState('');
  const [partnerCompanyId, setPartnerCompanyId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [localError, setLocalError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const lineOptions = useMemo(() => {
    const map = new Map<string, InternalAllocationLine>();
    for (const row of rows) map.set(row.purchaseLineId, row);
    return [...map.values()];
  }, [rows]);

  const partners = useMemo(() => {
    const map = new Map<string, InternalAllocationLine>();
    for (const row of rows) map.set(row.partnerCompanyId, row);
    return [...map.values()];
  }, [rows]);

  const selectedLine = lineOptions.find((row) => row.purchaseLineId === purchaseLineId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(undefined);
    const qty = Number(quantity);
    if (!purchaseLineId || !partnerCompanyId) {
      setLocalError('اختر خط الشراء والشريك.');
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setLocalError('الكمية يجب أن تكون رقمًا موجبًا.');
      return;
    }
    if (selectedLine && qty > selectedLine.remainingQuantity) {
      setLocalError('لا يمكن تجاوز الكمية المتبقية (حماية واجهة — الخادم هو المرجع).');
      return;
    }
    setBusy(true);
    try {
      const partner = partners.find((row) => row.partnerCompanyId === partnerCompanyId);
      await onAllocate({
        purchaseLineId,
        partnerCompanyId,
        quantity: qty,
        requirementId: partner?.requirementId ?? undefined,
      });
      setQuantity('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="alloc-title">
      <h2 id="alloc-title">توزيع على مستوى الخط</h2>
      <p className={styles.muted}>
        الكمية المشتراة · الموزَّعة · المتبقية · طلب الشريك · حالة خط إعادة البيع. الخادم يمنع التوزيع الزائد.
      </p>

      {rows.length === 0 ? (
        <EmptyState message="لا توزيعات معروضة من الخادم بعد." />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">خط الشراء</th>
                <th scope="col">الشريك</th>
                <th scope="col">مشتراة</th>
                <th scope="col">موزَّعة</th>
                <th scope="col">متبقية</th>
                <th scope="col">طلب الشريك</th>
                <th scope="col">حالة إعادة البيع</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.purchaseLineId}-${row.partnerCompanyId}-${row.id ?? 'new'}`}>
                  <td dir="ltr">{row.purchaseLineId.slice(0, 8)}…</td>
                  <td>{row.partnerCompanyId}</td>
                  <td dir="ltr">{row.purchasedQuantity}</td>
                  <td dir="ltr">{row.allocatedQuantity}</td>
                  <td dir="ltr">{row.remainingQuantity}</td>
                  <td dir="ltr">{row.partnerRequestedQuantity ?? '—'}</td>
                  <td>{row.resaleLineStatus || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className={styles.confirmBox} onSubmit={(e) => void submit(e)} aria-labelledby="alloc-form-title">
        <h3 id="alloc-form-title" className={styles.muted}>
          تسجيل توزيع
        </h3>
        <label className={styles.field}>
          خط الشراء
          <select
            value={purchaseLineId}
            onChange={(e) => setPurchaseLineId(e.target.value)}
            disabled={disabled || busy}
            required
          >
            <option value="">—</option>
            {lineOptions.map((row) => (
              <option key={row.purchaseLineId} value={row.purchaseLineId}>
                {row.purchaseLineId.slice(0, 8)}… (متبقي {row.remainingQuantity})
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          الشريك
          <select
            value={partnerCompanyId}
            onChange={(e) => setPartnerCompanyId(e.target.value)}
            disabled={disabled || busy}
            required
          >
            <option value="">—</option>
            {partners.map((row) => (
              <option key={row.partnerCompanyId} value={row.partnerCompanyId}>
                {row.partnerCompanyId}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          الكمية
          <input
            type="number"
            min={0}
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={disabled || busy}
            required
            dir="ltr"
          />
        </label>
        {localError ? (
          <p className={styles.alert} role="alert">
            {localError}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button type="submit" className={styles.button} disabled={disabled || busy}>
            {busy ? 'جارٍ الحفظ…' : 'حفظ التوزيع'}
          </button>
        </div>
      </form>
    </section>
  );
}
