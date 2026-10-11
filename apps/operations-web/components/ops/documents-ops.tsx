'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiClientError, type InternalDocumentListItem } from '@sco/contracts';
import { api } from '../../lib/api';
import { documentCategoryAr, formatWhen } from '../../lib/labels';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import styles from './ops.module.css';

export function DocumentsOps() {
  const router = useRouter();
  const [items, setItems] = useState<InternalDocumentListItem[]>();
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string>();
  const pageSize = 20;

  useEffect(() => {
    let cancelled = false;
    setItems(undefined);
    setError(undefined);
    void api
      .internalDocuments(page, pageSize)
      .then((result) => {
        if (!cancelled) setItems(result.items);
      })
      .catch((failure) => {
        if (cancelled) return;
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        setError(mapOpsError(failure, 'تعذر تحميل مستندات الشركاء.'));
      });
    return () => {
      cancelled = true;
    };
  }, [page, router]);

  if (error) return <ErrorState message={error} />;
  if (!items) return <LoadingState />;

  return (
    <section className={styles.panel} aria-labelledby="docs-title">
      <h2 id="docs-title">مستندات الشركاء (داخلي)</h2>
      <p className={styles.muted}>
        بيانات وصفية مصرّح بها فقط. لا مفاتيح تخزين ولا مسارات داخلية. التحميل الآمن يتم عبر سطح معتمد عندما يتوفر.
      </p>
      {!items.length ? (
        <EmptyState message="لا توجد مستندات ضمن هذه الصفحة." />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">الملف</th>
                <th scope="col">الشركة</th>
                <th scope="col">الفئة</th>
                <th scope="col">الربط</th>
                <th scope="col">الحالة</th>
                <th scope="col">الحجم</th>
                <th scope="col">تاريخ الرفع</th>
              </tr>
            </thead>
            <tbody>
              {items.map((doc) => (
                <tr key={doc.id}>
                  <td>{doc.filename}</td>
                  <td dir="ltr">{doc.company_id.slice(0, 8)}…</td>
                  <td>{documentCategoryAr(doc.document_category)}</td>
                  <td>
                    {doc.linked_entity_type || '—'}
                    {doc.linked_entity_id ? (
                      <>
                        <br />
                        <span className={styles.muted} dir="ltr">
                          {doc.linked_entity_id.slice(0, 8)}…
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span className={styles.badge}>{doc.status}</span>
                  </td>
                  <td dir="ltr">{doc.byte_size}</td>
                  <td>{formatWhen(doc.created_at)}</td>
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
      <p className={styles.note}>
        إن ظهر «غير مصرح» فالصلاحية ناقصة (`document.policy.manage` أو مسارات المراجعة المعتمدة). الواجهة لا تتجاوز سلطة
        الخادم.
      </p>
    </section>
  );
}
