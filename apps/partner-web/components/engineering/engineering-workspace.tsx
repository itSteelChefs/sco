'use client';

import { ApiClientError } from '@sco/contracts';
import { useEffect, useState } from 'react';
import { engineeringApi, EngineeringWaitingError } from '../../lib/engineering-api';
import { CompanySelector } from '../portal/company-selector';
import { PortalChrome } from '../portal/portal-chrome';
import { usePortalSession } from '../portal/use-portal-session';
import { ErrorState, LoadingState } from '../product-state';
import { EngineeringRequestList } from './engineering-request-list';
import type { PartnerEngineeringRequestSummary } from './engineering-types';
import styles from './engineering.module.css';

export function EngineeringWorkspace() {
  const { companies, selected, setSelected, error: sessionError, reload } = usePortalSession();
  const [requests, setRequests] = useState<PartnerEngineeringRequestSummary[]>();
  const [waitingBackend, setWaitingBackend] = useState(!engineeringApi.isReady());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!selected) return;
    if (!engineeringApi.isReady()) {
      setWaitingBackend(true);
      setRequests([]);
      setError('');
      return;
    }
    const ac = new AbortController();
    setWaitingBackend(false);
    setRequests(undefined);
    setError('');
    void engineeringApi
      .list(selected, ac.signal)
      .then((items) => {
        if (!ac.signal.aborted) setRequests(items);
      })
      .catch((failure) => {
        if (failure?.name === 'AbortError') return;
        if (failure instanceof EngineeringWaitingError) {
          setWaitingBackend(true);
          setRequests([]);
          return;
        }
        if (failure instanceof ApiClientError && failure.status === 403) {
          setError('لا تملك صلاحية عرض الدراسات الهندسية.');
          setRequests([]);
          return;
        }
        setError('تعذر تحميل الطلبات الهندسية.');
        setRequests([]);
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
          <h1>الدراسات الهندسية</h1>
          <p>طلبات الدراسة، المستندات، حالة المراجعة، وجدول الكميات المعتمد ثم التسليم للمشتريات.</p>
        </header>
        <CompanySelector companies={companies} selected={selected} onSelect={setSelected} />
        {!selected ? <p role="status">اختر شركة للمتابعة.</p> : null}
        {selected && requests === undefined && !waitingBackend ? <LoadingState /> : null}
        {selected && (requests !== undefined || waitingBackend) ? (
          <EngineeringRequestList requests={requests ?? []} waitingBackend={waitingBackend} error={error} />
        ) : null}
      </div>
    </div>
  );
}
