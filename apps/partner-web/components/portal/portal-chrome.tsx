'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isPartnerCommercialOrdersContractReady } from '../../lib/commercial-orders-api';
import { isPartnerEngineeringContractReady } from '../../lib/engineering-api';
import styles from '../readiness/readiness.module.css';

const BASE_NAV = [
  { href: '/portal/readiness', label: 'الجاهزية' },
  { href: '/portal/qualification', label: 'التأهيل' },
  { href: '/portal/agreements', label: 'الاتفاقيات' },
  { href: '/portal/documents', label: 'المستندات' },
  { href: '/portal/verify', label: 'تأكّد' },
] as const;

/** E nav appears only when partner commercial contracts are on the client. */
const E_NAV = { href: '/portal/orders', label: 'مشترياتي' } as const;
/** F nav appears only when partner engineering contracts are on the client. */
const F_NAV = { href: '/portal/engineering', label: 'الدراسات الهندسية' } as const;

export function PortalChrome() {
  const pathname = usePathname() ?? '';
  const nav = [
    ...BASE_NAV,
    ...(isPartnerCommercialOrdersContractReady() ? [E_NAV] : []),
    ...(isPartnerEngineeringContractReady() ? [F_NAV] : []),
  ];

  return (
    <div className={styles.topBar}>
      <Link href="/portal/readiness" className={styles.brand} aria-label="سكو — بوابة الشريك">
        سكو
      </Link>
      <nav className={styles.topNav} aria-label="تنقل البوابة">
        {nav.map((item) => {
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
