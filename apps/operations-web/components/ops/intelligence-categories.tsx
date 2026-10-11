'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ApiClientError, type GCategoryIntelligence } from '@sco/contracts';
import { api } from '../../lib/api';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import {
  FreshnessBlock,
  G_SECTORS,
  IntelligenceSubnav,
  formatMoney,
  formatNum,
  formatWhen,
} from './intelligence-shared';
import styles from './ops.module.css';

export function IntelligenceCategories() {
  const router = useRouter();
  const [sector, setSector] = useState('HVAC');
  const [rows, setRows] = useState<GCategoryIntelligence[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const next: GCategoryIntelligence[] = [];
      for (const s of G_SECTORS) {
        try {
          const cat = await api.internalGCategoryIntelligence(s);
          if ((cat.quoteActivity ?? 0) + (cat.purchaseActivity ?? 0) > 0) next.push(cat);
        } catch (failure) {
          if (failure instanceof ApiClientError && failure.status === 401) {
            router.replace('/login');
            return;
          }
        }
      }
      if (!cancelled) {
        setRows(next);
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  function go(event: FormEvent) {
    event.preventDefault();
    if (sector.trim()) router.push(`/intelligence/categories/${encodeURIComponent(sector.trim())}`);
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <IntelligenceSubnav />
      <section className={styles.panel} aria-labelledby="cat-list">
        <h2 id="cat-list">ذكاء الفئات</h2>
        <p className={styles.muted}>محور الفئة في G V1 = القطاع (sector) من D/F.</p>
        <form className={styles.toolbar} onSubmit={go}>
          <label className={styles.field}>
            فئة / قطاع
            <input value={sector} onChange={(e) => setSector(e.target.value)} dir="ltr" required />
          </label>
          <button type="submit" className={styles.button}>
            فتح الفئة
          </button>
        </form>
        {loading ? <LoadingState /> : null}
        {!loading && rows.length === 0 ? (
          <EmptyState message="لا فئات بنشاط مثبت — افتح فئة يدويًا بعد التحديث." />
        ) : null}
        {rows.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">الفئة</th>
                  <th scope="col">عروض</th>
                  <th scope="col">شراء</th>
                  <th scope="col">قيمة تجارية</th>
                  <th scope="col">موردون</th>
                  <th scope="col">30 يوم</th>
                  <th scope="col">90 يوم</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((cat) => (
                  <tr key={cat.sector}>
                    <td>
                      <Link className={styles.rowLink} href={`/intelligence/categories/${encodeURIComponent(cat.sector)}`}>
                        {cat.sector}
                      </Link>
                    </td>
                    <td dir="ltr">{formatNum(cat.quoteActivity, 0)}</td>
                    <td dir="ltr">{formatNum(cat.purchaseActivity, 0)}</td>
                    <td dir="ltr">{formatMoney(cat.commercialPurchaseValue)}</td>
                    <td dir="ltr">{formatNum(cat.supplierCount, 0)}</td>
                    <td dir="ltr">{formatNum(cat.demandActivity30d, 0)}</td>
                    <td dir="ltr">{formatNum(cat.demandActivity90d, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function IntelligenceCategoryDetail({ sector }: { sector: string }) {
  const router = useRouter();
  const [cat, setCat] = useState<GCategoryIntelligence>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const row = await api.internalGCategoryIntelligence(sector);
        if (!cancelled) setCat(row);
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        if (!cancelled) setError(mapOpsError(failure, 'تعذر تحميل ذكاء الفئة.'));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sector, router]);

  if (error && !cat) return <ErrorState message={error} />;
  if (!cat) return <LoadingState />;

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <IntelligenceSubnav />
      <section className={styles.panel} aria-labelledby="cat-detail">
        <h2 id="cat-detail">فئة: {sector}</h2>
        <FreshnessBlock calculatedAt={cat.calculatedAt} sourceMaxEffectiveAt={cat.recentActivityAt} />
        <dl className={styles.dl}>
          <div>
            <dt>نشاط العروض</dt>
            <dd dir="ltr">{formatNum(cat.quoteActivity, 0)}</dd>
          </div>
          <div>
            <dt>نشاط الشراء</dt>
            <dd dir="ltr">{formatNum(cat.purchaseActivity, 0)}</dd>
          </div>
          <div>
            <dt>قيمة الشراء التجارية</dt>
            <dd dir="ltr">{formatMoney(cat.commercialPurchaseValue)}</dd>
          </div>
          <div>
            <dt>عدد الموردين</dt>
            <dd dir="ltr">{formatNum(cat.supplierCount, 0)}</dd>
          </div>
          <div>
            <dt>إشارة الطلب (30 يوم)</dt>
            <dd dir="ltr">{formatNum(cat.demandActivity30d, 0)}</dd>
          </div>
          <div>
            <dt>إشارة الطلب (90 يوم)</dt>
            <dd dir="ltr">{formatNum(cat.demandActivity90d, 0)}</dd>
          </div>
          <div>
            <dt>تغطية الأسعار</dt>
            <dd dir="ltr">
              quoted {cat.priceCoverage?.quotedItems ?? '—'} · purchased {cat.priceCoverage?.purchasedItems ?? '—'}
            </dd>
          </div>
          <div>
            <dt>آخر نشاط</dt>
            <dd>{formatWhen(cat.recentActivityAt)}</dd>
          </div>
        </dl>
        <p className={styles.muted}>
          <Link className={styles.rowLink} href={`/intelligence/demand?sector=${encodeURIComponent(sector)}`}>
            إشارات الطلب لهذه الفئة
          </Link>
        </p>
      </section>
    </div>
  );
}
