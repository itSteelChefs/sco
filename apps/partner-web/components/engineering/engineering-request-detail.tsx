'use client';

import { ApiClientError } from '@sco/contracts';
import { useState } from 'react';
import { DocumentsPanel } from '../readiness/documents-panel';
import { engineeringApi, EngineeringWaitingError } from '../../lib/engineering-api';
import type { PartnerEngineeringRequestDetail } from './engineering-types';
import {
  engineeringRequestTypeLabelAr,
  engineeringStatusLabelAr,
  formatDateAr,
} from './engineering-labels';
import { EngineeringBoqResult } from './engineering-boq-result';
import { EngineeringHandoffPanel } from './engineering-handoff';
import styles from './engineering.module.css';

type Props = {
  companyId: string;
  detail: PartnerEngineeringRequestDetail;
  onChanged: () => void;
};

export function EngineeringRequestDetailView({ companyId, detail, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [responseText, setResponseText] = useState('');
  const status = String(detail.status || '').toUpperCase();
  const canSubmit = status === 'DRAFT' && engineeringApi.isReady();
  const actionRequired = status === 'ACTION_REQUIRED' && detail.actionRequired;
  const approved = status === 'APPROVED' || status === 'COMPLETED';

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    setMessage('جارٍ إرسال الطلب...');
    try {
      await engineeringApi.submit(companyId, detail.requestId);
      setMessage('تم إرسال الطلب للمراجعة الهندسية.');
      onChanged();
    } catch (failure) {
      setMessage('');
      if (failure instanceof EngineeringWaitingError) setError('الإرسال بانتظار واجهة الخادم.');
      else if (failure instanceof ApiClientError && failure.status === 403) setError('لا تملك صلاحية الإرسال.');
      else setError('تعذر إرسال الطلب.');
    } finally {
      setBusy(false);
    }
  }

  async function respond() {
    if (!actionRequired || busy) return;
    setBusy(true);
    setError('');
    setMessage('جارٍ إرسال الرد...');
    try {
      await engineeringApi.respond(companyId, detail.requestId, { message: responseText.trim() || undefined });
      setMessage('تم إرسال الرد.');
      setResponseText('');
      onChanged();
    } catch (failure) {
      setMessage('');
      if (failure instanceof EngineeringWaitingError) setError('الرد بانتظار واجهة الخادم.');
      else setError('تعذر إرسال الرد.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="engineering-request-detail">
      <section className={styles.panel} aria-labelledby="eng-detail-title">
        <div className={styles.row}>
          <h2 id="eng-detail-title">طلب {detail.reference}</h2>
          <span
            className={`${styles.badge} ${actionRequired ? styles.badgeWarn : styles.badgeAccent}`}
            data-testid="engineering-status"
          >
            {engineeringStatusLabelAr(detail.status)}
          </span>
        </div>
        <dl className={styles.summaryGrid}>
          <dt>العنوان</dt>
          <dd className={styles.mixed}>{detail.title}</dd>
          <dt>النوع</dt>
          <dd>{engineeringRequestTypeLabelAr(detail.requestType)}</dd>
          <dt>القطاع</dt>
          <dd>{detail.sector}</dd>
          <dt>تاريخ الإرسال</dt>
          <dd>{formatDateAr(detail.submittedAt)}</dd>
          {detail.currentResultVersion ? (
            <>
              <dt>إصدار النتيجة</dt>
              <dd data-testid="engineering-version">{detail.currentResultVersion}</dd>
            </>
          ) : null}
          {detail.nextActionLabel ? (
            <>
              <dt>الإجراء التالي</dt>
              <dd>{detail.nextActionLabel}</dd>
            </>
          ) : null}
        </dl>
        {detail.projectDetails ? <p className={`${styles.panelLead} ${styles.mixed}`}>{detail.projectDetails}</p> : null}
        {detail.partnerVisibleNotes ? (
          <p className={styles.note}>{detail.partnerVisibleNotes}</p>
        ) : null}

        {canSubmit ? (
          <div className={styles.actions}>
            <button type="button" className={styles.button} disabled={busy} onClick={() => void submit()} data-testid="engineering-submit">
              إرسال للمراجعة الهندسية
            </button>
          </div>
        ) : null}
      </section>

      {actionRequired ? (
        <section className={styles.panel} aria-labelledby="eng-action-title" data-testid="engineering-action-required">
          <h2 id="eng-action-title">يتطلب إجراءً</h2>
          <p className={styles.note}>{detail.actionRequired?.message}</p>
          {detail.actionRequired?.fieldsHint ? (
            <p className={styles.hint}>{detail.actionRequired.fieldsHint}</p>
          ) : null}
          <p className={styles.hint}>تُعرض رسالة الشريك فقط — لا تُعرض ملاحظات هندسية داخلية.</p>
          <div className={styles.field}>
            <label htmlFor="eng-response">ردك / التحديث المطلوب</label>
            <textarea
              id="eng-response"
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
              disabled={busy}
              className={styles.mixed}
            />
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.button} disabled={busy} onClick={() => void respond()}>
              إرسال الرد
            </button>
          </div>
        </section>
      ) : null}

      <section className={styles.panel} aria-labelledby="eng-docs-title" data-testid="engineering-documents">
        <h2 id="eng-docs-title">مستندات الطلب</h2>
        <p className={styles.panelLead}>الرفع عبر مركز المستندات الحالي. تظهر المرفقات المرتبطة بالطلب عند توفرها من الخادم.</p>
        <DocumentsPanel companyId={companyId} />
        {detail.documents.length > 0 ? (
          <ul className={styles.list}>
            {detail.documents.map((doc) => (
              <li key={doc.documentId} className={styles.listItem}>
                <strong className={styles.mixed}>{doc.filename}</strong>
                {doc.createdAt ? <span className={styles.hint}>{formatDateAr(doc.createdAt)}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.hint} role="status">
            لا مستندات مرتبطة معروضة من الخادم بعد — استخدم الرفع أعلاه ثم اربطها عند توفر الواجهة.
          </p>
        )}
      </section>

      {approved ? <EngineeringBoqResult versions={detail.resultVersions} /> : null}

      <EngineeringHandoffPanel companyId={companyId} detail={detail} onDone={onChanged} />

      <div aria-live="polite">
        {message}
        {error ? (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
