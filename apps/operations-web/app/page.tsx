'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiClientError } from '@sco/contracts';
import { OperationsDashboard } from '../components/operations-dashboard';
import { api } from '../lib/api';
export default function Home() {
  const router = useRouter();
  const [logoutError, setLogoutError] = useState<string>();
  async function logout() {
    setLogoutError(undefined);
    try {
      await api.logout();
      router.replace('/login');
    } catch (failure) {
      setLogoutError(failure instanceof ApiClientError && failure.status === 401
        ? 'انتهت الجلسة. أعد تسجيل الدخول.'
        : 'تعذر إنهاء الجلسة بأمان. حاول مرة أخرى.');
    }
  }
  return <main><header><h1>SCO Internal Operations</h1><button type="button" onClick={() => void logout()}>تسجيل الخروج</button>{logoutError && <p role="alert">{logoutError}</p>}</header><nav><a href="/companies">الشركات</a><a href="/memberships">العضويات</a><a href="/roles">الأدوار والصلاحيات</a></nav><OperationsDashboard /></main>;
}
