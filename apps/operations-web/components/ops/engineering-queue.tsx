'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ApiClientError, type InternalEngineeringRequestListItem } from '@sco/contracts';
import { api } from '../../lib/api';
import { engineeringStatusAr, formatWhen } from '../../lib/labels';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import styles from './ops.module.css';

const FILTERS: Array<{ id: string; label: string; match: (s: string) => boolean }> = [
  { id: 'all', label: 'الكل', match: () => true },
  { id: 'new', label: 'جديد', match: (s) => s === 'SUBMITTED' },
  { id: 'assigned', label: 'مُسنَد', match: (s) => s === 'ASSIGNED' },
  { id: 'review', label: 'قيد المراجعة', match: (s) => s === 'IN_REVIEW' || s === 'BOQ_IN_PROGRESS' },
  { id: 'action', label: 'يتطلب إجراءً', match: (s) => s === 'ACTION_REQUIRED' },
  { id: 'approval', label: 'بانتظار الاعتماد', match: (s) => s === 'PENDING_APPROVAL' },
  { id: 'completed', label: 'مكتمل', match: (s) => s === 'APPROVED' },
];

export function EngineeringQueue() {
  const router = useRouter();
  const search = useSearchParams();
  const filter = search.get('status') ?? 'all';
  const [rows, setRows] = useState<InternalEngineeringRequestListItem[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(undefined);
      try {
        const list = await api.internalEngineeringRequests();
        if (!cancelled) setRows(list);
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        if (!cancelled) setError(mapOpsError(failure, 'تعذر تحميل طابور الهندسة.'));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const rule = FILTERS.find((item) => item.id === filter) ?? FILTERS[0];
    return rows.filter((row) => rule.match(row.status));
  }, [rows, filter]);

  if (error && !rows) return <ErrorState message={error} />;
  if (!rows) return <LoadingState />;

  return (
    <div className={styles.panel} aria-labelledby="eng-queue-title">
      <h2 id="eng-queue-title">طابور الدراسات الهندسية</h2>
      <p className={styles.muted}>طلبات قابلة للتنفيذ فقط — بلا مؤشرات تجميلية.</p>

      <div className={styles.toolbar} aria-label="تصفية الطابور">
        {FILTERS.map((item) => (
          <Link
            key={item.id}
            href={`/engineering?status=${item.id}`}
            className={filter === item.id ? styles.button : styles.buttonGhost}
          >
            {item.label}
            {item.id !== 'all'
              ? ` (${rows.filter((row) => item.match(row.status)).length})`
              : ` (${rows.length})`}
          </Link>
        ))}
      </div>

      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState message="لا طلبات في هذا التصنيف." />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">العنوان</th>
                <th scope="col">القطاع</th>
                <th scope="col">الشركة</th>
                <th scope="col">الحالة</th>
                <th scope="col">المهندس</th>
                <th scope="col">آخر تحديث</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link className={styles.rowLink} href={`/engineering/${row.id}`}>
                      {row.title}
                    </Link>
                  </td>
                  <td>{row.sector}</td>
                  <td dir="ltr">{row.companyId.slice(0, 8)}…</td>
                  <td>
                    <span className={styles.badge}>{engineeringStatusAr(row.status)}</span>
                  </td>
                  <td dir="ltr">{row.assignedEngineerId ? `${row.assignedEngineerId.slice(0, 8)}…` : '—'}</td>
                  <td>{formatWhen(row.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
