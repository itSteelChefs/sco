'use client';

import Link from 'next/link';
import { useState } from 'react';
import { commercialOrdersApi } from '../../lib/commercial-orders-api';
import type { PartnerCommercialOrderDetail } from './commercial-order-types';
import { commercialOrderStatusLabelAr, formatDateAr, formatMoneyAr } from './commercial-order-labels';
import styles from './commercial.module.css';

type Props = {
  companyId: string;
  order: PartnerCommercialOrderDetail;
  onAcknowledged?: () => void;
};

export function CommercialOrderDetailView({ companyId, order, onAcknowledged }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const canAck =
    Boolean(order.acknowledgementRequired && order.acknowledgementActionAvailable) &&
    commercialOrdersApi.canAcknowledge();

  async function acknowledge() {
    if (!canAck || busy) return;
    setBusy(true);
    setError('');
    setMessage('جارٍ تسجيل التأكيد...');
    try {
      await commercialOrdersApi.acknowledge(companyId, order.orderId);
      setMessage('تم تسجيل التأكيد لدى سكو.');
      onAcknowledged?.();
    } catch {
      setMessage('');
      setError('تعذر تسجيل التأكيد. حاول مرة أخرى أو تواصل مع سكو.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={styles.panel} aria-labelledby="commercial-detail-title" data-testid="commercial-order-detail">
      <div className={styles.orderHead}>
        <h2 id="commercial-detail-title">طلب سكو {order.reference}</h2>
        <span className={`${styles.badge} ${styles.badgeAccent}`}>{commercialOrderStatusLabelAr(order.status)}</span>
      </div>
      <p className={styles.panelLead}>تفاصيل مشترياتك من سكو. الأسعار المعروضة هي أسعار البيع لك — ليست تكلفة شراء سكو.</p>

      <dl className={styles.summaryGrid}>
        <dt>مرجع طلب سكو</dt>
        <dd>{order.reference}</dd>
        <dt>التاريخ</dt>
        <dd>{formatDateAr(order.createdAt)}</dd>
        <dt>الحالة</dt>
        <dd>{commercialOrderStatusLabelAr(order.status)}</dd>
        <dt>الإجمالي التجاري</dt>
        <dd className={styles.totalStrong} data-testid="commercial-total" aria-label="الإجمالي التجاري">
          {formatMoneyAr(order.commercialTotal, order.currencyCode)}
        </dd>
        {order.paymentTerms ? (
          <>
            <dt>شروط الدفع</dt>
            <dd data-testid="payment-terms">{order.paymentTerms}</dd>
          </>
        ) : null}
        {order.deliveryReadiness ? (
          <>
            <dt>التجهيز / التسليم</dt>
            <dd>{order.deliveryReadiness}</dd>
          </>
        ) : null}
        {order.readinessLabel ? (
          <>
            <dt>الجاهزية</dt>
            <dd>{order.readinessLabel}</dd>
          </>
        ) : null}
        {order.nextActionLabel ? (
          <>
            <dt>الإجراء التالي</dt>
            <dd>{order.nextActionLabel}</dd>
          </>
        ) : null}
        {order.procurementRequirementReference || order.procurementRequirementId ? (
          <>
            <dt>مصدر المشتريات</dt>
            <dd>
              مرتبط بطلب المشتريات{' '}
              {order.procurementRequirementReference ?? order.procurementRequirementId}
            </dd>
          </>
        ) : null}
        {order.supplierAliasLabel ? (
          <>
            <dt>مرجع التوريد (اسم مستعار)</dt>
            <dd data-testid="supplier-alias">{order.supplierAliasLabel}</dd>
          </>
        ) : null}
      </dl>

      <h3>البنود</h3>
      <div className={styles.tableWrap}>
        <table className={styles.lineTable} data-testid="commercial-line-table">
          <caption className={styles.hint}>بنود الطلب بأسعار البيع للشريك</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">المواصفات</th>
              <th scope="col">الكمية</th>
              <th scope="col">سعر البيع للوحدة</th>
              <th scope="col">إجمالي البند</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.lineNumber} data-testid="commercial-line-row">
                <td>{line.lineNumber}</td>
                <td>{line.specification}</td>
                <td>{line.quantity}</td>
                <td data-testid="unit-sale-price">
                  {formatMoneyAr(line.unitSalePrice, line.currencyCode ?? order.currencyCode)}
                </td>
                <td>{formatMoneyAr(line.lineTotal, line.currencyCode ?? order.currencyCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.lineCards} data-testid="commercial-line-cards">
        {order.lines.map((line) => (
          <div key={line.lineNumber} className={styles.lineCard}>
            <strong>
              بند {line.lineNumber}: {line.specification}
            </strong>
            <span>الكمية: {line.quantity}</span>
            <span>سعر البيع للوحدة: {formatMoneyAr(line.unitSalePrice, line.currencyCode ?? order.currencyCode)}</span>
            <span className={styles.totalStrong}>
              إجمالي البند: {formatMoneyAr(line.lineTotal, line.currencyCode ?? order.currencyCode)}
            </span>
          </div>
        ))}
      </div>

      {canAck ? (
        <div className={styles.orderHead}>
          <button type="button" className={styles.button} disabled={busy} onClick={() => void acknowledge()}>
            {busy ? 'جارٍ التأكيد...' : 'تأكيد الطلب التجاري'}
          </button>
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

      <Link className={styles.buttonGhost} href="/portal/orders">
        العودة إلى مشترياتي
      </Link>
    </article>
  );
}
