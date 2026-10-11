'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type HAuditEvidencePage } from '@sco/contracts';
import { api } from '../../lib/api';
import { EmptyState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import { OperationsSubnav, formatWhen } from './h-operations-shared';
import styles from './ops.module.css';

export function HOperationsAudit() {
  const router = useRouter();
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const [page, setPage] = useState<HAuditEvidencePage>();
  const [error, setError] = useState<string>();

  async function load(event?: FormEvent) {
    event?.preventDefault();
    setError(undefined);
    try {
      setPage(
        await api.internalHAuditEvidence({
          action: action || undefined,
          entityId: entityId || undefined,
          limit: 50,
          offset: 0,
        }),
      );
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      setError(mapOpsError(failure, 'تعذر تحميل أدلة التدقيق.'));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <OperationsSubnav />
      <section className={styles.panel} aria-labelledby="audit-title">
        <h2 id="audit-title">أدلة التدقيق التشغيلية</h2>
        <p className={styles.muted}>أحداث H فقط — فاعل · كائن · إجراء · نتيجة · وقت.</p>
        <form className={styles.toolbar} onSubmit={(e) => void load(e)}>
          <label className={styles.field}>
            الإجراء
            <input value={action} onChange={(e) => setAction(e.target.value)} dir="ltr" placeholder="h.work_item.…" />
          </label>
          <label className={styles.field}>
            معرّف الكائن
            <input value={entityId} onChange={(e) => setEntityId(e.target.value)} dir="ltr" />
          </label>
          <button type="submit" className={styles.button}>
            تصفية
          </button>
        </form>
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {!page && !error ? <LoadingState /> : null}
      {page ? (
        page.items.length === 0 ? (
          <EmptyState message="لا أحداث مطابقة." />
        ) : (
          <section className={styles.panel}>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">الوقت</th>
                    <th scope="col">الفاعل</th>
                    <th scope="col">الكائن</th>
                    <th scope="col">الإجراء</th>
                    <th scope="col">النتيجة / البيانات</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((row) => (
                    <tr key={row.id}>
                      <td>{formatWhen(row.createdAt)}</td>
                      <td dir="ltr">{row.actorUserId?.slice(0, 8) || '—'}</td>
                      <td>
                        {row.entityType}
                        <div className={styles.muted} dir="ltr">
                          {row.entityId}
                        </div>
                      </td>
                      <td dir="ltr">{row.action}</td>
                      <td dir="ltr" className={styles.muted}>
                        {row.metadata ? JSON.stringify(row.metadata) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.muted} role="status">
              {page.total} حدث
            </p>
          </section>
        )
      ) : null}
    </div>
  );
}
