'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type HWeeklyCycle } from '@sco/contracts';
import { api } from '../../lib/api';
import { EmptyState } from '../product-state';
import { mapOpsError } from './safe-error';
import { OperationsSubnav, formatWhen, statusAr } from './h-operations-shared';
import styles from './ops.module.css';

export function HOperationsCycles() {
  const router = useRouter();
  const [cycleId, setCycleId] = useState('');
  const [cycle, setCycle] = useState<HWeeklyCycle>();
  const [startsAt, setStartsAt] = useState('');
  const [cutoffAt, setCutoffAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [lockAck, setLockAck] = useState(false);
  const [overrideWork, setOverrideWork] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function createCycle(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.internalHCycleCreate({
        startsAt: new Date(startsAt).toISOString(),
        cutoffAt: new Date(cutoffAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });
      setCycle(created);
      setCycleId(created.id);
      setMessage(`دورة ${created.cycleCode}`);
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      setError(mapOpsError(failure, 'تعذر إنشاء الدورة.'));
    } finally {
      setBusy(false);
    }
  }

  async function loadCycle(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      setCycle(await api.internalHCycleGet(cycleId.trim()));
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر تحميل الدورة.'));
    } finally {
      setBusy(false);
    }
  }

  async function lockCycle(event: FormEvent) {
    event.preventDefault();
    if (!cycle || !lockAck) {
      setError('يلزم تأكيد القفل.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      setCycle(await api.internalHCycleLock(cycle.id));
      setMessage('تم قفل الدورة.');
      setLockAck(false);
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر قفل الدورة.'));
    } finally {
      setBusy(false);
    }
  }

  async function completeCycle() {
    if (!cycle) return;
    setBusy(true);
    setError(undefined);
    try {
      setCycle(await api.internalHCycleComplete(cycle.id));
      setMessage('اكتملت الدورة.');
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر إكمال الدورة.'));
    } finally {
      setBusy(false);
    }
  }

  async function overrideInclude(event: FormEvent) {
    event.preventDefault();
    if (!cycle) return;
    setBusy(true);
    setError(undefined);
    try {
      setCycle(
        await api.internalHCycleOverrideInclude(cycle.id, {
          workItemId: overrideWork.trim(),
          reason: overrideReason.trim(),
        }),
      );
      setMessage('تم الإدراج بعد القطع مع سبب.');
      setOverrideWork('');
      setOverrideReason('');
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر الإدراج الاستثنائي.'));
    } finally {
      setBusy(false);
    }
  }

  const pastCutoff = cycle ? new Date(cycle.cutoffAt).getTime() < Date.now() : false;

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <OperationsSubnav />
      <section className={styles.panel} aria-labelledby="cycle-model">
        <h2 id="cycle-model">الدورات الأسبوعية</h2>
        <p className={styles.muted}>
          النموذج المعتمد: جمع الأحد–الخميس · قفل الخميس · توريد السبت. المنطقة الزمنية الافتراضية Asia/Riyadh.
        </p>
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
        <h3>إنشاء دورة</h3>
        <form className={styles.toolbar} onSubmit={(e) => void createCycle(e)}>
          <label className={styles.field}>
            البداية
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          </label>
          <label className={styles.field}>
            القطع (cutoff)
            <input type="datetime-local" value={cutoffAt} onChange={(e) => setCutoffAt(e.target.value)} required />
          </label>
          <label className={styles.field}>
            النهاية
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
          </label>
          <button type="submit" className={styles.button} disabled={busy}>
            إنشاء
          </button>
        </form>
      </section>

      <section className={styles.panel}>
        <h3>فتح دورة</h3>
        <form className={styles.toolbar} onSubmit={(e) => void loadCycle(e)}>
          <label className={styles.field}>
            معرّف الدورة
            <input value={cycleId} onChange={(e) => setCycleId(e.target.value)} dir="ltr" required />
          </label>
          <button type="submit" className={styles.button} disabled={busy}>
            تحميل
          </button>
        </form>
      </section>

      {cycle ? (
        <section className={styles.panel} aria-labelledby="cycle-detail">
          <h3 id="cycle-detail">
            {cycle.cycleCode} — {statusAr(cycle.status)}
          </h3>
          {pastCutoff && cycle.status === 'OPEN' ? (
            <p className={styles.note} role="status">
              بعد القطع: الإدراج العادي مغلق — الإدراج يتطلب صلاحية وسببًا (override).
            </p>
          ) : null}
          <dl className={styles.dl}>
            <div>
              <dt>النافذة</dt>
              <dd>
                {formatWhen(cycle.startsAt)} → {formatWhen(cycle.endsAt)}
              </dd>
            </div>
            <div>
              <dt>القطع</dt>
              <dd>{formatWhen(cycle.cutoffAt)}</dd>
            </div>
            <div>
              <dt>الحالة</dt>
              <dd>
                <span className={styles.badge}>{statusAr(cycle.status)}</span>
              </dd>
            </div>
            <div>
              <dt>العمل المشمول</dt>
              <dd dir="ltr">{cycle.membershipCount}</dd>
            </div>
            <div>
              <dt>القفل / الإكمال</dt>
              <dd>
                {formatWhen(cycle.lockedAt)} · {formatWhen(cycle.completedAt)}
              </dd>
            </div>
          </dl>

          {cycle.memberships.length === 0 ? (
            <EmptyState message="لا عضويات مدرجة بعد." />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">عنصر العمل</th>
                    <th scope="col">المفتاح</th>
                    <th scope="col">سبب الاستثناء</th>
                  </tr>
                </thead>
                <tbody>
                  {cycle.memberships.map((m) => (
                    <tr key={m.workItemId}>
                      <td dir="ltr">{m.workItemId}</td>
                      <td dir="ltr">{m.sourceKey}</td>
                      <td>{m.overrideReason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form className={styles.confirmBox} onSubmit={(e) => void lockCycle(e)}>
            <h4>قفل الدورة</h4>
            <label className={styles.field}>
              <input type="checkbox" checked={lockAck} onChange={(e) => setLockAck(e.target.checked)} disabled={busy || cycle.status !== 'OPEN'} />{' '}
              أؤكّد قفل الدورة عند القطع — لن يُدرج عمل جديد بلا تجاوز مصرّح
            </label>
            <button type="submit" className={styles.button} disabled={busy || cycle.status !== 'OPEN'}>
              قفل
            </button>
          </form>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              disabled={busy || (cycle.status !== 'LOCKED' && cycle.status !== 'IN_EXECUTION')}
              onClick={() => void completeCycle()}
            >
              إكمال الدورة
            </button>
          </div>

          <form className={styles.confirmBox} onSubmit={(e) => void overrideInclude(e)}>
            <h4>تجاوز بعد القطع (سبب إلزامي)</h4>
            <label className={styles.field}>
              عنصر العمل
              <input value={overrideWork} onChange={(e) => setOverrideWork(e.target.value)} dir="ltr" required />
            </label>
            <label className={styles.field}>
              السبب
              <textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} required minLength={3} />
            </label>
            <button type="submit" className={styles.button} disabled={busy}>
              إدراج استثنائي
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
