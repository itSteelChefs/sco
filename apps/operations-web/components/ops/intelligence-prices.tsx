'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  ApiClientError,
  type GEvidencePage,
  type GPriceHistory,
} from '@sco/contracts';
import { api } from '../../lib/api';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import {
  FreshnessBlock,
  IntelligenceSubnav,
  PriceStatsCard,
  factKindAr,
  formatMoney,
  formatWhen,
} from './intelligence-shared';
import styles from './ops.module.css';

const PAGE = 25;

type Filters = {
  sector: string;
  comparableKey: string;
  supplierCompanyId: string;
  currencyCode: string;
  unitId: string;
  from: string;
  to: string;
  factKind: string;
};

const emptyFilters: Filters = {
  sector: '',
  comparableKey: '',
  supplierCompanyId: '',
  currencyCode: '',
  unitId: '',
  from: '',
  to: '',
  factKind: '',
};

export function IntelligencePrices() {
  const router = useRouter();
  const search = useSearchParams();
  const initialFilters: Filters = {
    ...emptyFilters,
    sector: search.get('sector') || '',
    comparableKey: search.get('comparableKey') || '',
    supplierCompanyId: search.get('supplierCompanyId') || '',
    currencyCode: search.get('currencyCode') || '',
    unitId: search.get('unitId') || '',
    factKind: search.get('factKind') || '',
  };
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [applied, setApplied] = useState<Filters>(initialFilters);
  const [history, setHistory] = useState<GPriceHistory>();
  const [evidence, setEvidence] = useState<GEvidencePage>();
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (nextFilters: Filters, nextOffset: number) => {
      setLoading(true);
      setError(undefined);
      try {
        const [hist, ev] = await Promise.all([
          api.internalGPriceHistory({
            sector: nextFilters.sector || undefined,
            comparableKey: nextFilters.comparableKey || undefined,
            supplierCompanyId: nextFilters.supplierCompanyId || undefined,
            currencyCode: nextFilters.currencyCode || undefined,
            unitId: nextFilters.unitId || undefined,
            from: nextFilters.from ? new Date(nextFilters.from).toISOString() : undefined,
            to: nextFilters.to ? new Date(nextFilters.to).toISOString() : undefined,
          }),
          api.internalGEvidence({
            comparableKey: nextFilters.comparableKey || undefined,
            factKind: nextFilters.factKind || undefined,
            limit: PAGE,
            offset: nextOffset,
          }),
        ]);
        setHistory(hist);
        setEvidence(ev);
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        setHistory(undefined);
        setEvidence(undefined);
        setError(mapOpsError(failure, 'تعذر تحميل سجل الأسعار.'));
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    void load(applied, offset);
  }, [applied, offset, load]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setApplied({ ...filters });
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <IntelligenceSubnav />
      <section className={styles.panel} aria-labelledby="price-filters">
        <h2 id="price-filters">سجل الأسعار</h2>
        <p className={styles.muted}>
          فلاتر الفئة / المرجع المقارن / المورّد / الفترة. السلاسل الثلاث مفصولة بصريًا دائمًا.
        </p>
        <form className={styles.toolbar} onSubmit={onSubmit}>
          <label className={styles.field}>
            الفئة (sector)
            <input
              value={filters.sector}
              onChange={(e) => setFilters((f) => ({ ...f, sector: e.target.value }))}
              dir="ltr"
              placeholder="HVAC"
            />
          </label>
          <label className={styles.field}>
            المفتاح المقارن
            <input
              value={filters.comparableKey}
              onChange={(e) => setFilters((f) => ({ ...f, comparableKey: e.target.value }))}
              dir="ltr"
            />
          </label>
          <label className={styles.field}>
            المورّد (إن صُرّح)
            <input
              value={filters.supplierCompanyId}
              onChange={(e) => setFilters((f) => ({ ...f, supplierCompanyId: e.target.value }))}
              dir="ltr"
            />
          </label>
          <label className={styles.field}>
            العملة
            <input
              value={filters.currencyCode}
              onChange={(e) => setFilters((f) => ({ ...f, currencyCode: e.target.value.toUpperCase() }))}
              dir="ltr"
              maxLength={3}
              placeholder="SAR"
            />
          </label>
          <label className={styles.field}>
            الوحدة
            <input
              value={filters.unitId}
              onChange={(e) => setFilters((f) => ({ ...f, unitId: e.target.value }))}
              dir="ltr"
            />
          </label>
          <label className={styles.field}>
            من تاريخ
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            />
          </label>
          <label className={styles.field}>
            إلى تاريخ
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            />
          </label>
          <label className={styles.field}>
            نوع السجل في الجدول
            <select
              value={filters.factKind}
              onChange={(e) => setFilters((f) => ({ ...f, factKind: e.target.value }))}
            >
              <option value="">الكل</option>
              <option value="QUOTE_OBSERVED">أسعار العروض</option>
              <option value="QUOTE_SELECTED">الأسعار المختارة</option>
              <option value="SUPPLIER_CONFIRMED">أسعار الشراء المؤكدة</option>
            </select>
          </label>
          <button type="submit" className={styles.button}>
            تطبيق الفلاتر
          </button>
        </form>
      </section>

      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      {loading && !history ? <LoadingState /> : null}

      {history ? (
        <>
          <FreshnessBlock
            calculatedAt={history.calculatedAt}
            sourceMaxEffectiveAt={history.sourceMaxEffectiveAt}
            sampleCount={
              (history.quotedHistory?.sampleCount ?? 0) +
              (history.selectedQuoteHistory?.sampleCount ?? 0) +
              (history.confirmedPurchaseHistory?.sampleCount ?? 0)
            }
          />
          <p className={styles.note} role="status">
            عدد الموردين في العيّنة: <span dir="ltr">{history.supplierCount ?? '—'}</span> · العملة:{' '}
            <span dir="ltr">{history.currencyCode || '—'}</span> · الوحدة:{' '}
            <span dir="ltr">{history.unitId || '—'}</span>
          </p>
          <div className={styles.split}>
            <PriceStatsCard
              title="أسعار العروض"
              seriesKind="QUOTE_OBSERVED"
              stats={history.quotedHistory}
              currency={history.currencyCode}
              emptyMessage="لا توجد بيانات عروض كافية."
            />
            <PriceStatsCard
              title="الأسعار المختارة"
              seriesKind="QUOTE_SELECTED"
              stats={history.selectedQuoteHistory}
              currency={history.currencyCode}
              emptyMessage="لا توجد أسعار مختارة في هذه الفترة."
            />
            <PriceStatsCard
              title="أسعار الشراء المؤكدة"
              seriesKind="SUPPLIER_CONFIRMED"
              stats={history.confirmedPurchaseHistory}
              currency={history.currencyCode}
              emptyMessage="لا توجد بيانات شراء مؤكدة كافية."
            />
          </div>
        </>
      ) : null}

      <section className={styles.panel} aria-labelledby="price-table">
        <h2 id="price-table">جدول الأدلة السعرية</h2>
        {!evidence ? (
          loading ? null : <ErrorState message="تعذر تحميل الجدول." />
        ) : evidence.items.length === 0 ? (
          <EmptyState message="لا سجلات مطابقة للفلاتر — بلا أصفار ملفّقة." />
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">التاريخ</th>
                    <th scope="col">النوع</th>
                    <th scope="col">البند / المفتاح</th>
                    <th scope="col">الوحدة</th>
                    <th scope="col">السياق الكمي</th>
                    <th scope="col">العملة</th>
                    <th scope="col">السعر</th>
                    <th scope="col">المورّد</th>
                    <th scope="col">مصدر/دليل</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.items.map((row) => (
                    <tr key={row.factId}>
                      <td>{formatWhen(row.effectiveAt)}</td>
                      <td>
                        <span
                          className={
                            row.factKind === 'SUPPLIER_CONFIRMED'
                              ? styles.badgeOk
                              : row.factKind === 'QUOTE_SELECTED'
                                ? styles.badgeWarn
                                : styles.badge
                          }
                        >
                          {factKindAr(row.factKind)}
                        </span>
                      </td>
                      <td dir="ltr">{row.comparableKey?.slice(0, 12) || '—'}…</td>
                      <td dir="ltr">{row.unitId?.slice(0, 8) || '—'}</td>
                      <td className={styles.muted}>من الحمولة عند التوفر</td>
                      <td dir="ltr">{row.currencyCode || '—'}</td>
                      <td dir="ltr">{formatMoney(row.unitPrice, row.currencyCode)}</td>
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
                      <td>
                        <Link
                          className={styles.rowLink}
                          href={`/intelligence/evidence?comparableKey=${encodeURIComponent(row.comparableKey || '')}&factKind=${encodeURIComponent(row.factKind)}`}
                        >
                          {row.sourceDomain}/{row.sourceEntityType}
                        </Link>
                      </td>
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
                عرض {evidence.offset + 1}–{evidence.offset + evidence.items.length} من {evidence.total}
              </span>
              <button
                type="button"
                className={styles.buttonGhost}
                disabled={loading || evidence.offset + evidence.items.length >= evidence.total}
                onClick={() => setOffset((o) => o + PAGE)}
              >
                التالي
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
