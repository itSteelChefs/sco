'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ApiClientError, type GEvidencePage, type GSupplierPerformance } from '@sco/contracts';
import { api } from '../../lib/api';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import {
  FreshnessBlock,
  IntelligenceSubnav,
  formatMoney,
  formatNum,
  formatWhen,
} from './intelligence-shared';
import styles from './ops.module.css';

export function IntelligenceSuppliers() {
  const router = useRouter();
  const [lookup, setLookup] = useState('');
  const [evidence, setEvidence] = useState<GEvidencePage>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const page = await api.internalGEvidence({ limit: 100, offset: 0 });
        if (!cancelled) setEvidence(page);
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        if (!cancelled) setError(mapOpsError(failure, 'تعذر تحميل قائمة الموردين من الأدلة.'));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const suppliers = Array.from(
    new Set((evidence?.items || []).map((i) => i.supplierCompanyId).filter(Boolean) as string[]),
  );

  function go(event: FormEvent) {
    event.preventDefault();
    const id = lookup.trim();
    if (id) router.push(`/intelligence/suppliers/${id}`);
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <IntelligenceSubnav />
      <section className={styles.panel} aria-labelledby="sup-list">
        <h2 id="sup-list">أداء الموردين</h2>
        <p className={styles.muted}>
          مقاييس مدعومة من الخادم فقط. لا درجة تسليم ولا نجوم جودة ما لم تُرجع كأدلة.
        </p>
        <form className={styles.toolbar} onSubmit={go}>
          <label className={styles.field}>
            معرّف شركة المورّد
            <input value={lookup} onChange={(e) => setLookup(e.target.value)} dir="ltr" required />
          </label>
          <button type="submit" className={styles.button}>
            فتح التفاصيل
          </button>
        </form>
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
        {!evidence ? (
          error ? null : <LoadingState />
        ) : suppliers.length === 0 ? (
          <EmptyState message="لا موردين ظاهرين في الأدلة الحديثة بعد." />
        ) : (
          <ul className={styles.dl}>
            {suppliers.map((id) => (
              <li key={id}>
                <Link className={styles.rowLink} href={`/intelligence/suppliers/${id}`} dir="ltr">
                  {id}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function IntelligenceSupplierDetail({ supplierCompanyId }: { supplierCompanyId: string }) {
  const router = useRouter();
  const [perf, setPerf] = useState<GSupplierPerformance>();
  const [error, setError] = useState<string>();
  const [costHidden, setCostHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(undefined);
      try {
        const row = await api.internalGSupplierPerformance(supplierCompanyId);
        if (cancelled) return;
        setPerf(row);
        setCostHidden(row.commercialPurchaseValue == null);
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        if (failure instanceof ApiClientError && failure.status === 403) {
          setError('غير مصرح بعرض أداء المورّد أو تكلفة الشراء.');
          return;
        }
        setError(mapOpsError(failure, 'تعذر تحميل أداء المورّد.'));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [supplierCompanyId, router]);

  if (error && !perf) return <ErrorState message={error} />;
  if (!perf) return <LoadingState />;

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <IntelligenceSubnav />
      <section className={styles.panel} aria-labelledby="sup-detail">
        <h2 id="sup-detail">تفاصيل المورّد</h2>
        <p className={styles.muted} dir="ltr">
          {supplierCompanyId}
        </p>
        <FreshnessBlock calculatedAt={perf.calculatedAt} sourceMaxEffectiveAt={perf.lastActivityAt} />
        <dl className={styles.dl}>
          <div>
            <dt>عدد أوامر الشراء</dt>
            <dd dir="ltr">{formatNum(perf.poCount, 0)}</dd>
          </div>
          <div>
            <dt>أوامر مؤكدة</dt>
            <dd dir="ltr">{formatNum(perf.confirmedPoCount, 0)}</dd>
          </div>
          <div>
            <dt>قيمة الشراء التجارية</dt>
            <dd dir="ltr">
              {costHidden ? 'مخفية — إذن التكلفة غير متاح أو الحقل غير مُرجَع' : formatMoney(perf.commercialPurchaseValue)}
            </dd>
          </div>
          <div>
            <dt>متوسط زمن التأكيد (ث)</dt>
            <dd dir="ltr">
              {perf.confirmationLatencySampleCount
                ? formatNum(perf.confirmationLatencySecondsMean)
                : 'لا عيّنات تأكيد كافية'}
            </dd>
          </div>
          <div>
            <dt>نسبة التعديلات</dt>
            <dd dir="ltr">
              {perf.confirmationRevisionRate == null
                ? '—'
                : `${formatNum(Number(perf.confirmationRevisionRate) * 100)}% (${perf.confirmationRevisionCount ?? 0})`}
            </dd>
          </div>
          <div>
            <dt>نسبة الإلغاء</dt>
            <dd dir="ltr">
              {perf.cancellationRate == null
                ? '—'
                : `${formatNum(Number(perf.cancellationRate) * 100)}% (${perf.cancellationCount ?? 0})`}
            </dd>
          </div>
          <div>
            <dt>الفئات</dt>
            <dd dir="ltr">{formatNum(perf.categoryCount, 0)}</dd>
          </div>
          <div>
            <dt>آخر نشاط</dt>
            <dd>{formatWhen(perf.lastActivityAt)}</dd>
          </div>
          <div>
            <dt>مقاييس التسليم</dt>
            <dd>{perf.deliveryMetrics == null ? 'غير مدعومة في G V1' : String(perf.deliveryMetrics)}</dd>
          </div>
        </dl>
        <p className={styles.note} role="note">
          مقام نسبة الإلغاء: {perf.cancellationRateDenominator || '—'} · لا نجوم تقييم.
        </p>
        <p className={styles.muted}>
          <Link
            className={styles.rowLink}
            href={`/intelligence/prices?supplierCompanyId=${encodeURIComponent(supplierCompanyId)}`}
          >
            سجل أسعار هذا المورّد
          </Link>
        </p>
      </section>
    </div>
  );
}
