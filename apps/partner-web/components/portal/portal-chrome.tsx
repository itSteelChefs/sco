'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from '../readiness/readiness.module.css';

const NAV = [
  { href: '/portal/readiness', label: 'الجاهزية' },
  { href: '/portal/qualification', label: 'التأهيل' },
  { href: '/portal/agreements', label: 'الاتفاقيات' },
  { href: '/portal/documents', label: 'المستندات' },
  { href: '/portal/verify', label: 'تأكّد' },
] as const;

export function PortalChrome() {
  const pathname = usePathname() ?? '';

  return (
    <div className={styles.topBar}>
      <Link href="/portal/readiness" className={styles.brand} aria-label="سكو — بوابة الشريك">
        سكو
      </Link>
      <nav className={styles.topNav} aria-label="تنقل البوابة">
        {NAV.map((item) => {
          const current =
            pathname === item.href || (item.href !== '/portal/readiness' && pathname.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} aria-current={current ? 'page' : undefined}>
              {item.label}
            </Link>
          );
        })}
        <Link href="/">الاستقبال</Link>
      </nav>
    </div>
  );
}
