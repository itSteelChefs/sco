'use client';

import { ApiClientError } from '@sco/contracts';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { commercialOrdersApi, CommercialOrdersWaitingError } from '../../lib/commercial-orders-api';
import { CompanySelector } from '../portal/company-selector';
import { PortalChrome } from '../portal/portal-chrome';
import { usePortalSession } from '../portal/use-portal-session';
import { ErrorState, LoadingState } from '../product-state';
import { CommercialOrderDetailView } from './commercial-order-detail';
import type { PartnerCommercialOrderDetail } from './commercial-order-types';
import styles from './commercial.module.css';

export function CommercialOrderDetailWorkspace() {
  const params = useParams<{ orderId: string }>();
  const orderId = typeof params?.orderId === 'string' ? params.orderId : '';
  const { companies, selected, setSelected, error: sessionError, reload } = usePortalSession();
  const [order, setOrder] = useState<PartnerCommercialOrderDetail>();
  const [waitingBackend, setWaitingBackend] = useState(!commercialOrdersApi.isReady());
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!selected || !orderId) return;
    if (!commercialOrdersApi.isReady()) {
      setWaitingBackend(true);
      setOrder(undefined);
      setError('');
      return;
    }
    const ac = new AbortController();
    setWaitingBackend(false);
    setOrder(undefined);
    setError('');
    void commercialOrdersApi
      .get(selected, orderId, ac.signal)
      .then((detail) => {
        if (!ac.signal.aborted) setOrder(detail);
      })
      .catch((failure) => {
        if (failure?.name === 'AbortError') return;
        if (failure instanceof CommercialOrdersWaitingError) {
          setWaitingBackend(true);
          return;
        }
        if (failure instanceof ApiClientError && (failure.status === 404 || failure.code === 'NOT_FOUND')) {
          setError('الطلب غير موجود أو لا يخص شركتك.');
          return;
        }
        if (failure instanceof ApiClientError && failure.status === 403) {
          setError('لا تملك صلاحية عرض هذا الطلب.');
          return;
        }
        setError('تعذر تحميل تفاصيل الطلب.');
      });
    return () => ac.abort();
  }, [selected, orderId, reloadToken]);

  if (sessionError && sessionError !== 'UNAUTHENTICATED') {
    return (
      <div className={styles.page}>
        <PortalChrome />
        <div className={styles.shell}>
          <ErrorState message={sessionError} onRetry={() => reload()} />
        </div>
      </div>
    );
  }

  if (!companies) {
    return (
      <div className={styles.page}>
        <PortalChrome />
        <div className={styles.shell}>
          <LoadingState />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PortalChrome />
      <div className={styles.shell}>
        <header className={styles.intro}>
          <h1>تفاصيل الطلب التجاري</h1>
          <p>أسعار البيع والمواصفات وحالة التنفيذ — بدون تكلفة شراء أو هوامش أو هوية مورد.</p>
        </header>
        <CompanySelector companies={companies} selected={selected} onSelect={setSelected} />
        {!selected ? <p role="status">اختر شركة للمتابعة.</p> : null}
        {waitingBackend ? (
          <p className={styles.note} role="status" data-testid="commercial-orders-waiting">
            بانتظار واجهة الخادم المعتمدة لتفاصيل الطلبات التجارية. لا تُعرض بيانات وهمية.
          </p>
        ) : null}
        {error ? (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        ) : null}
        {selected && !waitingBackend && !error && !order ? <LoadingState /> : null}
        {selected && order ? (
          <CommercialOrderDetailView
            companyId={selected}
            order={order}
            onAcknowledged={() => setReloadToken((value) => value + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
