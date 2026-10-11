'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type HWorkItem, type HWorkQueue } from '@sco/contracts';
import { api } from '../../lib/api';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import {
  OperationsSubnav,
  SourceLink,
  ageLabel,
  domainAr,
  formatWhen,
  statusAr,
} from './h-operations-shared';
import styles from './ops.module.css';

type Props = {
  title: string;
  defaultView: 'all' | 'my' | 'blocked' | 'unassigned' | 'aging';
  lead: string;
};

export function HOperationsQueue({ title, defaultView, lead }: Props) {
  const router = useRouter();
  const [view, setView] = useState(defaultView);
  const [domain, setDomain] = useState('');
  const [queue, setQueue] = useState<HWorkQueue>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [assignId, setAssignId] = useState('');
  const [assignUser, setAssignUser] = useState('');

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const page = await api.internalHWorkQueue({
        view,
        domain: domain || undefined,
        limit: 50,
        offset: 0,
      });
      setQueue(page);
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      if (failure instanceof ApiClientError && failure.status === 403) {
        setError('غير مصرح بعرض طابور العمليات.');
        setQueue(undefined);
        return;
      }
      setError(mapOpsError(failure, 'تعذر تحميل طابور العمليات.'));
    }
  }, [view, domain, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function transition(item: HWorkItem, status: string, blockedReason?: string) {
    setBusyId(item.id);
    setMessage(undefined);
    setError(undefined);
    try {
      await api.internalHWorkTransition(item.id, { status, blockedReason });
      setMessage(`تم تحديث الحالة إلى ${statusAr(status)}.`);
      await load();
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر تحديث الحالة.'));
    } finally {
      setBusyId(undefined);
    }
  }

  async function assign(event: FormEvent) {
    event.preventDefault();
    if (!assignId.trim() || !assignUser.trim()) return;
    setBusyId(assignId);
    setError(undefined);
    try {
      await api.internalHWorkAssign(assignId.trim(), { assigneeUserId: assignUser.trim() });
      setMessage('تم الإسناد.');
      setAssignId('');
      setAssignUser('');
      await load();
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر الإسناد.'));
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <OperationsSubnav />
      <section className={styles.panel} aria-labelledby="h-queue-title">
        <h2 id="h-queue-title">{title}</h2>
        <p className={styles.muted}>{lead}</p>
        <form
          className={styles.toolbar}
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <label className={styles.field}>
            العرض
            <select value={view} onChange={(e) => setView(e.target.value as typeof view)}>
              <option value="all">الكل</option>
              <option value="my">مهامي</option>
              <option value="unassigned">غير مسند</option>
              <option value="blocked">متعثر</option>
              <option value="aging">متقادم</option>
            </select>
          </label>
          <label className={styles.field}>
            المجال
            <select value={domain} onChange={(e) => setDomain(e.target.value)}>
              <option value="">الكل</option>
              {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((d) => (
                <option key={d} value={d}>
                  {d} — {domainAr(d)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={styles.button}>
            تحديث
          </button>
        </form>
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className={styles.ok} role="status">
            {message}
          </p>
        ) : null}
      </section>

      <section className={styles.panel} aria-labelledby="assign-title">
        <h3 id="assign-title">إسناد / إعادة إسناد</h3>
        <form className={styles.toolbar} onSubmit={(e) => void assign(e)}>
          <label className={styles.field}>
            معرّف عنصر العمل
            <input value={assignId} onChange={(e) => setAssignId(e.target.value)} dir="ltr" required />
          </label>
          <label className={styles.field}>
            المستخدم المسند
            <input value={assignUser} onChange={(e) => setAssignUser(e.target.value)} dir="ltr" required />
          </label>
          <button type="submit" className={styles.button} disabled={!!busyId}>
            إسناد
          </button>
        </form>
      </section>

      {!queue && !error ? <LoadingState /> : null}
      {queue ? (
        <section className={styles.panel}>
          <p className={styles.muted} role="status">
            العرض: {queue.view} · الإجمالي: {queue.total} — بلا مقاييس ملفّقة.
          </p>
          {queue.items.length === 0 ? (
            <EmptyState message="لا عناصر في هذا العرض." />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">إجراء مطلوب</th>
                    <th scope="col">المجال/المصدر</th>
                    <th scope="col">المرجع</th>
                    <th scope="col">مسند إلى</th>
                    <th scope="col">الأولوية</th>
                    <th scope="col">العمر</th>
                    <th scope="col">الحالة</th>
                    <th scope="col">الإجراء التالي</th>
                    <th scope="col">تحكم</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.actionRequired ? (
                          <span className={styles.badgeWarn}>نعم</span>
                        ) : (
                          <span className={styles.badge}>لا</span>
                        )}
                      </td>
                      <td>
                        {domainAr(item.domain)}
                        <div className={styles.muted}>{item.workType}</div>
                      </td>
                      <td>
                        <SourceLink
                          domain={item.domain}
                          entityType={item.sourceEntityType}
                          entityId={item.sourceEntityId}
                          label={item.sourceEntityType}
                        />
                        <div className={styles.muted} dir="ltr">
                          {item.sourceEntityId.slice(0, 8)}…
                        </div>
                      </td>
                      <td dir="ltr">{item.assignedUserId?.slice(0, 8) || '—'}</td>
                      <td dir="ltr">{item.priority}</td>
                      <td>{ageLabel(item.createdAt)}</td>
                      <td>
                        <span
                          className={
                            item.status === 'BLOCKED'
                              ? styles.badgeDanger
                              : item.status === 'IN_PROGRESS'
                                ? styles.badgeWarn
                                : item.status === 'DONE'
                                  ? styles.badgeOk
                                  : styles.badge
                          }
                        >
                          {statusAr(item.status)}
                        </span>
                        {item.blockedReason ? (
                          <div className={styles.muted}>{item.blockedReason}</div>
                        ) : null}
                      </td>
                      <td>{item.nextAction || '—'}</td>
                      <td>
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.buttonGhost}
                            disabled={busyId === item.id || item.status === 'IN_PROGRESS' || item.status === 'DONE'}
                            onClick={() => void transition(item, 'IN_PROGRESS')}
                          >
                            بدء
                          </button>
                          <button
                            type="button"
                            className={styles.buttonGhost}
                            disabled={busyId === item.id || item.status === 'DONE'}
                            onClick={() => void transition(item, 'DONE')}
                          >
                            إنهاء
                          </button>
                        </div>
                        <div className={styles.muted}>{formatWhen(item.updatedAt)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : error ? (
        <ErrorState message={error} />
      ) : null}
    </div>
  );
}
