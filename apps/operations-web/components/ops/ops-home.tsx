'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiClientError } from '@sco/contracts';
import { api } from '../../lib/api';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import styles from './ops.module.css';

type Counts = {
  qualificationsReview: number;
  qualificationsFollowUp: number;
  agreementsPending: number;
  verifySubmitted: number;
  verifyInReview: number;
  verifyApproval: number;
  /** From signed D procurement requirements only — never from unsigned commercial list APIs. */
  selectionsReady: number | null;
};

type QueueCard = {
  key: string;
  href: string;
  count: number | null;
  label: string;
  hint: string;
};

export function OpsHome() {
  const router = useRouter();
  const [counts, setCounts] = useState<Counts>();
  const [error, setError] = useState<string>();
  const [partial, setPartial] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(undefined);
      setPartial([]);
      const next: Counts = {
        qualificationsReview: 0,
        qualificationsFollowUp: 0,
        agreementsPending: 0,
        verifySubmitted: 0,
        verifyInReview: 0,
        verifyApproval: 0,
        selectionsReady: null,
      };
      const warnings: string[] = [];
      try {
        const qualifications = await api.internalQualifications();
        next.qualificationsReview = qualifications.filter((item) =>
          ['SUBMITTED', 'UNDER_REVIEW'].includes(item.status),
        ).length;
        next.qualificationsFollowUp = qualifications.filter((item) => item.status === 'ACTION_REQUIRED').length;
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        warnings.push('التأهيل');
      }
      try {
        const partnerships = await api.internalPartnerships();
        next.agreementsPending = partnerships.filter((item) => !item.requiredAgreementsSatisfied).length;
      } catch {
        warnings.push('الاتفاقيات');
      }
      try {
        const [submitted, inReview, prepared] = await Promise.all([
          api.internalVerifyQueue(1, 100, 'SUBMITTED'),
          api.internalVerifyQueue(1, 100, 'IN_REVIEW'),
          api.internalVerifyQueue(1, 100, 'PREPARED'),
        ]);
        next.verifySubmitted = submitted.items.length;
        next.verifyInReview = inReview.items.length;
        next.verifyApproval = prepared.items.filter((item) => item.result_status === 'PREPARED').length;
      } catch {
        warnings.push('تأكّد');
      }
      try {
        const requirements = await api.internalProcurementRequirements();
        next.selectionsReady = requirements.filter((row) =>
          ['SELECTION_READY', 'SELECTED'].includes(row.status),
        ).length;
      } catch {
        warnings.push('التجاري/D');
        next.selectionsReady = null;
      }
      if (cancelled) return;
      setCounts(next);
      setPartial(warnings);
      if (warnings.length >= 4) setError('تعذر تحميل طوابير التشغيل. تحقق من صلاحياتك الداخلية.');
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error && !counts) return <ErrorState message={error} />;
  if (!counts) return <LoadingState />;

  const cards: QueueCard[] = [
    {
      key: 'qual-review',
      href: '/qualifications?status=SUBMITTED',
      count: counts.qualificationsReview,
      label: 'تأهيلات بانتظار المراجعة',
      hint: 'مُرسَل أو قيد المراجعة',
    },
    {
      key: 'qual-follow',
      href: '/qualifications?status=ACTION_REQUIRED',
      count: counts.qualificationsFollowUp,
      label: 'تأهيلات تتطلب متابعة',
      hint: 'إجراء مطلوب من الشريك',
    },
    {
      key: 'agreements',
      href: '/agreements',
      count: counts.agreementsPending,
      label: 'اتفاقيات غير مستوفاة',
      hint: 'من جاهزية الشراكة',
    },
    {
      key: 'verify-sub',
      href: '/verify?status=SUBMITTED',
      count: counts.verifySubmitted,
      label: 'طلبات تأكّد مُرسَلة',
      hint: 'بانتظار التحليل',
    },
    {
      key: 'verify-rev',
      href: '/verify?status=IN_REVIEW',
      count: counts.verifyInReview,
      label: 'طلبات تأكّد قيد المراجعة',
      hint: 'تحليل جارٍ',
    },
    {
      key: 'verify-prep',
      href: '/verify?status=PREPARED',
      count: counts.verifyApproval,
      label: 'نتائج بانتظار الاعتماد',
      hint: 'جاهزة للمُعتمد',
    },
    {
      key: 'e-selections',
      href: '/commercial',
      count: counts.selectionsReady,
      label: 'اختيارات جاهزة للمعالجة التجارية',
      hint: 'عدّاد من متطلب D الموقّع فقط',
    },
    {
      key: 'e-approval',
      href: '/commercial',
      count: null,
      label: 'نوايا/أوامر شراء بانتظار الاعتماد',
      hint: 'افتح مساحة التجاري — بلا عدّاد غير موقّع',
    },
    {
      key: 'e-issue',
      href: '/commercial',
      count: null,
      label: 'أوامر شراء بانتظار الإصدار',
      hint: 'افتح مساحة التجاري — بلا عدّاد غير موقّع',
    },
    {
      key: 'e-confirm',
      href: '/commercial',
      count: null,
      label: 'تأكيدات مورّد معلّقة',
      hint: 'افتح مساحة التجاري — بلا عدّاد غير موقّع',
    },
    {
      key: 'e-alloc',
      href: '/commercial',
      count: null,
      label: 'توزيعات غير مكتملة',
      hint: 'افتح مساحة التجاري — بلا عدّاد غير موقّع',
    },
    {
      key: 'e-resale',
      href: '/commercial',
      count: null,
      label: 'أوامر إعادة بيع بانتظار التأكيد',
      hint: 'أمر لكل شريك — بلا عدّاد غير موقّع',
    },
    {
      key: 'e-ready',
      href: '/commercial',
      count: null,
      label: 'جاهزية التنفيذ',
      hint: 'من fulfillmentReady في أمر إعادة البيع',
    },
  ];

  const numericPending = cards.some((card) => typeof card.count === 'number' && card.count > 0);

  return (
    <>
      {partial.length ? (
        <p className={styles.note} role="status">
          بعض الطوابير غير متاحة حاليًا ({partial.join(' · ')}). تُعرض الأرقام المتاحة فقط — دون أصفار ملفّقة من عقود غير
          موقّعة.
        </p>
      ) : null}
      <section className={styles.panel} aria-labelledby="queues-title">
        <h2 id="queues-title">طوابير قابلة للتنفيذ</h2>
        <p className={styles.muted}>لا إحصاءات تجميلية — فقط ما يمكن قياسه من عقود موقّعة أو مساحة عمل صريحة.</p>
        <div className={styles.queueGrid}>
          {cards.map((card) => (
            <Link key={card.key} href={card.href} className={styles.queueCard}>
              <span className={styles.queueCount} aria-label={card.count == null ? 'بدون عدّاد موقّع' : undefined}>
                {card.count == null ? '→' : card.count}
              </span>
              <span className={styles.queueLabel}>{card.label}</span>
              <span className={styles.queueHint}>{card.hint}</span>
            </Link>
          ))}
        </div>
        {!numericPending ? <EmptyState message="لا توجد عناصر معلّقة بعدّاد موقّع في الطوابير المتاحة." /> : null}
      </section>
    </>
  );
}
