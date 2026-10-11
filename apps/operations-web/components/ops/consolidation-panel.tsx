'use client';

import { useMemo } from 'react';
import type { InternalConsolidationRow } from '@sco/contracts';
import { EmptyState } from '../product-state';
import styles from './ops.module.css';

type Props = { rows: InternalConsolidationRow[] };

/** Internal consolidation workspace — multi-partner visible to authorized SCO staff only. */
export function ConsolidationPanel({ rows }: Props) {
  const crossSupplier = useMemo(() => {
    const suppliers = new Set(rows.map((row) => row.supplierCompanyId));
    return suppliers.size > 1;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <section className={styles.panel} aria-labelledby="consol-title">
        <h2 id="consol-title">مساحة التجميع</h2>
        <EmptyState message="لا صفوف تجميع من الخادم لهذا الأمر." />
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="consol-title">
      <h2 id="consol-title">مساحة التجميع</h2>
      <p className={styles.muted}>
        طلبات شركاء متوافقة على نفس المورّد وخط الشراء. الدمج عبر مورّدين مختلفين مرفوض.
      </p>
      {crossSupplier ? (
        <p className={styles.alert} role="alert">
          تحذير: الصفوف تشير إلى أكثر من مورّد — لا تُنفَّذ عمليات دمج غير صالحة من الواجهة. الخادم هو المرجع.
        </p>
      ) : null}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">الشريك</th>
              <th scope="col">المتطلب</th>
              <th scope="col">خط الشراء</th>
              <th scope="col">المطلوب</th>
              <th scope="col">الموزَّع</th>
              <th scope="col">المتبقي</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.partnerCompanyId}-${row.purchaseLineId}-${row.requirementId}`}>
                <td>{row.partnerDisplayName || row.partnerCompanyId}</td>
                <td dir="ltr">{row.requirementId.slice(0, 8)}…</td>
                <td dir="ltr">{row.purchaseLineId.slice(0, 8)}…</td>
                <td dir="ltr">{row.requestedQuantity}</td>
                <td dir="ltr">{row.allocatedQuantity}</td>
                <td dir="ltr">{row.remainingQuantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
