'use client';

import { CompanySelector } from '../portal/company-selector';
import { PortalChrome } from '../portal/portal-chrome';
import { usePortalSession } from '../portal/use-portal-session';
import { ErrorState, LoadingState } from '../product-state';
import { EngineeringCreateForm } from './engineering-create-form';
import { engineeringApi } from '../../lib/engineering-api';
import styles from './engineering.module.css';

export function EngineeringCreateWorkspace() {
  const { companies, selected, setSelected, error: sessionError, reload } = usePortalSession();
  const waitingBackend = !engineeringApi.isReady();

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
          <h1>طلب دراسة جديدة</h1>
          <p>أنشئ مسودة طلب هندسي لشركتك عبر سكو.</p>
        </header>
        <CompanySelector companies={companies} selected={selected} onSelect={setSelected} />
        {!selected ? <p role="status">اختر شركة للمتابعة.</p> : null}
        {selected ? <EngineeringCreateForm companyId={selected} waitingBackend={waitingBackend} /> : null}
      </div>
    </div>
  );
}
