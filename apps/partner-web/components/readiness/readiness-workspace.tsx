'use client';

import { ApiClientError, type ActiveCompany, type PartnerAgreement, type PartnerDocumentUploadResult, type PartnerJourney } from '@sco/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { readinessApi } from '../../lib/readiness-api';
import { ErrorState, LoadingState } from '../product-state';
import { AgreementsPanel } from './agreements-panel';
import { DocumentsPanel } from './documents-panel';
import { QualificationForm } from './qualification-form';
import { VerifyPanel } from './verify-panel';
import { mapQualificationPresentation, qualificationLabelAr } from './readiness-labels';
import styles from './readiness.module.css';

function mapError(failure: unknown): string {
  if (failure instanceof ApiClientError) {
    if (failure.status === 401) return 'UNAUTHENTICATED';
    if (failure.status === 403) return 'لا تملك صلاحية عرض جاهزية هذه الشركة.';
    if (failure.code === 'NOT_FOUND') return 'تعذر العثور على بيانات الجاهزية.';
    if (failure.code === 'VALIDATION_FAILED') return 'تعذر التحقق من الطلب.';
    if (failure.code === 'CONFLICT') return 'تعارض في الحالة. حدّث الصفحة.';
  }
  return 'تعذر تحميل مساحة الجاهزية. حاول مرة أخرى.';
}

export function ReadinessWorkspace() {
  const router = useRouter();
  const [companies, setCompanies] = useState<ActiveCompany[]>();
  const [selected, setSelected] = useState('');
  const [journey, setJourney] = useState<PartnerJourney>();
  const [agreements, setAgreements] = useState<PartnerAgreement[]>();
  const [uploads, setUploads] = useState<PartnerDocumentUploadResult[]>([]);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  const controller = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const ac = new AbortController();
    void readinessApi
      .context(ac.signal)
      .then((context) => {
        setCompanies(context.companies);
        if (context.companies.length === 1) setSelected(context.companies[0].id);
      })
      .catch((failure) => {
        if (failure?.name === 'AbortError') return;
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        setError(mapError(failure));
      });
    return () => ac.abort();
  }, [router]);

  useEffect(() => {
    if (!selected) return;
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setError(undefined);
    setJourney(undefined);
    setAgreements(undefined);
    void Promise.all([
      readinessApi.partnerJourney(selected, ac.signal),
      readinessApi.partnerAgreements(selected, ac.signal).catch((failure) => {
        if (failure instanceof ApiClientError && failure.status === 403) return [] as PartnerAgreement[];
        throw failure;
      }),
    ])
      .then(([currentJourney, currentAgreements]) => {
        if (ac.signal.aborted) return;
        setJourney(currentJourney);
        setAgreements(currentAgreements);
      })
      .catch((failure) => {
        if (failure?.name === 'AbortError') return;
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        setError(mapError(failure));
      });
    return () => ac.abort();
  }, [selected, reload, router]);

  if (error && error !== 'UNAUTHENTICATED') {
    return (
      <div className={styles.page}>
        <ReadinessChrome />
        <div className={styles.shell}>
          <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} />
        </div>
      </div>
    );
  }

  if (!companies) {
    return (
      <div className={styles.page}>
        <ReadinessChrome />
        <div className={styles.shell}><LoadingState /></div>
      </div>
    );
  }

  if (!companies.length) {
    return (
      <div className={styles.page}>
        <ReadinessChrome />
        <div className={styles.shell}>
          <p role="status">لا توجد شركة نشطة متاحة لهذا الحساب.</p>
        </div>
      </div>
    );
  }

  const company = companies.find((item) => item.id === selected);
  const qualStatus = journey?.relationship?.qualification ?? 'NONE';
  const presentation = mapQualificationPresentation(qualStatus);
  const stage = journey?.relationship?.stage;
  const nextAction = journey?.nextAction;
  const agreementsSatisfied = journey?.relationship?.agreementsSatisfied;

  return (
    <div className={styles.page}>
      <ReadinessChrome />
      <div className={styles.shell}>
        <header className={styles.intro}>
          <h1>جاهزية الشريك</h1>
          <p>مسار وظيفي: تأهيل → اتفاقيات → مستندات → تأكّد (Quote Check).</p>
        </header>

        <div className={styles.companyBar}>
          <label htmlFor="readiness-company">
            الشركة
            <select
              id="readiness-company"
              aria-label="الشركة"
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
                setUploads([]);
              }}
            >
              <option value="" disabled>اختر الشركة النشطة</option>
              {companies.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        </div>

        {!selected ? <p role="status">اختر شركة للمتابعة.</p> : null}
        {selected && !journey ? <LoadingState /> : null}

        {selected && journey ? (
          <>
            <section className={styles.panel} aria-labelledby="identity-title">
              <div className={styles.statusRow}>
                <h2 id="identity-title">هوية الشركة</h2>
                <span className={styles.truth}>LIVE</span>
              </div>
              <dl className={styles.summaryGrid}>
                <dt>الاسم</dt>
                <dd>{company?.name ?? journey.company.name}</dd>
                <dt>مرحلة العلاقة</dt>
                <dd>{stage ?? '—'}</dd>
                <dt>حالة التأهيل</dt>
                <dd>{qualStatus} · {qualificationLabelAr(presentation)}</dd>
                <dt>الشراكة</dt>
                <dd>{journey.relationship?.partnership ?? '—'}</dd>
                <dt>الاتفاقيات</dt>
                <dd>{agreementsSatisfied ? 'مستوفاة' : 'غير مستوفاة / قيد الاستيفاء'}</dd>
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
            </section>

            <QualificationForm
              companyId={selected}
              companyNameHint={company?.name}
              onChanged={() => setReload((value) => value + 1)}
            />

            <AgreementsPanel
              companyId={selected}
              agreements={agreements}
              onAccepted={() => setReload((value) => value + 1)}
            />

            <DocumentsPanel
              companyId={selected}
              onUploaded={(doc) => setUploads((current) => [doc, ...current])}
            />

            <VerifyPanel companyId={selected} uploadedDocuments={uploads} />

            <section className={styles.panel} aria-labelledby="ready-title">
              <div className={styles.statusRow}>
                <h2 id="ready-title">ملخص الجاهزية</h2>
                <span className={`${styles.badge} ${styles.badgeAccent}`}>{qualificationLabelAr(presentation)}</span>
              </div>
              <ul className={styles.agreementList}>
                <li>التأهيل: حالة الخادم {qualStatus}.</li>
                <li>الاتفاقيات: {agreementsSatisfied ? 'مستوفاة' : 'قد تبقى مطلوبة'}.</li>
                <li>المستندات المرفوعة في هذه الجلسة: {uploads.length}.</li>
                <li>تأكّد: Quote Check فقط — دون RFQ/PO/تفاوض.</li>
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ReadinessChrome() {
  return (
    <div className={styles.topBar}>
      <Link href="/" className={styles.brand}>سكو</Link>
      <nav className={styles.topNav} aria-label="تنقل البوابة">
        <Link href="/portal/readiness" aria-current="page">الجاهزية</Link>
        <Link href="/portal">بوابة الشريك</Link>
        <Link href="/">الاستقبال</Link>
      </nav>
    </div>
  );
}
