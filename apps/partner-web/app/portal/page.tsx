'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiClientError } from '@sco/contracts';
import { PartnerContext } from '../../components/company-context';
import { api } from '../../lib/api';

/** Authenticated partner workspace shell (moved from `/` for Wave 1 public reception). */
export default function PartnerPortalPage() {
  const router = useRouter();
  const [logoutError, setLogoutError] = useState<string>();

  async function logout() {
    setLogoutError(undefined);
    try {
      await api.logout();
      router.replace('/login');
    } catch (failure) {
      setLogoutError(
        failure instanceof ApiClientError && failure.status === 401
          ? 'انتهت الجلسة. أعد تسجيل الدخول.'
          : 'تعذر إنهاء الجلسة بأمان. حاول مرة أخرى.',
      );
    }
  }

  return (
    <main>
      <header>
        <h1>SCO Partner Portal</h1>
        <button type="button" onClick={() => void logout()}>
          تسجيل الخروج
        </button>
        {logoutError && <p role="alert">{logoutError}</p>}
      </header>
      <PartnerContext />
    </main>
  );
}
