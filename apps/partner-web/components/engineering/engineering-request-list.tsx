'use client';

import Link from 'next/link';
import type { PartnerEngineeringRequestSummary } from './engineering-types';
import {
  engineeringRequestTypeLabelAr,
  engineeringStatusLabelAr,
  formatDateAr,
} from './engineering-labels';
import styles from './engineering.module.css';

type Props = {
  requests: PartnerEngineeringRequestSummary[];
  waitingBackend?: boolean;
  error?: string;
};

export function EngineeringRequestList({ requests, waitingBackend, error }: Props) {
  return (
    <section className={styles.panel} aria-labelledby="eng-list-title" data-testid="engineering-request-list">
      <div className={styles.row}>
        <h2 id="eng-list-title">طلباتي الهندسية</h2>
        <Link className={styles.linkButton} href="/portal/engineering/new">
          طلب دراسة جديدة
        </Link>
      </div>
      <p className={styles.panelLead}>
        أنشئ طلب دراسة هندسية، أرفق المستندات، تابع المراجعة، واستلم جدول الكميات المعتمد ثم أنشئ طلب مشتريات عند
        الإتاحة.
      </p>

      {waitingBackend ? (
        <p className={styles.note} role="status" data-testid="engineering-waiting">
          بانتظار واجهة الخادم المعتمدة للدراسات الهندسية. لا تُعرض طلبات أو جداول كميات وهمية.
        </p>
      ) : null}

      {error ? (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}

      {!waitingBackend && !error && requests.length === 0 ? (
        <p className={styles.hint} role="status">
          لا توجد طلبات هندسية لشركتك حاليًا.
        </p>
      ) : null}

      {requests.length > 0 ? (
        <ul className={styles.list}>
          {requests.map((item) => (
            <li key={item.requestId} className={styles.listItem} data-testid="engineering-request-row">
              <div className={styles.row}>
                <strong>{item.reference}</strong>
                <span className={`${styles.badge} ${styles.badgeAccent}`}>
                  {engineeringStatusLabelAr(item.status)}
                </span>
              </div>
              <div className={styles.meta}>
                <span className={styles.mixed}>{item.title}</span>
                <span>النوع: {engineeringRequestTypeLabelAr(item.requestType)}</span>
                <span>القطاع: {item.sector}</span>
                <span>تاريخ الإرسال: {formatDateAr(item.submittedAt)}</span>
                {item.currentResultVersion ? <span>إصدار النتيجة: {item.currentResultVersion}</span> : null}
                {item.nextActionLabel ? <span>الإجراء التالي: {item.nextActionLabel}</span> : null}
              </div>
              <Link className={styles.linkButton} href={`/portal/engineering/${item.requestId}`}>
                فتح الطلب
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
