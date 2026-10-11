'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiClientError, type GDecisionSupport } from '@sco/contracts';
import { api } from '../../lib/api';
import { mapOpsError } from './safe-error';
import {
  FreshnessBlock,
  benchmarkSignalAr,
  formatMoney,
  formatNum,
} from './intelligence-shared';
import styles from './ops.module.css';

/** Compact panel for D/E procurement screens — informs, never executes purchase. */
export function IntelligenceDecisionSupportPanel({ quoteLineId }: { quoteLineId: string }) {
  const [data, setData] = useState<GDecisionSupport>();
  const [error, setError] = useState<string>();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(undefined);
      setDenied(false);
      try {
        const row = await api.internalGDecisionSupport(quoteLineId);
        if (!cancelled) setData(row);
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 403) {
          if (!cancelled) setDenied(true);
          return;
        }
        if (!cancelled) setError(mapOpsError(failure, 'لوحة الذكاء غير متاحة لهذا السطر.'));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [quoteLineId]);

  if (denied) return null;

  return (
    <section className={styles.panel} aria-labelledby="g-ds-title">
      <h2 id="g-ds-title">ذكاء المشتريات — دعم القرار</h2>
      <p className={styles.muted}>آخر سعر شراء · النطاق التاريخي · العينات · سلوك المورّد · إشارة الفئة. يُعلم فقط.</p>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      {!data && !error ? <p role="status">جارٍ تحميل الأدلة…</p> : null}
      {data ? (
        <>
          <p>
            <span className={styles.badge} role="status">
              {benchmarkSignalAr(data.benchmark.signal)}
            </span>
          </p>
          <dl className={styles.dl}>
            <div>
              <dt>آخر سعر شراء / وسيط مؤكد</dt>
              <dd dir="ltr">
                {formatMoney(
                  data.priceHistory?.confirmedPurchaseHistory?.latest ??
                    data.benchmark.comparableConfirmedPurchaseStats?.median,
                  data.benchmark.currencyCode,
                )}
              </dd>
            </div>
            <div>
              <dt>النطاق التاريخي (شراء)</dt>
              <dd dir="ltr">
                {formatMoney(data.benchmark.comparableConfirmedPurchaseStats?.min, data.benchmark.currencyCode)} –{' '}
                {formatMoney(data.benchmark.comparableConfirmedPurchaseStats?.max, data.benchmark.currencyCode)}
              </dd>
            </div>
            <div>
              <dt>عدد العينات</dt>
              <dd dir="ltr">{formatNum(data.benchmark.sampleCount, 0)}</dd>
            </div>
            <div>
              <dt>سلوك المورّد</dt>
              <dd>
                أوامر: <span dir="ltr">{data.supplierPerformance?.poCount ?? '—'}</span> · إلغاء:{' '}
                <span dir="ltr">
                  {data.supplierPerformance?.cancellationRate == null
                    ? '—'
                    : `${formatNum(Number(data.supplierPerformance.cancellationRate) * 100)}%`}
                </span>
              </dd>
            </div>
            <div>
              <dt>إشارة الفئة</dt>
              <dd>
                {data.categorySignal?.sector || '—'} · نشاط 30 يوم:{' '}
                <span dir="ltr">{data.categorySignal?.demandActivity30d ?? '—'}</span>
              </dd>
            </div>
          </dl>
          <FreshnessBlock
            calculatedAt={data.freshness?.calculatedAt || data.calculatedAt}
            sourceMaxEffectiveAt={data.freshness?.sourceMaxEffectiveAt}
            sampleCount={data.benchmark.sampleCount}
          />
          <p className={styles.note} role="note">
            actionExecution={String(data.actionExecution)} — لا تنفيذ شراء تلقائي من هذه اللوحة.
          </p>
          <p className={styles.muted}>
            <Link
              className={styles.rowLink}
              href={`/intelligence/benchmark?quoteLineId=${encodeURIComponent(quoteLineId)}`}
            >
              فتح مقارنة السعر الكاملة
            </Link>
            {' · '}
            <Link className={styles.rowLink} href="/intelligence">
              ذكاء المشتريات
            </Link>
          </p>
        </>
      ) : null}
    </section>
  );
}
