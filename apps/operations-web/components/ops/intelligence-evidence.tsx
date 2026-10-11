'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ApiClientError, type GEvidencePage } from '@sco/contracts';
import { api } from '../../lib/api';
import { EmptyState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import {
  FreshnessBlock,
  IntelligenceSubnav,
  factKindAr,
  formatMoney,
  formatWhen,
} from './intelligence-shared';
import styles from './ops.module.css';

const PAGE = 25;

export function IntelligenceEvidence() {
  const router = useRouter();
  const search = useSearchParams();
  const [comparableKey, setComparableKey] = useState(search.get('comparableKey') || '');
  const [factKind, setFactKind] = useState(search.get('factKind') || '');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<GEvidencePage>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load(nextKey: string, nextKind: string, nextOffset: number) {
    setLoading(true);
    setError(undefined);
    try {
      const result = await api.internalGEvidence({
        comparableKey: nextKey || undefined,
        factKind: nextKind || undefined,
        limit: PAGE,
        offset: nextOffset,
      });
      setPage(result);
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      if (failure instanceof ApiClientError && failure.status === 403) {
        setError('غير مصرح بتفصيل الأدلة.');
        setPage(undefined);
        return;
      }
      setPage(undefined);
      setError(mapOpsError(failure, 'تعذر تحميل الأدلة.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(comparableKey, factKind, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    void load(comparableKey.trim(), factKind, 0);
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <IntelligenceSubnav />
      <section className={styles.panel} aria-labelledby="ev-title">
        <h2 id="ev-title">الأدلة</h2>
        <p className={styles.muted}>مراجع آمنة داخلية — بلا بيانات شريك مخفية خارج الصلاحية.</p>
        <form className={styles.toolbar} onSubmit={onSubmit}>
          <label className={styles.field}>
            المفتاح المقارن
            <input
              value={comparableKey}
              onChange={(e) => setComparableKey(e.target.value)}
              dir="ltr"
            />
          </label>
          <label className={styles.field}>
            نوع الحقيقة
            <select value={factKind} onChange={(e) => setFactKind(e.target.value)}>
              <option value="">الكل</option>
              <option value="QUOTE_OBSERVED">أسعار العروض</option>
              <option value="QUOTE_SELECTED">الأسعار المختارة</option>
              <option value="SUPPLIER_CONFIRMED">أسعار الشراء المؤكدة</option>
              <option value="ENGINEERING_DEMAND">طلب هندسي</option>
            </select>
          </label>
          <button type="submit" className={styles.button} disabled={loading}>
            بحث
          </button>
        </form>
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {loading && !page ? <LoadingState /> : null}
      {page ? (
        <section className={styles.panel}>
          <FreshnessBlock calculatedAt={page.calculatedAt} sampleCount={page.total} />
          {page.items.length === 0 ? (
            <EmptyState message="لا أدلة مطابقة." />
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">التاريخ</th>
                      <th scope="col">النوع</th>
                      <th scope="col">السعر</th>
                      <th scope="col">الوحدة</th>
                      <th scope="col">المورّد</th>
                      <th scope="col">المصدر</th>
                      <th scope="col">كيان المصدر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((row) => (
                      <tr key={row.factId}>
                        <td>{formatWhen(row.effectiveAt)}</td>
                        <td>
                          <span className={styles.badge}>{factKindAr(row.factKind)}</span>
                        </td>
                        <td dir="ltr">{formatMoney(row.unitPrice, row.currencyCode)}</td>
                        <td dir="ltr">{row.unitId?.slice(0, 8) || '—'}</td>
                        <td dir="ltr">
                          {row.supplierCompanyId ? (
                            <Link
                              className={styles.rowLink}
                              href={`/intelligence/suppliers/${row.supplierCompanyId}`}
                            >
                              {row.supplierCompanyId.slice(0, 8)}…
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td dir="ltr">
                          {row.sourceDomain}/{row.sourceEntityType}
                        </td>
                        <td dir="ltr">{row.sourceEntityId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.buttonGhost}
                  disabled={offset <= 0 || loading}
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
                >
                  السابق
                </button>
                <span className={styles.muted} role="status">
                  {page.offset + 1}–{page.offset + page.items.length} / {page.total}
                </span>
                <button
                  type="button"
                  className={styles.buttonGhost}
                  disabled={loading || page.offset + page.items.length >= page.total}
                  onClick={() => setOffset((o) => o + PAGE)}
                >
                  التالي
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
