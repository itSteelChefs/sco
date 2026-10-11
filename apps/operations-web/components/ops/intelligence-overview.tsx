'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiClientError, type GCategoryIntelligence, type GDemandSignals, type GEvidencePage } from '@sco/contracts';
import { api } from '../../lib/api';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import {
  FreshnessBlock,
  G_SECTORS,
  IntelligenceSubnav,
  factKindAr,
  formatNum,
  formatWhen,
} from './intelligence-shared';
import styles from './ops.module.css';

export function IntelligenceOverview() {
  const router = useRouter();
  const [demand, setDemand] = useState<GDemandSignals>();
  const [categories, setCategories] = useState<GCategoryIntelligence[]>([]);
  const [evidence, setEvidence] = useState<GEvidencePage>();
  const [error, setError] = useState<string>();
  const [partial, setPartial] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(undefined);
      const warnings: string[] = [];
      let nextDemand: GDemandSignals | undefined;
      const nextCats: GCategoryIntelligence[] = [];
      let nextEvidence: GEvidencePage | undefined;
      try {
        nextDemand = await api.internalGDemandSignals({ windowDays: 90 });
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        if (failure instanceof ApiClientError && failure.status === 403) {
          setError('غير مصرح بعرض ذكاء المشتريات.');
          return;
        }
        warnings.push('إشارات الطلب');
      }
      for (const sector of G_SECTORS) {
        try {
          const cat = await api.internalGCategoryIntelligence(sector);
          if ((cat.quoteActivity ?? 0) + (cat.purchaseActivity ?? 0) + (cat.demandActivity30d ?? 0) > 0) {
            nextCats.push(cat);
          }
        } catch {
          /* skip empty/unavailable sector — never fabricate zeros as activity */
        }
      }
      try {
        nextEvidence = await api.internalGEvidence({ limit: 8, offset: 0 });
      } catch {
        warnings.push('الأدلة');
      }
      if (cancelled) return;
      setDemand(nextDemand);
      setCategories(nextCats);
      setEvidence(nextEvidence);
      setPartial(warnings);
      if (!nextDemand && nextCats.length === 0 && !nextEvidence) {
        setError(mapOpsError(new Error('unavailable'), 'تعذر تحميل نظرة ذكاء المشتريات.'));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error && !demand && categories.length === 0 && !evidence) return <ErrorState message={error} />;
  if (!demand && categories.length === 0 && !evidence) return <LoadingState />;

  const openCount = demand?.openDemand?.length ?? null;
  const engCount = demand?.recentEngineeringDemand?.length ?? null;
  const freshest =
    demand?.calculatedAt ||
    categories[0]?.calculatedAt ||
    evidence?.calculatedAt;

  return (
    <div className={styles.split} style={{ gridTemplateColumns: '1fr' }}>
      <IntelligenceSubnav />
      {partial.length ? (
        <p className={styles.note} role="status">
          بعض المصادر غير متاحة ({partial.join(' · ')}). تُعرض الأدلة المتاحة فقط — بلا أصفار ملفّقة.
        </p>
      ) : null}

      <section className={styles.panel} aria-labelledby="g-overview-title">
        <h2 id="g-overview-title">ماذا يتغيّر الآن؟</h2>
        <p className={styles.muted}>
          أدلة تشغيلية من D/E/F — ليست لوحة تنفيذية تجميلية، وليست تنبؤًا.
        </p>
        <FreshnessBlock
          calculatedAt={freshest}
          sourceMaxEffectiveAt={demand?.sourceMaxEffectiveAt}
          label="حداثة النظرة العامة"
        />
        <div className={styles.queueGrid}>
          <div className={styles.queueCard} aria-label="الطلب المفتوح">
            <span className={styles.queueCount}>{openCount == null ? '—' : openCount}</span>
            <span className={styles.queueLabel}>الطلب المفتوح</span>
            <span className={styles.queueHint}>متطلبات D نشطة — ليس تنبؤًا</span>
          </div>
          <div className={styles.queueCard} aria-label="نشاط هندسي حديث">
            <span className={styles.queueCount}>{engCount == null ? '—' : engCount}</span>
            <span className={styles.queueLabel}>طلب هندسي حديث (نافذة 90 يوم)</span>
            <span className={styles.queueHint}>من جداول كميات معتمدة</span>
          </div>
          <Link href="/intelligence/prices" className={styles.queueCard}>
            <span className={styles.queueCount}>→</span>
            <span className={styles.queueLabel}>سجل الأسعار</span>
            <span className={styles.queueHint}>عروض · مختارة · شراء مؤكد — سلاسل منفصلة</span>
          </Link>
          <Link href="/intelligence/suppliers" className={styles.queueCard}>
            <span className={styles.queueCount}>→</span>
            <span className={styles.queueLabel}>أداء الموردين</span>
            <span className={styles.queueHint}>تأكيد · تعديلات · إلغاء — بلا نجوم</span>
          </Link>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="g-cat-active">
        <h2 id="g-cat-active">فئات نشطة</h2>
        {categories.length === 0 ? (
          <EmptyState message="لا توجد فئات ب نشاط مثبت بعد. حدّث الأدلة أو اختر فئة يدويًا." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">الفئة</th>
                  <th scope="col">عروض</th>
                  <th scope="col">شراء مؤكد</th>
                  <th scope="col">موردون</th>
                  <th scope="col">نشاط 30 يوم</th>
                  <th scope="col">آخر نشاط</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => (
                  <tr key={cat.sector}>
                    <td>
                      <Link className={styles.rowLink} href={`/intelligence/categories/${encodeURIComponent(cat.sector)}`}>
                        {cat.sector}
                      </Link>
                    </td>
                    <td dir="ltr">{formatNum(cat.quoteActivity, 0)}</td>
                    <td dir="ltr">{formatNum(cat.purchaseActivity, 0)}</td>
                    <td dir="ltr">{formatNum(cat.supplierCount, 0)}</td>
                    <td dir="ltr">{formatNum(cat.demandActivity30d, 0)}</td>
                    <td>{formatWhen(cat.recentActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="g-recent-ev">
        <h2 id="g-recent-ev">أحدث مصادر</h2>
        {!evidence || evidence.items.length === 0 ? (
          <EmptyState message="لا توجد بيانات شراء/عرض مؤكدة كافية بعد. قد تحتاج إلى تحديث الخلفية (صلاحية refresh)." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">النوع</th>
                  <th scope="col">التاريخ</th>
                  <th scope="col">الفئة</th>
                  <th scope="col">السعر</th>
                  <th scope="col">المصدر</th>
                </tr>
              </thead>
              <tbody>
                {evidence.items.map((item) => (
                  <tr key={item.factId}>
                    <td>
                      <span className={styles.badge}>{factKindAr(item.factKind)}</span>
                    </td>
                    <td>{formatWhen(item.effectiveAt)}</td>
                    <td dir="ltr">{item.sector || '—'}</td>
                    <td dir="ltr">
                      {item.unitPrice != null ? `${item.unitPrice} ${item.currencyCode || ''}` : '—'}
                    </td>
                    <td dir="ltr">
                      {item.sourceDomain}:{item.sourceEntityType}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.muted}>
          <Link className={styles.rowLink} href="/intelligence/evidence">
            فتح تفصيل الأدلة
          </Link>
        </p>
      </section>
    </div>
  );
}
