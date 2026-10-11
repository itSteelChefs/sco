'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './ops.module.css';

export const H_NAV: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: '/operations', label: 'مركز العمليات', exact: true },
  { href: '/operations/my-work', label: 'مهامي' },
  { href: '/operations/exceptions', label: 'الحالات المتعثرة' },
  { href: '/operations/cycles', label: 'الدورات الأسبوعية' },
  { href: '/operations/notifications', label: 'الإشعارات' },
  { href: '/operations/jobs', label: 'المهام الخلفية' },
  { href: '/operations/health', label: 'صحة النظام' },
  { href: '/operations/audit', label: 'الأدلة' },
  { href: '/operations/config', label: 'الإعدادات التشغيلية' },
];

export function OperationsSubnav() {
  const pathname = usePathname();
  return (
    <nav className={styles.toolbar} aria-label="تنقل العمليات">
      {H_NAV.map((item) => {
        const current = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={current ? styles.button : styles.buttonGhost}
            aria-current={current ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function formatWhen(value?: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

export function ageLabel(createdAt?: string | null): string {
  if (!createdAt) return '—';
  const ms = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours} س`;
  return `${Math.floor(hours / 24)} ي`;
}

export function statusAr(status: string): string {
  switch (status) {
    case 'OPEN':
      return 'مفتوح';
    case 'IN_PROGRESS':
      return 'قيد التنفيذ';
    case 'BLOCKED':
      return 'متعثر';
    case 'DONE':
      return 'منتهٍ';
    case 'ACKNOWLEDGED':
      return 'مُقرّ به';
    case 'RESOLVED':
      return 'مُعالَج';
    case 'LOCKED':
      return 'مقفول';
    case 'IN_EXECUTION':
      return 'قيد التوريد';
    case 'COMPLETED':
      return 'مكتمل';
    case 'PENDING':
      return 'معلّق';
    case 'RUNNING':
      return 'يعمل';
    case 'SUCCEEDED':
      return 'نجح';
    case 'FAILED':
      return 'فشل';
    case 'CANCELLED':
      return 'ملغى';
    default:
      return status;
  }
}

export function domainAr(domain: string): string {
  switch (domain) {
    case 'A':
      return 'تأهيل';
    case 'B':
      return 'اتفاقيات';
    case 'C':
      return 'تأكّد/مستندات';
    case 'D':
      return 'مشتريات';
    case 'E':
      return 'تجاري';
    case 'F':
      return 'هندسة';
    case 'G':
      return 'ذكاء';
    case 'H':
      return 'عمليات';
    default:
      return domain;
  }
}

/** Deep link into actual A–G source screens — H is coordination only. */
export function sourceDeepLink(domain: string, entityType: string, entityId: string): string {
  const id = encodeURIComponent(entityId);
  switch (domain) {
    case 'A':
      return `/qualifications/${id}`;
    case 'B':
      return '/agreements';
    case 'C':
      if (/verify/i.test(entityType)) return `/verify/${id}`;
      return '/documents';
    case 'D':
      return '/commercial';
    case 'E':
      if (/purchase|intent/i.test(entityType)) return `/commercial/purchases/${id}`;
      if (/supplier|order/i.test(entityType)) return `/commercial/supplier-orders/${id}`;
      return '/commercial';
    case 'F':
      return `/engineering/${id}`;
    case 'G':
      return '/intelligence';
    case 'H':
      return '/operations';
    default:
      return '/operations';
  }
}

export function SourceLink(props: { domain: string; entityType: string; entityId: string; label?: string }) {
  const href = sourceDeepLink(props.domain, props.entityType, props.entityId);
  return (
    <Link className={styles.rowLink} href={href}>
      {props.label || `${domainAr(props.domain)} · ${props.entityType}`}
    </Link>
  );
}
