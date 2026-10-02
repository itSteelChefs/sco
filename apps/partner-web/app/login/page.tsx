'use client';
import { ApiClientError } from '@sco/contracts';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(undefined);
    const data = new FormData(event.currentTarget);
    try { await api.login(String(data.get('email') ?? ''), String(data.get('password') ?? '')); router.replace('/'); }
    catch (failure) {
      if (failure instanceof ApiClientError && failure.code === 'INVALID_CREDENTIALS') setError('بيانات الدخول غير صحيحة.');
      else if (failure instanceof ApiClientError && failure.code === 'VALIDATION_FAILED') setError('تحقق من البريد الإلكتروني وكلمة المرور.');
      else setError('الخدمة غير متاحة الآن. حاول مرة أخرى.');
    } finally { setPending(false); }
  }
  return <main><h1>تسجيل الدخول</h1><form onSubmit={submit}><label>البريد الإلكتروني<input name="email" type="email" autoComplete="email" required disabled={pending} /></label><label>كلمة المرور<input name="password" type="password" autoComplete="current-password" required disabled={pending} /></label>{error && <p role="alert">{error}</p>}<button type="submit" disabled={pending}>{pending ? 'جارٍ الدخول...' : 'دخول'}</button></form></main>;
}
