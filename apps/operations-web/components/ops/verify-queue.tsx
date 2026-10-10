'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiClientError, type InternalVerifyQueueItem } from '@sco/contracts';
import { api } from '../../lib/api';
import { classificationAr, formatWhen, verifyRequestStatusAr, verifyResultStatusAr } from '../../lib/labels';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import styles from './ops.module.css';

const FILTERS = [
  { value: '', label: 'الكل' },
  { value: 'SUBMITTED', label: 'مُرسَل' },
  { value: 'IN_REVIEW', label: 'قيد المراجعة' },
  { value: 'PREPARED', label: 'بانتظار الاعتماد' },
  { value: 'COMPLETED', label: 'مكتمل' },
] as const;

export function VerifyQueue() {
  const router = useRouter();
  const search = useSearchParams();
  const status = search.get('status') ?? '';
  const [items, setItems] = useState<InternalVerifyQueueItem[]>();
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string>();
  const pageSize = 20;

  useEffect(() => {
    let cancelled = false;
    setItems(undefined);
    setError(undefined);
    void api
      .internalVerifyQueue(page, pageSize, status || undefined)
      .then((result) => {
        if (!cancelled) setItems(result.items);
      })
      .catch((failure) => {
        if (cancelled) return;
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        setError(mapOpsError(failure, 'تعذر تحميل طابور التوثيق.'));
      });
    return () => {
      cancelled = true;
    };
  }, [page, status, router]);

  if (error) return <ErrorState message={error} />;
  if (!items) return <LoadingState />;

  return (
    <section className={styles.panel} aria-labelledby="verify-queue-title">
      <h2 id="verify-queue-title">طابور تأكّد التشغيلي</h2>
      <div className={styles.toolbar}>
        <label className={styles.field}>
          التصفية
          <select
            value={status}
            onChange={(event) => {
              setPage(1);
              const value = event.target.value;
              router.replace(value ? `/verify?status=${encodeURIComponent(value)}` : '/verify');
            }}
          >
            {FILTERS.map((filter) => (
              <option key={filter.value || 'all'} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!items.length ? (
        <EmptyState message="لا توجد طلبات ضمن هذه التصفية." />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">الطلب</th>
                <th scope="col">الشركة</th>
                <th scope="col">حالة الطلب</th>
                <th scope="col">التشغيل</th>
                <th scope="col">النتيجة</th>
                <th scope="col">التصنيف</th>
                <th scope="col">تحديث</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.request_id}-${item.run_id ?? 'none'}`}>
                  <td>
                    <Link className={styles.rowLink} href={`/verify/${item.request_id}?revisionId=${item.revision_id ?? ''}&runId=${item.run_id ?? ''}&resultId=${item.result_id ?? ''}`}>
                      {item.request_id.slice(0, 8)}…
                    </Link>
                  </td>
                  <td dir="ltr">{item.company_id.slice(0, 8)}…</td>
                  <td>{verifyRequestStatusAr(item.request_status)}</td>
                  <td>{item.run_status || '—'}</td>
                  <td>{verifyResultStatusAr(item.result_status)}</td>
                  <td>{classificationAr(item.classification)}</td>
                  <td>{formatWhen(item.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.buttonGhost} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          السابق
        </button>
        <button
          type="button"
          className={styles.buttonGhost}
          disabled={items.length < pageSize}
          onClick={() => setPage((p) => p + 1)}
        >
          التالي
        </button>
      </div>
    </section>
  );
}
