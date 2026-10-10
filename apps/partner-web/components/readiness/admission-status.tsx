'use client';

import Link from 'next/link';
import type { PartnerJourney } from '@sco/contracts';
import {
  mapQualificationPresentation,
  partnershipStatusLabelAr,
  qualificationLabelAr,
  relationshipStageLabelAr,
} from './readiness-labels';
import styles from './readiness.module.css';

type Props = {
  journey: PartnerJourney;
  /** Backend qualification status from journey — never inferred from membership alone. */
  membershipPresent: boolean;
};

export function AdmissionStatusPanel({ journey, membershipPresent }: Props) {
  const qualStatus = journey.relationship?.qualification ?? 'NONE';
  const presentation = mapQualificationPresentation(qualStatus);
  const stage = journey.relationship?.stage;
  const partnership = journey.relationship?.partnership;
  const nextAction = journey.nextAction;
  const approved = presentation === 'APPROVED';
  const actionRequired = presentation === 'ACTION_REQUIRED';
  const underReview = presentation === 'UNDER_REVIEW' || presentation === 'SUBMITTED';

  return (
    <section className={styles.panel} aria-labelledby="admission-title" data-testid="admission-status">
      <div className={styles.statusRow}>
        <h2 id="admission-title">حالة قبول الشريك</h2>
        <span className={`${styles.badge} ${styles.badgeAccent}`}>{qualificationLabelAr(presentation)}</span>
        <span className={styles.truth}>من الخادم</span>
      </div>
      <p className={styles.panelLead}>
        حالة التأهيل والاعتماد تأتي من سكو فقط. وجود عضوية حساب لا يعني اعتماد الشريك.
      </p>

      <dl className={styles.summaryGrid}>
        <dt>مرحلة العلاقة</dt>
        <dd>{relationshipStageLabelAr(stage)}</dd>
        <dt>حالة التأهيل</dt>
        <dd>{qualificationLabelAr(presentation)}</dd>
        <dt>الشراكة</dt>
        <dd>{partnershipStatusLabelAr(partnership)}</dd>
        <dt>عضوية الحساب</dt>
        <dd>{membershipPresent ? 'نشطة' : 'غير متاحة'}</dd>
        {nextAction && nextAction.code !== 'NONE' ? (
          <>
            <dt>الإجراء التالي</dt>
            <dd>
              {nextAction.code === 'ACCEPT_AGREEMENTS'
                ? 'قبول الاتفاقيات المطلوبة'
                : nextAction.code === 'AWAIT_SCO_REVIEW'
                  ? 'بانتظار مراجعة سكو'
                  : 'التواصل مع فريق سكو'}
            </dd>
          </>
        ) : null}
      </dl>

      {presentation === 'SUBMITTED' || underReview ? (
        <p className={styles.note} role="status">
          {presentation === 'UNDER_REVIEW'
            ? 'طلبك قيد مراجعة سكو. لا يلزم إجراء منك الآن.'
            : 'تم إرسال التأهيل. بانتظار بدء/استمرار مراجعة سكو.'}
        </p>
      ) : null}

      {actionRequired ? (
        <div className={styles.note} role="status">
          <p>
            <strong>يتطلب إجراءً.</strong> يلزم تصحيح بيانات التأهيل وإعادة الإرسال عندما يسمح الخادم بذلك.
          </p>
          <p className={styles.hint}>
            سبب التصحيح التفصيلي يظهر هنا فقط إذا وفّره الخادم في عقد الشريك — لا تُعرض ملاحظات المراجعة الداخلية.
          </p>
          <div className={styles.actions}>
            <Link className={styles.button} href="/portal/qualification">
              تصحيح التأهيل
            </Link>
          </div>
        </div>
      ) : null}

      {approved ? (
        <p className={styles.note} role="status">
          تم اعتماد تأهيل الشريك من سكو. يمكنك متابعة الاتفاقيات والمستندات ومسار التوثيق حسب جاهزيتك.
        </p>
      ) : null}

      {!approved && membershipPresent && presentation === 'INCOMPLETE' ? (
        <p className={styles.hint} role="status">
          العضوية وحدها لا تعني الاعتماد. أكمل التأهيل من صفحة التأهيل.
        </p>
      ) : null}
    </section>
  );
}
