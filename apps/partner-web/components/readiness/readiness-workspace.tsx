'use client';

import Link from 'next/link';
import { ErrorState, LoadingState } from '../product-state';
import { CompanySelector } from '../portal/company-selector';
import { PortalChrome } from '../portal/portal-chrome';
import { usePortalSession } from '../portal/use-portal-session';
import { AdmissionStatusPanel } from './admission-status';
import {
  LAUNCH_AGREEMENT_FOCUS,
  mapQualificationPresentation,
  qualificationLabelAr,
} from './readiness-labels';
import styles from './readiness.module.css';

export function ReadinessWorkspace() {
  const { companies, selected, setSelected, journey, agreements, error, reload } = usePortalSession();

  if (error && error !== 'UNAUTHENTICATED') {
    return (
      <div className={styles.page}>
        <PortalChrome />
        <div className={styles.shell}>
          <ErrorState message={error} onRetry={() => reload()} />
        </div>
      </div>
    );
  }

  if (!companies) {
    return (
      <div className={styles.page}>
        <PortalChrome />
        <div className={styles.shell}>
          <LoadingState />
        </div>
      </div>
    );
  }

  if (!companies.length) {
    return (
      <div className={styles.page}>
        <PortalChrome />
        <div className={styles.shell}>
          <p role="status">لا توجد شركة نشطة متاحة لهذا الحساب.</p>
        </div>
      </div>
    );
  }

  const qualStatus = journey?.relationship?.qualification ?? 'NONE';
  const presentation = mapQualificationPresentation(qualStatus);
  const agreementsSatisfied = journey?.relationship?.agreementsSatisfied ?? false;
  const launchAgreements = (agreements ?? []).filter((item) => LAUNCH_AGREEMENT_FOCUS.has(item.agreementType));
  const pendingLaunch = launchAgreements.filter(
    (item) => item.actionable || item.acceptanceStatus === 'NOT_ACCEPTED' || item.acceptanceStatus === 'REACCEPTANCE_REQUIRED',
  );
  const nextHref =
    presentation === 'INCOMPLETE' || presentation === 'IN_PROGRESS' || presentation === 'ACTION_REQUIRED'
      ? '/portal/qualification'
      : !agreementsSatisfied || pendingLaunch.length > 0
        ? '/portal/agreements'
        : '/portal/verify';

  return (
    <div className={styles.page}>
      <PortalChrome />
      <div className={styles.shell}>
        <header className={styles.intro}>
          <h1>جاهزية الشريك</h1>
          <p>مركز القيادة: التأهيل، الاعتماد، الاتفاقيات، المستندات، ومسار تأكّد.</p>
        </header>

        <CompanySelector companies={companies} selected={selected} onSelect={setSelected} />

        {!selected ? <p role="status">اختر شركة للمتابعة.</p> : null}
        {selected && !journey ? <LoadingState /> : null}

        {selected && journey ? (
          <>
            <AdmissionStatusPanel journey={journey} membershipPresent />

            <section className={styles.panel} aria-labelledby="ready-qa-title" data-testid="readiness-command">
              <div className={styles.statusRow}>
                <h2 id="ready-qa-title">ملخص الجاهزية</h2>
                <span className={`${styles.badge} ${styles.badgeAccent}`}>{qualificationLabelAr(presentation)}</span>
              </div>
              <ul className={styles.agreementList}>
                <li>
                  <strong>هل التأهيل مكتمل؟</strong>{' '}
                  {presentation === 'APPROVED' || presentation === 'SUBMITTED' || presentation === 'UNDER_REVIEW'
                    ? 'مُرسَل أو معتمد حسب حالة الخادم.'
                    : presentation === 'ACTION_REQUIRED'
                      ? 'لا — يتطلب إجراءً.'
                      : 'لا — أكمل المسودة وأرسل.'}
                </li>
                <li>
                  <strong>هل يحتاج إجراء؟</strong> {presentation === 'ACTION_REQUIRED' ? 'نعم.' : 'لا حاليًا من جانب التأهيل.'}
                </li>
                <li>
                  <strong>هل الاعتماد تم؟</strong>{' '}
                  {presentation === 'APPROVED' ? 'نعم — من حالة التأهيل في الخادم.' : 'لا — الاعتماد ليس مستنتجًا من العضوية.'}
                </li>
                <li>
                  <strong>هل الاتفاقيات مكتملة؟</strong> {agreementsSatisfied ? 'نعم.' : 'لا — راجع حزمة الإطلاق.'}
                </li>
                <li>
                  <strong>هل المستندات مكتملة؟</strong> راجع مركز المستندات لرفع المطلوب حسب الفئة.
                </li>
                <li>
                  <strong>هل يوجد Verify نشط؟</strong> افتح مسار تأكّد لمتابعة المسودات والنتائج من الخادم.
                </li>
                <li>
                  <strong>ما الخطوة التالية؟</strong>{' '}
                  {journey.nextAction && journey.nextAction.code !== 'NONE'
                    ? journey.nextAction.code === 'ACCEPT_AGREEMENTS'
                      ? 'قبول الاتفاقيات المطلوبة.'
                      : journey.nextAction.code === 'AWAIT_SCO_REVIEW'
                        ? 'بانتظار مراجعة سكو.'
                        : 'التواصل مع فريق سكو.'
                    : 'تابع المسار حسب حالتك الحالية.'}
                </li>
              </ul>
              <div className={styles.actions}>
                <Link className={styles.button} href={nextHref}>
                  متابعة الخطوة التالية
                </Link>
                <Link className={styles.buttonGhost} href="/portal/qualification">
                  التأهيل
                </Link>
                <Link className={styles.buttonGhost} href="/portal/agreements">
                  الاتفاقيات
                </Link>
                <Link className={styles.buttonGhost} href="/portal/documents">
                  المستندات
                </Link>
                <Link className={styles.buttonGhost} href="/portal/verify">
                  تأكّد
                </Link>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
