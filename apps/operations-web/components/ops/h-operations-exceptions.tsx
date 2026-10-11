'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type HException, type HWorkQueue } from '@sco/contracts';
import { api } from '../../lib/api';
import { EmptyState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import {
  OperationsSubnav,
  SourceLink,
  formatWhen,
  statusAr,
} from './h-operations-shared';
import styles from './ops.module.css';

export function HOperationsExceptions() {
  const router = useRouter();
  const [lookup, setLookup] = useState('');
  const [ex, setEx] = useState<HException>();
  const [blocked, setBlocked] = useState<HWorkQueue>();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [openCount, setOpenCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadRelated() {
      try {
        const [health, queue] = await Promise.all([
          api.internalHHealth().catch(() => null),
          api.internalHWorkQueue({ view: 'blocked', limit: 50 }),
        ]);
        if (cancelled) return;
        setOpenCount(health?.exceptions?.open ?? null);
        setBlocked(queue);
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
        }
      }
    }
    void loadRelated();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function openException(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      setEx(await api.internalHExceptionGet(lookup.trim()));
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      setEx(undefined);
      setError(mapOpsError(failure, 'تعذر فتح الحالة المتعثرة.'));
    } finally {
      setBusy(false);
    }
  }

  async function ack() {
    if (!ex) return;
    setBusy(true);
    setError(undefined);
    try {
      setEx(await api.internalHExceptionAck(ex.id));
      setMessage('تم الإقرار.');
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر الإقرار.'));
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!ex) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.internalHExceptionRetry(ex.id);
      setMessage(`محاولة إعادة #${result.attempt}`);
      setEx(await api.internalHExceptionGet(ex.id));
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر إعادة المحاولة.'));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(event: FormEvent) {
    event.preventDefault();
    if (!ex) return;
    setBusy(true);
    setError(undefined);
    try {
      setEx(await api.internalHExceptionResolve(ex.id, { note: note.trim() || undefined }));
      setMessage('تم الحل مع ملاحظة.');
      setNote('');
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر الحل.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <OperationsSubnav />
      <section className={styles.panel} aria-labelledby="ex-title">
        <h2 id="ex-title">الحالات المتعثرة</h2>
        <p className={styles.muted}>
          ملخص آمن فقط — بلا تتبع مكدّس خام. المفتوح حاليًا:{' '}
          <span dir="ltr">{openCount == null ? '—' : openCount}</span>
        </p>
        <form className={styles.toolbar} onSubmit={(e) => void openException(e)}>
          <label className={styles.field}>
            معرّف الحالة
            <input value={lookup} onChange={(e) => setLookup(e.target.value)} dir="ltr" required />
          </label>
          <button type="submit" className={styles.button} disabled={busy}>
            فتح
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

      {busy && !ex ? <LoadingState /> : null}

      {ex ? (
        <section className={styles.panel} aria-labelledby="ex-detail">
          <h3 id="ex-detail">تفاصيل الحالة</h3>
          <dl className={styles.dl}>
            <div>
              <dt>الفئة</dt>
              <dd>{ex.exceptionType}</dd>
            </div>
            <div>
              <dt>المصدر</dt>
              <dd>
                {ex.domain}
                {ex.workItemId ? (
                  <>
                    {' · '}
                    <span dir="ltr">work {ex.workItemId.slice(0, 8)}…</span>
                  </>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>ملخص الخطأ الآمن</dt>
              <dd>
                <span className={styles.badgeDanger}>{ex.safeErrorCode}</span>
                <div>{ex.safeErrorMessage}</div>
              </dd>
            </div>
            <div>
              <dt>أول/آخر ظهور</dt>
              <dd>
                {formatWhen(ex.createdAt)} · آخر محاولة {formatWhen(ex.lastAttemptAt)}
              </dd>
            </div>
            <div>
              <dt>المحاولات</dt>
              <dd dir="ltr">
                {ex.attemptCount}/{ex.maxAttempts}
              </dd>
            </div>
            <div>
              <dt>قابل لإعادة المحاولة</dt>
              <dd>{ex.retryable ? 'نعم' : 'لا'}</dd>
            </div>
            <div>
              <dt>الحالة</dt>
              <dd>
                <span className={styles.badge}>{statusAr(ex.status)}</span>
              </dd>
            </div>
          </dl>
          <div className={styles.actions}>
            <button type="button" className={styles.buttonGhost} disabled={busy || ex.status === 'RESOLVED'} onClick={() => void ack()}>
              إقرار
            </button>
            <button
              type="button"
              className={styles.buttonGhost}
              disabled={busy || !ex.retryable || ex.status === 'RESOLVED'}
              onClick={() => void retry()}
            >
              إعادة محاولة
            </button>
          </div>
          <form className={styles.confirmBox} onSubmit={(e) => void resolve(e)}>
            <label className={styles.field}>
              ملاحظة الحل
              <textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={busy || ex.status === 'RESOLVED'} />
            </label>
            <button type="submit" className={styles.button} disabled={busy || ex.status === 'RESOLVED'}>
              حل مع ملاحظة
            </button>
          </form>
        </section>
      ) : null}

      <section className={styles.panel} aria-labelledby="blocked-work">
        <h3 id="blocked-work">عناصر عمل متعثرة (مرتبطة)</h3>
        {!blocked ? (
          <LoadingState />
        ) : blocked.items.length === 0 ? (
          <EmptyState message="لا عناصر عمل بحالة متعثرة." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">المصدر</th>
                  <th scope="col">السبب</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">مسند</th>
                </tr>
              </thead>
              <tbody>
                {blocked.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <SourceLink
                        domain={item.domain}
                        entityType={item.sourceEntityType}
                        entityId={item.sourceEntityId}
                      />
                    </td>
                    <td>{item.blockedReason || '—'}</td>
                    <td>{statusAr(item.status)}</td>
                    <td dir="ltr">{item.assignedUserId?.slice(0, 8) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
