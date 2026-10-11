'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiClientError } from '@sco/contracts';
import { api } from '../../lib/api';
import styles from './ops.module.css';

type Props = {
  children: React.ReactNode;
  title?: string;
  lead?: string;
};

const NAV = [
  { href: '/', label: 'لوحة التشغيل' },
  { href: '/qualifications', label: 'التأهيل' },
  { href: '/agreements', label: 'الاتفاقيات' },
  { href: '/documents', label: 'المستندات' },
  { href: '/verify', label: 'تأكّد' },
  { href: '/commercial', label: 'التجاري' },
  { href: '/engineering', label: 'الهندسة' },
  { href: '/intelligence', label: 'ذكاء المشتريات' },
  { href: '/operations', label: 'العمليات' },
] as const;

export function OpsChrome({ children, title, lead }: Props) {
  const pathname = usePathname();
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
          : 'تعذر إنهاء الجلسة بأمان.',
      );
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="سكو — عمليات داخلية">
          <span className={styles.brandPrimary}>سكو</span>
          <span className={styles.brandSecondary}>عمليات داخلية</span>
        </Link>
        <nav className={styles.nav} aria-label="تنقل العمليات">
          {NAV.map((item) => {
            const current =
              item.href === '/'
                ? pathname === '/'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} aria-current={current ? 'page' : undefined}>
                {item.label}
              </Link>
            );
          })}
          <button type="button" className={styles.logout} onClick={() => void logout()}>
            تسجيل الخروج
          </button>
        </nav>
      </header>
      <main className={styles.main}>
        {title ? (
          <header>
            <h1 className={styles.pageTitle}>{title}</h1>
            {lead ? <p className={styles.lead}>{lead}</p> : null}
          </header>
        ) : null}
        {logoutError ? (
          <p className={styles.alert} role="alert">
            {logoutError}
          </p>
        ) : null}
        {children}
      </main>
    </div>
  );
}
