'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ApiClientError, type GDemandSignals } from '@sco/contracts';
import { api } from '../../lib/api';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import { FreshnessBlock, IntelligenceSubnav, formatNum, formatWhen } from './intelligence-shared';
import styles from './ops.module.css';

/** Group quantities by unit — never sum mixed units. */
function quantityBuckets(
  rows: Array<{ quantity?: number | string | null; unitId?: string | null }>,
): Array<{ unitId: string; count: number; quantitySum: number | null }> {
  const map = new Map<string, { count: number; quantities: number[] }>();
  for (const row of rows) {
    const unit = row.unitId || 'UNKNOWN_UNIT';
    const entry = map.get(unit) || { count: 0, quantities: [] };
    entry.count += 1;
    const q = row.quantity == null || row.quantity === '' ? NaN : Number(row.quantity);
    if (Number.isFinite(q)) entry.quantities.push(q);
    map.set(unit, entry);
  }
  return Array.from(map.entries()).map(([unitId, v]) => ({
    unitId,
    count: v.count,
    quantitySum: v.quantities.length ? v.quantities.reduce((a, b) => a + b, 0) : null,
  }));
}

export function IntelligenceDemand() {
  const router = useRouter();
  const search = useSearchParams();
  const [sector, setSector] = useState(search.get('sector') || '');
  const [windowDays, setWindowDays] = useState(search.get('windowDays') || '90');
  const [data, setData] = useState<GDemandSignals>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load(nextSector: string, nextWindow: number) {
    setLoading(true);
    setError(undefined);
    try {
      const row = await api.internalGDemandSignals({
        sector: nextSector || undefined,
        windowDays: nextWindow,
      });
      setData(row);
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      setData(undefined);
      setError(mapOpsError(failure, 'تعذر تحميل إشارات الطلب.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(sector, Number(windowDays) || 90);
    // initial only from URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void load(sector.trim(), Number(windowDays) || 90);
  }

  const engBuckets = data ? quantityBuckets(data.recentEngineeringDemand) : [];

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <IntelligenceSubnav />
      <section className={styles.panel} aria-labelledby="demand-title">
        <h2 id="demand-title">إشارات الطلب</h2>
        <p className={styles.muted}>طلب ملاحظ تشغيليًا — ليس تنبؤًا (forecast) ولا طلبًا متوقعًا.</p>
        <form className={styles.toolbar} onSubmit={onSubmit}>
          <label className={styles.field}>
            الفئة
            <input value={sector} onChange={(e) => setSector(e.target.value)} dir="ltr" placeholder="HVAC" />
          </label>
          <label className={styles.field}>
            نافذة الأيام
            <select value={windowDays} onChange={(e) => setWindowDays(e.target.value)}>
              <option value="30">نشاط آخر 30 يوم</option>
              <option value="90">نشاط آخر 90 يوم</option>
            </select>
          </label>
          <button type="submit" className={styles.button} disabled={loading}>
            تحديث
          </button>
        </form>
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {loading && !data ? <LoadingState /> : null}
      {data ? (
        <>
          <FreshnessBlock calculatedAt={data.calculatedAt} sourceMaxEffectiveAt={data.sourceMaxEffectiveAt} />
          <p className={styles.note} role="status">
            الدلالة: {data.semantics} · النافذة: {data.windowDays} يوم
          </p>

          <section className={styles.panel} aria-labelledby="open-demand">
            <h3 id="open-demand">الطلب المفتوح</h3>
            {data.openDemand.length === 0 ? (
              <EmptyState message="لا طلبات مفتوحة مطابقة." />
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">العنوان</th>
                      <th scope="col">الفئة</th>
                      <th scope="col">الحالة</th>
                      <th scope="col">عدد البنود</th>
                      <th scope="col">التقديم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.openDemand.map((row) => (
                      <tr key={row.requirementId}>
                        <td>{row.title || '—'}</td>
                        <td dir="ltr">{row.sector || '—'}</td>
                        <td>
                          <span className={styles.badge}>{row.status}</span>
                        </td>
                        <td dir="ltr">{formatNum(row.lineCount, 0)}</td>
                        <td>{formatWhen(row.submittedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={styles.panel} aria-labelledby="eng-demand">
            <h3 id="eng-demand">طلب هندسي حديث</h3>
            {engBuckets.length > 1 ? (
              <p className={styles.note} role="status">
                وحدات مختلطة — تُعرض دلاء منفصلة؛ لا جمع كمي عبر وحدات غير متوافقة.
              </p>
            ) : null}
            {engBuckets.length ? (
              <ul>
                {engBuckets.map((b) => (
                  <li key={b.unitId}>
                    وحدة <span dir="ltr">{b.unitId}</span>: عدد الطلبات {b.count}
                    {b.quantitySum != null ? (
                      <>
                        {' '}
                        · مجموع الكمية داخل الوحدة فقط: <span dir="ltr">{formatNum(b.quantitySum)}</span>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="لا طلب هندسي في النافذة." />
            )}
          </section>

          <section className={styles.panel} aria-labelledby="hist-commercial">
            <h3 id="hist-commercial">نشاط تجاري تاريخي (ملاحظ)</h3>
            {data.historicalCommercialActivity.length === 0 ? (
              <EmptyState message="لا نشاط تجاري في النافذة." />
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">النوع</th>
                      <th scope="col">الكمية</th>
                      <th scope="col">السعر</th>
                      <th scope="col">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.historicalCommercialActivity.map((row) => (
                      <tr key={row.factId}>
                        <td>{row.factKind}</td>
                        <td dir="ltr">{formatNum(row.quantity)}</td>
                        <td dir="ltr">
                          {row.unitPrice != null ? `${row.unitPrice} ${row.currencyCode || ''}` : '—'}
                        </td>
                        <td>{formatWhen(row.effectiveAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
      {!loading && !data && !error ? <ErrorState message="الحساب غير متاح." /> : null}
    </div>
  );
}
