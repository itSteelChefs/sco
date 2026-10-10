'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiClientError } from '@sco/contracts';
import { api } from '../../lib/api';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import styles from './ops.module.css';

type Counts = {
  qualificationsReview: number;
  qualificationsFollowUp: number;
  agreementsPending: number;
  verifySubmitted: number;
  verifyInReview: number;
  verifyApproval: number;
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
      if (cancelled) return;
      setCounts(next);
      setPartial(warnings);
      if (warnings.length === 3) setError('تعذر تحميل طوابير التشغيل. تحقق من صلاحياتك الداخلية.');
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error && !counts) return <ErrorState message={error} />;
  if (!counts) return <LoadingState />;

  const cards = [
    {
      href: '/qualifications?status=SUBMITTED',
      count: counts.qualificationsReview,
      label: 'تأهيلات بانتظار المراجعة',
      hint: 'مُرسَل أو قيد المراجعة',
    },
    {
      href: '/qualifications?status=ACTION_REQUIRED',
      count: counts.qualificationsFollowUp,
      label: 'تأهيلات تتطلب متابعة',
      hint: 'إجراء مطلوب من الشريك',
    },
    {
      href: '/agreements',
      count: counts.agreementsPending,
      label: 'اتفاقيات غير مستوفاة',
      hint: 'من جاهزية الشراكة',
    },
    {
      href: '/verify?status=SUBMITTED',
      count: counts.verifySubmitted,
      label: 'طلبات تأكّد مُرسَلة',
      hint: 'بانتظار التحليل',
    },
    {
      href: '/verify?status=IN_REVIEW',
      count: counts.verifyInReview,
      label: 'طلبات تأكّد قيد المراجعة',
      hint: 'تحليل جارٍ',
    },
    {
      href: '/verify?status=PREPARED',
      count: counts.verifyApproval,
      label: 'نتائج بانتظار الاعتماد',
      hint: 'جاهزة للمُعتمد',
    },
  ];

  return (
    <>
      {partial.length ? (
        <p className={styles.note} role="status">
          بعض الطوابير غير متاحة حاليًا ({partial.join(' · ')}). تُعرض الأرقام المتاحة فقط.
        </p>
      ) : null}
      <section className={styles.panel} aria-labelledby="queues-title">
        <h2 id="queues-title">طوابير قابلة للتنفيذ</h2>
        <p className={styles.muted}>لا إحصاءات تجميلية — فقط ما يحتاج تدخّل SCO الآن.</p>
        <div className={styles.queueGrid}>
          {cards.map((card) => (
            <Link key={card.href} href={card.href} className={styles.queueCard}>
              <span className={styles.queueCount}>{card.count}</span>
              <span className={styles.queueLabel}>{card.label}</span>
              <span className={styles.queueHint}>{card.hint}</span>
            </Link>
          ))}
        </div>
        {!cards.some((card) => card.count > 0) ? <EmptyState message="لا توجد عناصر معلّقة في الطوابير المتاحة." /> : null}
      </section>
    </>
  );
}
