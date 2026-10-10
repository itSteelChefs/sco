'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ApiClientError, type InternalQualificationListItem } from '@sco/contracts';
import { api } from '../../lib/api';
import { formatWhen, qualificationStatusAr } from '../../lib/labels';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import styles from './ops.module.css';

const FILTERS = [
  { value: '', label: 'الكل' },
  { value: 'SUBMITTED', label: 'مُرسَل' },
  { value: 'UNDER_REVIEW', label: 'قيد المراجعة' },
  { value: 'ACTION_REQUIRED', label: 'يتطلب إجراءً' },
  { value: 'APPROVED', label: 'معتمد' },
  { value: 'REJECTED', label: 'مرفوض' },
] as const;

export function QualificationQueue() {
  const router = useRouter();
  const search = useSearchParams();
  const statusFilter = search.get('status') ?? '';
  const [items, setItems] = useState<InternalQualificationListItem[]>();
  const [error, setError] = useState<string>();
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    setItems(undefined);
    void api
      .internalQualifications()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((failure) => {
        if (cancelled) return;
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        setError(mapOpsError(failure, 'تعذر تحميل طابور التأهيل.'));
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const filtered = useMemo(() => {
    if (!items) return [];
    return statusFilter ? items.filter((item) => item.status === statusFilter) : items;
  }, [items, statusFilter]);

  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  if (error) return <ErrorState message={error} />;
  if (!items) return <LoadingState />;

  return (
    <section className={styles.panel} aria-labelledby="qual-queue-title">
      <h2 id="qual-queue-title">طابور مراجعة التأهيل</h2>
      <div className={styles.toolbar}>
        <label className={styles.field}>
          الحالة
          <select
            value={statusFilter}
            onChange={(event) => {
              setPage(1);
              const value = event.target.value;
              router.replace(value ? `/qualifications?status=${encodeURIComponent(value)}` : '/qualifications');
            }}
          >
            {FILTERS.map((filter) => (
              <option key={filter.value || 'all'} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.muted} role="status">
          {filtered.length} نتيجة · صفحة {page} من {totalPages}
        </p>
      </div>
      {!pageItems.length ? (
        <EmptyState message="لا توجد طلبات تأهيل ضمن هذا التصفية." />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">الشركة</th>
                <th scope="col">تاريخ الإرسال/الإنشاء</th>
                <th scope="col">الحالة</th>
                <th scope="col">مراجعة</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link className={styles.rowLink} href={`/qualifications/${item.id}`}>
                      {item.legalName}
                    </Link>
                  </td>
                  <td>{formatWhen(item.createdAt)}</td>
                  <td>
                    <span className={styles.badge}>{qualificationStatusAr(item.status)}</span>
                  </td>
                  <td>
                    <Link className={styles.rowLink} href={`/qualifications/${item.id}`}>
                      فتح المراجعة
                    </Link>
                  </td>
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
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          التالي
        </button>
      </div>
      <p className={styles.note}>
        لا تُعرض حقول تشغيلية حساسة في الطابور. التفاصيل تُفتح من صفحة المراجعة فقط. البريد الظاهر هو بريد التواصل
        التشغيلي المصرّح به في الطلب.
      </p>
    </section>
  );
}
