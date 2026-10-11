'use client';

import { ApiClientError } from '@sco/contracts';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { engineeringApi, EngineeringWaitingError } from '../../lib/engineering-api';
import { CompanySelector } from '../portal/company-selector';
import { PortalChrome } from '../portal/portal-chrome';
import { usePortalSession } from '../portal/use-portal-session';
import { ErrorState, LoadingState } from '../product-state';
import { EngineeringRequestDetailView } from './engineering-request-detail';
import type { PartnerEngineeringRequestDetail } from './engineering-types';
import styles from './engineering.module.css';

export function EngineeringDetailWorkspace() {
  const params = useParams<{ requestId: string }>();
  const requestId = typeof params?.requestId === 'string' ? params.requestId : '';
  const { companies, selected, setSelected, error: sessionError, reload } = usePortalSession();
  const [detail, setDetail] = useState<PartnerEngineeringRequestDetail>();
  const [waitingBackend, setWaitingBackend] = useState(!engineeringApi.isReady());
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!selected || !requestId) return;
    if (!engineeringApi.isReady()) {
      setWaitingBackend(true);
      setDetail(undefined);
      setError('');
      return;
    }
    const ac = new AbortController();
    setWaitingBackend(false);
    setDetail(undefined);
    setError('');
    void engineeringApi
      .get(selected, requestId, ac.signal)
      .then((current) => {
        if (!ac.signal.aborted) setDetail(current);
      })
      .catch((failure) => {
        if (failure?.name === 'AbortError') return;
        if (failure instanceof EngineeringWaitingError) {
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
        setError('تعذر تحميل الطلب الهندسي.');
      });
    return () => ac.abort();
  }, [selected, requestId, reloadToken]);

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
          <h1>تفاصيل الدراسة الهندسية</h1>
          <p>الحالة، المستندات، الإجراء المطلوب، وجدول الكميات المعتمد.</p>
        </header>
        <CompanySelector companies={companies} selected={selected} onSelect={setSelected} />
        {!selected ? <p role="status">اختر شركة للمتابعة.</p> : null}
        {waitingBackend ? (
          <p className={styles.note} role="status" data-testid="engineering-waiting">
            بانتظار واجهة الخادم المعتمدة لتفاصيل الدراسات الهندسية. لا تُعرض بيانات وهمية.
          </p>
        ) : null}
        {error ? (
          <p className={styles.fieldError} role="alert" data-testid="engineering-foreign-denied">
            {error}
          </p>
        ) : null}
        {selected && !waitingBackend && !error && !detail ? <LoadingState /> : null}
        {selected && detail ? (
          <EngineeringRequestDetailView
            companyId={selected}
            detail={detail}
            onChanged={() => setReloadToken((value) => value + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
