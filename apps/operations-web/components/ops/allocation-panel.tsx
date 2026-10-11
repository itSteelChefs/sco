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

/**
 * Partner is bound to the supplier order line (Cursor3 allocates by orderLineId only).
 * Free partner selection that disagrees with the line is rejected client-side.
 */
export function AllocationPanel({ rows, disabled, onAllocate }: Props) {
  const [purchaseLineId, setPurchaseLineId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [localError, setLocalError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const lineOptions = useMemo(() => {
    const map = new Map<string, InternalAllocationLine>();
    for (const row of rows) map.set(row.purchaseLineId, row);
    return [...map.values()];
  }, [rows]);

  const selectedLine = lineOptions.find((row) => row.purchaseLineId === purchaseLineId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(undefined);
    const qty = Number(quantity);
    if (!purchaseLineId || !selectedLine) {
      setLocalError('اختر خط الشراء.');
      return;
    }
    if (!selectedLine.partnerCompanyId) {
      setLocalError('خط الشراء بلا شريك مرتبط — لا يمكن التوزيع.');
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setLocalError('الكمية يجب أن تكون رقمًا موجبًا.');
      return;
    }
    if (qty > selectedLine.remainingQuantity) {
      setLocalError('لا يمكن تجاوز الكمية المتبقية (حماية واجهة — الخادم هو المرجع).');
      return;
    }
    setBusy(true);
    try {
      await onAllocate({
        purchaseLineId,
        partnerCompanyId: selectedLine.partnerCompanyId,
        quantity: qty,
        requirementId: selectedLine.requirementId ?? undefined,
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
        الشريك يُستمد من خط أمر المورّد — لا اختيار شريك حر يخالف الخط. الخادم يمنع التوزيع الزائد.
      </p>

      {rows.length === 0 ? (
        <EmptyState message="لا توزيعات معروضة من الخادم بعد." />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">خط الشراء</th>
                <th scope="col">الشريك (من الخط)</th>
                <th scope="col">مشتراة</th>
                <th scope="col">موزَّعة</th>
                <th scope="col">متبقية</th>
                <th scope="col">طلب الشريك</th>
                <th scope="col">حالة إعادة البيع</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.purchaseLineId}-${row.partnerCompanyId}-${row.id ?? 'row'}`}>
                  <td dir="ltr">{row.purchaseLineId.slice(0, 8)}…</td>
                  <td dir="ltr">{row.partnerCompanyId}</td>
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
          خط الشراء (يحدد الشريك)
          <select
            value={purchaseLineId}
            onChange={(e) => setPurchaseLineId(e.target.value)}
            disabled={disabled || busy}
            required
          >
            <option value="">—</option>
            {lineOptions.map((row) => (
              <option key={row.purchaseLineId} value={row.purchaseLineId}>
                {row.purchaseLineId.slice(0, 8)}… · شريك {row.partnerCompanyId.slice(0, 8)}… · متبقي{' '}
                {row.remainingQuantity}
              </option>
            ))}
          </select>
        </label>
        {selectedLine ? (
          <p className={styles.note} role="status">
            الشريك المرتبط بالخط:{' '}
            <strong dir="ltr">{selectedLine.partnerCompanyId}</strong> — لا يُستبدل من الواجهة.
          </p>
        ) : null}
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
