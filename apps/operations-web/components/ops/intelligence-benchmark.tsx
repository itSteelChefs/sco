'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { ApiClientError, type GQuoteBenchmark } from '@sco/contracts';
import { api } from '../../lib/api';
import { EmptyState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import {
  FreshnessBlock,
  IntelligenceSubnav,
  PriceStatsCard,
  benchmarkSignalAr,
  formatMoney,
  formatNum,
} from './intelligence-shared';
import styles from './ops.module.css';

export function IntelligenceBenchmark() {
  const router = useRouter();
  const search = useSearchParams();
  const initial = search.get('quoteLineId') || '';
  const [quoteLineId, setQuoteLineId] = useState(initial);
  const [result, setResult] = useState<GQuoteBenchmark>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function run(event?: FormEvent) {
    event?.preventDefault();
    const id = quoteLineId.trim();
    if (!id) {
      setError('أدخل معرّف سطر العرض.');
      return;
    }
    setLoading(true);
    setError(undefined);
    setResult(undefined);
    try {
      const bench = await api.internalGQuoteBenchmark(id);
      setResult(bench);
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      setError(mapOpsError(failure, 'تعذر حساب مقارنة السعر.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <IntelligenceSubnav />
      <section className={styles.panel} aria-labelledby="bench-title">
        <h2 id="bench-title">مقارنة السعر</h2>
        <p className={styles.muted}>
          لغة محايدة فقط: أعلى / ضمن / أقل من النطاق التاريخي، أو بيانات غير كافية. لا أوامر شراء تلقائية.
        </p>
        <form className={styles.toolbar} onSubmit={(e) => void run(e)}>
          <label className={styles.field}>
            معرّف سطر العرض (quoteLineId)
            <input
              value={quoteLineId}
              onChange={(e) => setQuoteLineId(e.target.value)}
              dir="ltr"
              required
              autoComplete="off"
            />
          </label>
          <button type="submit" className={styles.button} disabled={loading}>
            حساب المقارنة
          </button>
        </form>
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {loading ? <LoadingState /> : null}

      {result ? (
        <section className={styles.panel} aria-labelledby="bench-result">
          <h2 id="bench-result">نتيجة المقارنة</h2>
          <p>
            <span
              className={
                result.signal === 'ABOVE_HISTORICAL_RANGE'
                  ? styles.badgeDanger
                  : result.signal === 'BELOW_HISTORICAL_RANGE'
                    ? styles.badgeOk
                    : result.signal === 'WITHIN_HISTORICAL_RANGE'
                      ? styles.badge
                      : result.signal === 'INSUFFICIENT_EVIDENCE'
                        ? styles.badgeWarn
                        : styles.badge
              }
              role="status"
              data-signal={result.signal}
            >
              {benchmarkSignalAr(result.signal)}
            </span>
          </p>
          {result.signal === 'INSUFFICIENT_EVIDENCE' ? (
            <EmptyState
              message={
                result.reason === 'CURRENT_QUOTE_MISSING_PRICE_OR_UNIT'
                  ? 'لا يمكن المقارنة — العرض الحالي بلا سعر أو وحدة.'
                  : result.sampleCount === 0
                    ? 'لا توجد بيانات شراء مؤكدة كافية للمقارنة.'
                    : 'بيانات غير كافية للمقارنة.'
              }
            />
          ) : null}
          <dl className={styles.dl}>
            <div>
              <dt>العرض الحالي</dt>
              <dd dir="ltr">{formatMoney(result.currentQuoteValue, result.currencyCode)}</dd>
            </div>
            <div>
              <dt>فرق المبلغ (مقابل الوسيط/النطاق)</dt>
              <dd dir="ltr">{formatMoney(result.deltaAmount, result.currencyCode)}</dd>
            </div>
            <div>
              <dt>فرق النسبة ضمن النطاق</dt>
              <dd dir="ltr">{formatNum(result.deltaPercentageVsRange)}%</dd>
            </div>
            <div>
              <dt>عدد العينات</dt>
              <dd dir="ltr">{result.sampleCount ?? 0}</dd>
            </div>
            <div>
              <dt>عدد الموردين</dt>
              <dd dir="ltr">{result.supplierCount ?? '—'}</dd>
            </div>
            <div>
              <dt>العملة / الوحدة</dt>
              <dd dir="ltr">
                {result.currencyCode || '—'} · {result.unitId || '—'}
              </dd>
            </div>
            <div>
              <dt>مصدر البيانات</dt>
              <dd>
                عينات شراء:{' '}
                <span dir="ltr">{result.evidenceCoverage?.purchaseSamples ?? '—'}</span> · عينات عروض:{' '}
                <span dir="ltr">{result.evidenceCoverage?.quoteSamples ?? '—'}</span>
              </dd>
            </div>
          </dl>
          <FreshnessBlock
            calculatedAt={result.freshness?.calculatedAt || result.calculatedAt}
            sourceMaxEffectiveAt={result.freshness?.sourceMaxEffectiveAt || result.sourceMaxEffectiveAt}
            sampleCount={result.sampleCount}
          />
          <div className={styles.split}>
            <PriceStatsCard
              title="نطاق الشراء التاريخي"
              seriesKind="SUPPLIER_CONFIRMED"
              stats={result.comparableConfirmedPurchaseStats}
              currency={result.currencyCode}
              emptyMessage="لا توجد عينات شراء مؤكدة لهذا المرجع."
            />
            <PriceStatsCard
              title="نطاق العروض التاريخي"
              seriesKind="QUOTE_OBSERVED"
              stats={result.comparableQuoteStats}
              currency={result.currencyCode}
              emptyMessage="يوجد عرض واحد فقط أو لا عروض تاريخية قابلة للمقارنة."
            />
          </div>
          {result.comparableKey ? (
            <p className={styles.muted}>
              <Link
                className={styles.rowLink}
                href={`/intelligence/evidence?comparableKey=${encodeURIComponent(result.comparableKey)}`}
              >
                تفصيل الأدلة
              </Link>
              {' · '}
              <Link
                className={styles.rowLink}
                href={`/intelligence/prices?comparableKey=${encodeURIComponent(result.comparableKey)}`}
              >
                سجل الأسعار
              </Link>
            </p>
          ) : null}
          <p className={styles.note} role="note">
            يُعلم القرار البشري فقط — بلا أزرار تنفيذ شراء أو أوامر رفض أو اختيار مورّد آلي.
          </p>
        </section>
      ) : null}
    </div>
  );
}
