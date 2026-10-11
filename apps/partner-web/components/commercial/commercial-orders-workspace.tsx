'use client';

import { ApiClientError } from '@sco/contracts';
import { useEffect, useState } from 'react';
import { commercialOrdersApi, CommercialOrdersWaitingError } from '../../lib/commercial-orders-api';
import { CompanySelector } from '../portal/company-selector';
import { PortalChrome } from '../portal/portal-chrome';
import { usePortalSession } from '../portal/use-portal-session';
import { ErrorState, LoadingState } from '../product-state';
import { CommercialOrderList } from './commercial-order-list';
import type { PartnerCommercialOrderSummary } from './commercial-order-types';
import styles from './commercial.module.css';

export function CommercialOrdersWorkspace() {
  const { companies, selected, setSelected, error: sessionError, reload } = usePortalSession();
  const [orders, setOrders] = useState<PartnerCommercialOrderSummary[]>();
  const [waitingBackend, setWaitingBackend] = useState(!commercialOrdersApi.isReady());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!selected) return;
    if (!commercialOrdersApi.isReady()) {
      setWaitingBackend(true);
      setOrders([]);
      setError('');
      return;
    }
    const ac = new AbortController();
    setWaitingBackend(false);
    setOrders(undefined);
    setError('');
    void commercialOrdersApi
      .list(selected, ac.signal)
      .then((items) => {
        if (!ac.signal.aborted) setOrders(items);
      })
      .catch((failure) => {
        if (failure?.name === 'AbortError') return;
        if (failure instanceof CommercialOrdersWaitingError) {
          setWaitingBackend(true);
          setOrders([]);
          return;
        }
        if (failure instanceof ApiClientError && failure.status === 403) {
          setError('لا تملك صلاحية عرض الطلبات التجارية لهذه الشركة.');
          setOrders([]);
          return;
        }
        setError('تعذر تحميل الطلبات التجارية.');
        setOrders([]);
      });
    return () => ac.abort();
  }, [selected]);

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
          <h1>مشترياتي</h1>
          <p>طلباتك التجارية لدى سكو — الحالة والمبالغ والخطوة التالية دون بيانات سرية للمورد.</p>
        </header>
        <CompanySelector companies={companies} selected={selected} onSelect={setSelected} />
        {!selected ? <p role="status">اختر شركة للمتابعة.</p> : null}
        {selected && orders === undefined && !waitingBackend ? <LoadingState /> : null}
        {selected && (orders !== undefined || waitingBackend) ? (
          <CommercialOrderList orders={orders ?? []} waitingBackend={waitingBackend} error={error} />
        ) : null}
      </div>
    </div>
  );
}
