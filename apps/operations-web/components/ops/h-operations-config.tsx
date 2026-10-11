'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type HConfigMap } from '@sco/contracts';
import { api } from '../../lib/api';
import { ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import { OperationsSubnav, formatWhen } from './h-operations-shared';
import styles from './ops.module.css';

const ALLOWED_KEYS = ['weekly_cutoff', 'retry_limits', 'notification_toggles', 'operational_thresholds'] as const;

export function HOperationsConfig() {
  const router = useRouter();
  const [config, setConfig] = useState<HConfigMap>();
  const [key, setKey] = useState<string>('weekly_cutoff');
  const [valueJson, setValueJson] = useState('{}');
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(undefined);
    try {
      const row = await api.internalHConfigGet();
      setConfig(row);
      if (row[key]?.value) setValueJson(JSON.stringify(row[key].value, null, 2));
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      setError(mapOpsError(failure, 'تعذر تحميل الإعدادات التشغيلية.'));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (config?.[key]?.value) setValueJson(JSON.stringify(config[key].value, null, 2));
  }, [key, config]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const value = JSON.parse(valueJson) as Record<string, unknown>;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        setError('القيمة يجب أن تكون كائن JSON.');
        return;
      }
      const updated = await api.internalHConfigSet({ key, value });
      setMessage(`تم حفظ ${updated.key} (v${updated.version}).`);
      await load();
    } catch (failure) {
      if (failure instanceof SyntaxError) {
        setError('JSON غير صالح.');
      } else {
        setError(mapOpsError(failure, 'تعذر حفظ الإعداد.'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !config) return <ErrorState message={error} />;
  if (!config) {
    return (
      <div style={{ display: 'grid', gap: '1.25rem' }}>
        <OperationsSubnav />
        <LoadingState />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <OperationsSubnav />
      <section className={styles.panel} aria-labelledby="cfg-title">
        <h2 id="cfg-title">الإعدادات التشغيلية</h2>
        <p className={styles.muted}>
          المفاتيح المعتمدة فقط: قطع أسبوعي · حدود إعادة المحاولة · مفاتيح الإشعارات · عتبات تشغيلية. لا سياسة أعمال.
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
        <dl className={styles.dl}>
          {ALLOWED_KEYS.map((k) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>
                v{config[k]?.version ?? '—'} · {formatWhen(config[k]?.updatedAt)}
                <pre className={styles.muted} dir="ltr" style={{ whiteSpace: 'pre-wrap', margin: '0.35rem 0 0' }}>
                  {JSON.stringify(config[k]?.value ?? {}, null, 2)}
                </pre>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.panel}>
        <h3>تعديل إعداد معتمد</h3>
        <form className={styles.confirmBox} onSubmit={(e) => void save(e)}>
          <label className={styles.field}>
            المفتاح
            <select value={key} onChange={(e) => setKey(e.target.value)}>
              {ALLOWED_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            القيمة (JSON)
            <textarea value={valueJson} onChange={(e) => setValueJson(e.target.value)} dir="ltr" rows={8} required />
          </label>
          <button type="submit" className={styles.button} disabled={busy}>
            حفظ
          </button>
        </form>
      </section>
    </div>
  );
}
