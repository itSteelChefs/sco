'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type HNotificationPage } from '@sco/contracts';
import { api } from '../../lib/api';
import { EmptyState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import { OperationsSubnav, SourceLink, formatWhen } from './h-operations-shared';
import styles from './ops.module.css';

export function HOperationsNotifications() {
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [page, setPage] = useState<HNotificationPage>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function load(nextUnread = unreadOnly) {
    setError(undefined);
    try {
      setPage(await api.internalHNotifications({ unreadOnly: nextUnread, limit: 50, offset: 0 }));
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      setError(mapOpsError(failure, 'تعذر تحميل الإشعارات.'));
    }
  }

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function markRead(id: string) {
    setBusy(true);
    try {
      await api.internalHNotificationRead(id);
      await load(unreadOnly);
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر تعليم الإشعار كمقروء.'));
    } finally {
      setBusy(false);
    }
  }

  async function markAll() {
    setBusy(true);
    try {
      await api.internalHNotificationsReadAll();
      await load(unreadOnly);
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر تعليم الكل.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <OperationsSubnav />
      <section className={styles.panel} aria-labelledby="notif-title">
        <h2 id="notif-title">الإشعارات</h2>
        <p className={styles.muted}>مركز داخلي فقط — بلا قنوات خارجية.</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={unreadOnly ? styles.button : styles.buttonGhost}
            onClick={() => {
              setUnreadOnly(true);
              void load(true);
            }}
          >
            غير مقروء
          </button>
          <button
            type="button"
            className={!unreadOnly ? styles.button : styles.buttonGhost}
            onClick={() => {
              setUnreadOnly(false);
              void load(false);
            }}
          >
            الكل
          </button>
          <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => void markAll()}>
            تعليم الكل مقروءًا
          </button>
        </div>
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
        {page ? (
          <p className={styles.muted} role="status">
            غير مقروء: {page.unreadCount} · المعروض: {page.total}
          </p>
        ) : (
          <LoadingState />
        )}
      </section>

      {page ? (
        page.items.length === 0 ? (
          <EmptyState message="لا إشعارات." />
        ) : (
          <section className={styles.panel}>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">الحالة</th>
                    <th scope="col">النوع</th>
                    <th scope="col">العنوان</th>
                    <th scope="col">المصدر</th>
                    <th scope="col">الوقت</th>
                    <th scope="col">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((n) => (
                    <tr key={n.id}>
                      <td>
                        {n.readAt ? (
                          <span className={styles.badge}>مقروء</span>
                        ) : (
                          <span className={styles.badgeWarn}>غير مقروء</span>
                        )}
                      </td>
                      <td>{n.eventType}</td>
                      <td>
                        <strong>{n.title}</strong>
                        <div className={styles.muted}>{n.body}</div>
                      </td>
                      <td>
                        {n.domain && n.sourceEntityId ? (
                          <SourceLink domain={n.domain} entityType={n.eventType} entityId={n.sourceEntityId} />
                        ) : n.workItemId ? (
                          <Link className={styles.rowLink} href="/operations/my-work" dir="ltr">
                            work {n.workItemId.slice(0, 8)}…
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{formatWhen(n.createdAt)}</td>
                      <td>
                        {!n.readAt ? (
                          <button
                            type="button"
                            className={styles.buttonGhost}
                            disabled={busy}
                            onClick={() => void markRead(n.id)}
                          >
                            تعليم مقروء
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      ) : null}
    </div>
  );
}
