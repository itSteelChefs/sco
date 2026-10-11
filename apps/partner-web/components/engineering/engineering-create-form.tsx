'use client';

import { ApiClientError } from '@sco/contracts';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { engineeringApi, EngineeringWaitingError } from '../../lib/engineering-api';
import {
  ENGINEERING_REQUEST_TYPE_OPTIONS,
  ENGINEERING_SECTOR_OPTIONS,
} from './engineering-labels';
import styles from './engineering.module.css';

type Props = {
  companyId: string;
  waitingBackend?: boolean;
};

export function EngineeringCreateForm({ companyId, waitingBackend }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [requestType, setRequestType] = useState<string>(ENGINEERING_REQUEST_TYPE_OPTIONS[0].value);
  const [sector, setSector] = useState<string>(ENGINEERING_SECTOR_OPTIONS[0].value);
  const [projectDetails, setProjectDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!title.trim()) {
      setError('عنوان الطلب مطلوب.');
      return;
    }
    if (waitingBackend || !engineeringApi.isReady()) {
      setError('إنشاء الطلب غير متاح حتى تتوفر واجهة الخادم المعتمدة.');
      return;
    }
    setBusy(true);
    setMessage('جارٍ حفظ المسودة...');
    try {
      const created = (await engineeringApi.createDraft(companyId, {
        title: title.trim(),
        requestType,
        sector,
        projectDetails: projectDetails.trim() || undefined,
      })) as { requestId?: string };
      setMessage('تم إنشاء المسودة.');
      if (created.requestId) router.push(`/portal/engineering/${created.requestId}`);
    } catch (failure) {
      setMessage('');
      if (failure instanceof EngineeringWaitingError) {
        setError('بانتظار واجهة الخادم لإنشاء الطلب.');
      } else if (failure instanceof ApiClientError && failure.status === 403) {
        setError('لا تملك صلاحية إنشاء طلب هندسي.');
      } else {
        setError('تعذر إنشاء المسودة.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="eng-create-title" data-testid="engineering-create-form">
      <h2 id="eng-create-title">طلب دراسة هندسية</h2>
      <p className={styles.panelLead}>حقول الحد الأدنى فقط — بلا بيروقراطية إضافية. الحفظ عبر الخادم عند التوفر.</p>

      {waitingBackend ? (
        <p className={styles.note} role="status" data-testid="engineering-waiting">
          بانتظار عقد الخلفية لإنشاء المسودة. لا يُعرض نجاح وهمي.
        </p>
      ) : null}

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="eng-title">عنوان المشروع / الطلب</label>
          <input
            id="eng-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy || waitingBackend}
            required
            className={styles.mixed}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="eng-type">نوع الطلب</label>
          <select
            id="eng-type"
            value={requestType}
            onChange={(e) => setRequestType(e.target.value)}
            disabled={busy || waitingBackend}
          >
            {ENGINEERING_REQUEST_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="eng-sector">القطاع</label>
          <select
            id="eng-sector"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            disabled={busy || waitingBackend}
          >
            {ENGINEERING_SECTOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="eng-details">تفاصيل المشروع (اختياري)</label>
          <textarea
            id="eng-details"
            value={projectDetails}
            onChange={(e) => setProjectDetails(e.target.value)}
            disabled={busy || waitingBackend}
            className={styles.mixed}
          />
        </div>
        <div className={styles.actions}>
          <button type="submit" className={styles.button} disabled={busy || waitingBackend} data-testid="eng-create-submit">
            {busy ? 'جارٍ الحفظ...' : 'حفظ مسودة الطلب'}
          </button>
        </div>
      </form>

      <div aria-live="polite">
        {message}
        {error ? (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
