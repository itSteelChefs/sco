'use client';

import Link from 'next/link';
import type { PartnerCommercialOrderSummary } from './commercial-order-types';
import { commercialOrderStatusLabelAr, formatDateAr, formatMoneyAr } from './commercial-order-labels';
import styles from './commercial.module.css';

type Props = {
  orders: PartnerCommercialOrderSummary[];
  waitingBackend?: boolean;
  error?: string;
};

export function CommercialOrderList({ orders, waitingBackend, error }: Props) {
  return (
    <section className={styles.panel} aria-labelledby="commercial-list-title" data-testid="commercial-order-list">
      <h2 id="commercial-list-title">مشترياتي من سكو</h2>
      <p className={styles.panelLead}>
        طلباتك التجارية لدى سكو. أنت تشتري من سكو — لا من المورد. لا تُعرض تكاليف الشراء أو هوامش سكو أو هوية
        المورد.
      </p>

      {waitingBackend ? (
        <p className={styles.note} role="status" data-testid="commercial-orders-waiting">
          بانتظار واجهة الخادم المعتمدة لطلباتك التجارية. لا تُعرض طلبات تجريبية أو بيانات وهمية.
        </p>
      ) : null}

      {error ? (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}

      {!waitingBackend && !error && orders.length === 0 ? (
        <p className={styles.hint} role="status">
          لا توجد طلبات تجارية لشركتك حاليًا.
        </p>
      ) : null}

      {orders.length > 0 ? (
        <ul className={styles.orderList}>
          {orders.map((order) => (
            <li key={order.orderId} className={styles.orderCard} data-testid="commercial-order-row">
              <div className={styles.orderHead}>
                <strong>{order.reference}</strong>
                <span className={`${styles.badge} ${styles.badgeAccent}`}>
                  {commercialOrderStatusLabelAr(order.status)}
                </span>
              </div>
              <div className={styles.orderMeta}>
                <span>التاريخ: {formatDateAr(order.createdAt)}</span>
                <span>
                  عدد البنود: <span data-testid="order-item-count">{order.itemCount}</span>
                </span>
                {order.readinessLabel ? <span>الجاهزية: {order.readinessLabel}</span> : null}
                {order.nextActionLabel ? <span>الإجراء التالي: {order.nextActionLabel}</span> : null}
                {order.procurementRequirementReference ? (
                  <span>مرتبط بطلب المشتريات {order.procurementRequirementReference}</span>
                ) : null}
                <span className={styles.totalStrong} aria-label="الإجمالي التجاري">
                  {formatMoneyAr(order.commercialTotal, order.currencyCode)}
                </span>
              </div>
              <Link className={styles.linkButton} href={`/portal/orders/${order.orderId}`}>
                عرض التفاصيل
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
