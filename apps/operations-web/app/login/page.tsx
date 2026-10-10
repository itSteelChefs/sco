'use client';

import { ApiClientError } from '@sco/contracts';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import styles from '../../components/ops/ops.module.css';

export default function Login() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      await api.login(String(data.get('email') ?? ''), String(data.get('password') ?? ''));
      router.replace('/');
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.code === 'INVALID_CREDENTIALS') {
        setError('بيانات الدخول غير صحيحة.');
      } else {
        setError('الخدمة غير متاحة الآن.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.main}>
      <header>
        <p className={styles.brandPrimary}>سكو</p>
        <h1 className={styles.pageTitle}>دخول العمليات الداخلية</h1>
        <p className={styles.lead}>للموظفين المخوّلين فقط — بوابة تشغيل التأهيل والاتفاقيات والمستندات وتأكّد.</p>
      </header>
      <form className={styles.panel} onSubmit={submit}>
        <label className={styles.field} htmlFor="email">
          البريد الإلكتروني
          <input id="email" name="email" type="email" autoComplete="email" required disabled={pending} dir="ltr" />
        </label>
        <label className={styles.field} htmlFor="password">
          كلمة المرور
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={pending}
            dir="ltr"
          />
        </label>
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? 'جارٍ الدخول...' : 'دخول'}
        </button>
      </form>
      <p className={styles.muted}>
        <Link href="/">سكو عمليات</Link>
      </p>
    </main>
  );
}
