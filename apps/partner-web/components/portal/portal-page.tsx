'use client';

import type { ReactNode } from 'react';
import { ErrorState, LoadingState } from '../product-state';
import styles from '../readiness/readiness.module.css';
import { CompanySelector } from './company-selector';
import { PortalChrome } from './portal-chrome';
import { usePortalSession } from './use-portal-session';

type Props = {
  title: string;
  lead: string;
  children: (ctx: {
    companyId: string;
    companyName: string;
    journey: NonNullable<ReturnType<typeof usePortalSession>['journey']>;
    agreements: ReturnType<typeof usePortalSession>['agreements'];
    reload: () => void;
  }) => ReactNode;
};

export function PortalPage({ title, lead, children }: Props) {
  const { companies, selected, setSelected, journey, agreements, error, reload } = usePortalSession();

  if (error && error !== 'UNAUTHENTICATED') {
    return (
      <div className={styles.page}>
        <PortalChrome />
        <div className={styles.shell}>
          <ErrorState message={error} onRetry={() => reload()} />
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

  if (!companies.length) {
    return (
      <div className={styles.page}>
        <PortalChrome />
        <div className={styles.shell}>
          <p role="status">لا توجد شركة نشطة متاحة لهذا الحساب.</p>
        </div>
      </div>
    );
  }

  const company = companies.find((item) => item.id === selected);

  return (
    <div className={styles.page}>
      <PortalChrome />
      <div className={styles.shell}>
        <header className={styles.intro}>
          <h1>{title}</h1>
          <p>{lead}</p>
        </header>
        <CompanySelector companies={companies} selected={selected} onSelect={setSelected} />
        {!selected ? <p role="status">اختر شركة للمتابعة.</p> : null}
        {selected && !journey ? <LoadingState /> : null}
        {selected && journey && company
          ? children({
              companyId: selected,
              companyName: company.name,
              journey,
              agreements,
              reload,
            })
          : null}
      </div>
    </div>
  );
}
