'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type HHealth, type HJobRunResult } from '@sco/contracts';
import { api } from '../../lib/api';
import { mapOpsError } from './safe-error';
import { OperationsSubnav, formatWhen } from './h-operations-shared';
import styles from './ops.module.css';

const JOB_TYPES = ['G_REFRESH', 'NOTIFICATION_PROCESS', 'OPERATIONAL_RECONCILE', 'RETENTION_MAINTENANCE'] as const;

export function HOperationsJobs() {
  const router = useRouter();
  const [health, setHealth] = useState<HHealth>();
  const [jobType, setJobType] = useState<string>('OPERATIONAL_RECONCILE');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [jobId, setJobId] = useState('');
  const [lastRun, setLastRun] = useState<HJobRunResult>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function refreshHealth() {
    try {
      setHealth(await api.internalHHealth());
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      if (failure instanceof ApiClientError && failure.status === 403) {
        /* health may require separate permission — jobs still usable */
        return;
      }
    }
  }

  useEffect(() => {
    void refreshHealth();
  }, []);

  async function enqueue(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const key = idempotencyKey.trim() || `${jobType}-${Date.now()}`;
      const created = await api.internalHJobEnqueue({ jobType, idempotencyKey: key });
      setJobId(created.id);
      setMessage(`طُلبت المهمة ${created.id}`);
      setIdempotencyKey(key);
      await refreshHealth();
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر طلب المهمة.'));
    } finally {
      setBusy(false);
    }
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.internalHJobRun(jobId.trim());
      setLastRun(result);
      setMessage(`الحالة: ${result.status}${result.idempotent ? ' (مكرّر آمن)' : ''}`);
      await refreshHealth();
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر تشغيل المهمة.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <OperationsSubnav />
      <section className={styles.panel} aria-labelledby="jobs-title">
        <h2 id="jobs-title">المهام الخلفية</h2>
        <p className={styles.muted}>تشغيل يدوي مصرّح فقط — بلا طوابير خارجية. ملخص الحالة من الصحة التشغيلية عند التوفر.</p>
        {health ? (
          <dl className={styles.dl}>
            <div>
              <dt>معلّق / يعمل / فشل / نجح</dt>
              <dd dir="ltr">
                {health.jobs.pending} / {health.jobs.running} / {health.jobs.failed} / {health.jobs.succeeded}
              </dd>
            </div>
            <div>
              <dt>آخر تحديث صحة</dt>
              <dd>{formatWhen(health.calculatedAt)}</dd>
            </div>
          </dl>
        ) : (
          <p className={styles.note} role="status">
            ملخص الصحة غير متاح لهذا الدور — يمكن طلب/تشغيل المهام بالمعرّف إن صُرّح.
          </p>
        )}
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className={styles.ok} role="status">
            {message}
          </p>
        ) : null}
      </section>

      <section className={styles.panel}>
        <h3>طلب مهمة</h3>
        <form className={styles.toolbar} onSubmit={(e) => void enqueue(e)}>
          <label className={styles.field}>
            النوع
            <select value={jobType} onChange={(e) => setJobType(e.target.value)}>
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            مفتاح التكرار
            <input
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              dir="ltr"
              placeholder="اختياري — يُولَّد إن فُرغ"
            />
          </label>
          <button type="submit" className={styles.button} disabled={busy}>
            طلب
          </button>
        </form>
      </section>

      <section className={styles.panel}>
        <h3>تشغيل مهمة</h3>
        <form className={styles.toolbar} onSubmit={(e) => void run(e)}>
          <label className={styles.field}>
            معرّف المهمة
            <input value={jobId} onChange={(e) => setJobId(e.target.value)} dir="ltr" required />
          </label>
          <button type="submit" className={styles.button} disabled={busy}>
            تشغيل
          </button>
        </form>
        {lastRun ? (
          <p className={styles.note} role="status">
            نتيجة آمنة: {lastRun.status}
            {lastRun.summary ? (
              <>
                {' · '}
                <span dir="ltr">{JSON.stringify(lastRun.summary)}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </section>
    </div>
  );
}
