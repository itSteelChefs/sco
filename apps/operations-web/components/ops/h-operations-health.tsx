'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type HHealth } from '@sco/contracts';
import { api } from '../../lib/api';
import { ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import { OperationsSubnav, formatWhen } from './h-operations-shared';
import styles from './ops.module.css';

export function HOperationsHealth() {
  const router = useRouter();
  const [health, setHealth] = useState<HHealth>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const row = await api.internalHHealth();
        if (!cancelled) setHealth(row);
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        if (!cancelled) setError(mapOpsError(failure, 'تعذر تحميل صحة النظام.'));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error && !health) return <ErrorState message={error} />;
  if (!health) {
    return (
      <div style={{ display: 'grid', gap: '1.25rem' }}>
        <OperationsSubnav />
        <LoadingState />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <OperationsSubnav />
      <section className={styles.panel} aria-labelledby="health-title">
        <h2 id="health-title">صحة النظام</h2>
        <p className={styles.muted}>حالة تشغيلية نصية — بلا مخططات تجميلية.</p>
        <p className={styles.note} role="status">
          آخر تحديث: {formatWhen(health.calculatedAt)}
        </p>
        <dl className={styles.dl}>
          <div>
            <dt>API</dt>
            <dd>
              <span className={health.api === 'ok' ? styles.badgeOk : styles.badgeDanger}>{health.api}</span>
            </dd>
          </div>
          <div>
            <dt>قاعدة البيانات</dt>
            <dd>
              <span className={health.database === 'ok' ? styles.badgeOk : styles.badgeDanger}>{health.database}</span>
            </dd>
          </div>
          <div>
            <dt>آخر ترحيل</dt>
            <dd dir="ltr">{health.latestMigration || '—'}</dd>
          </div>
          <div>
            <dt>المهام</dt>
            <dd dir="ltr">
              pending {health.jobs.pending} · running {health.jobs.running} · failed {health.jobs.failed} · succeeded{' '}
              {health.jobs.succeeded}
            </dd>
          </div>
          <div>
            <dt>الإشعارات غير المقروءة</dt>
            <dd dir="ltr">{health.notifications.unread}</dd>
          </div>
          <div>
            <dt>طابور العمل</dt>
            <dd dir="ltr">
              open {health.workQueue.open} · blocked {health.workQueue.blocked}
            </dd>
          </div>
          <div>
            <dt>حالات متعثرة مفتوحة</dt>
            <dd dir="ltr">{health.exceptions.open}</dd>
          </div>
          <div>
            <dt>حالة تحديث G</dt>
            <dd>
              آخر تشغيل {formatWhen(health.gRefresh?.lastRunAt)} · مُدرَج{' '}
              <span dir="ltr">{health.gRefresh?.lastInserted ?? '—'}</span>
            </dd>
          </div>
          <div>
            <dt>المستندات المتاحة</dt>
            <dd dir="ltr">{health.documents?.available ?? '—'}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
