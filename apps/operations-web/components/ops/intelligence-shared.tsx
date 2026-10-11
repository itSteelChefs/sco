'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { GBenchmarkSignal, GPriceStats } from '@sco/contracts';
import styles from './ops.module.css';

export const G_SECTORS = ['HVAC', 'ELECTRICAL', 'PLUMBING', 'MULTI'] as const;

export const INTEL_NAV: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: '/intelligence', label: 'نظرة عامة', exact: true },
  { href: '/intelligence/prices', label: 'الأسعار' },
  { href: '/intelligence/benchmark', label: 'مقارنة السعر' },
  { href: '/intelligence/suppliers', label: 'الموردون' },
  { href: '/intelligence/categories', label: 'الفئات' },
  { href: '/intelligence/demand', label: 'إشارات الطلب' },
  { href: '/intelligence/evidence', label: 'الأدلة' },
];

export function IntelligenceSubnav() {
  const pathname = usePathname();
  return (
    <nav className={styles.toolbar} aria-label="تنقل ذكاء المشتريات">
      {INTEL_NAV.map((item) => {
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
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatNum(value?: number | string | null, digits = 2): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat('ar-SA', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(n);
}

export function formatMoney(value?: number | string | null, currency?: string | null): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  const code = currency || 'SAR';
  try {
    return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: code, maximumFractionDigits: 4 }).format(n);
  } catch {
    return `${formatNum(n, 4)} ${code}`;
  }
}

export function factKindAr(kind: string): string {
  switch (kind) {
    case 'QUOTE_OBSERVED':
      return 'أسعار العروض';
    case 'QUOTE_SELECTED':
      return 'الأسعار المختارة';
    case 'PURCHASE_ORDER_ISSUED':
      return 'أمر شراء صادر';
    case 'SUPPLIER_CONFIRMED':
      return 'أسعار الشراء المؤكدة';
    case 'SUPPLIER_CONFIRMATION_REVISED':
      return 'تعديل تأكيد مورّد';
    case 'PURCHASE_CANCELLED':
      return 'شراء ملغى';
    case 'PARTNER_ALLOCATION':
      return 'توزيع شريك';
    case 'ENGINEERING_DEMAND':
      return 'طلب هندسي';
    default:
      return kind;
  }
}

export function benchmarkSignalAr(signal: GBenchmarkSignal): string {
  switch (signal) {
    case 'ABOVE_HISTORICAL_RANGE':
      return 'أعلى من النطاق التاريخي';
    case 'WITHIN_HISTORICAL_RANGE':
      return 'ضمن النطاق التاريخي';
    case 'BELOW_HISTORICAL_RANGE':
      return 'أقل من النطاق التاريخي';
    case 'INSUFFICIENT_EVIDENCE':
      return 'بيانات غير كافية';
    default:
      return signal;
  }
}

export function FreshnessBlock(props: {
  calculatedAt?: string | null;
  sourceMaxEffectiveAt?: string | null;
  sampleCount?: number | null;
  label?: string;
}) {
  return (
    <dl className={styles.dl} aria-label={props.label || 'حداثة الأدلة'}>
      <div>
        <dt>آخر تحديث</dt>
        <dd>{formatWhen(props.calculatedAt)}</dd>
      </div>
      <div>
        <dt>أحدث مصدر</dt>
        <dd>{formatWhen(props.sourceMaxEffectiveAt)}</dd>
      </div>
      {props.sampleCount != null ? (
        <div>
          <dt>عدد العينات</dt>
          <dd dir="ltr">{props.sampleCount}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function PriceStatsCard(props: {
  title: string;
  seriesKind: 'QUOTE_OBSERVED' | 'QUOTE_SELECTED' | 'SUPPLIER_CONFIRMED';
  stats?: GPriceStats | null;
  currency?: string | null;
  emptyMessage: string;
}) {
  const count = props.stats?.sampleCount ?? 0;
  return (
    <section className={styles.panel} aria-labelledby={`series-${props.seriesKind}`}>
      <h3 id={`series-${props.seriesKind}`}>{props.title}</h3>
      <p className={styles.muted}>
        سلسلة مستقلة: <span dir="ltr">{props.seriesKind}</span> — {factKindAr(props.seriesKind)}
      </p>
      {count <= 0 ? (
        <p className={styles.note} role="status">
          {props.emptyMessage}
        </p>
      ) : (
        <dl className={styles.dl}>
          <div>
            <dt>آخر سعر</dt>
            <dd dir="ltr">{formatMoney(props.stats?.latest, props.currency)}</dd>
          </div>
          <div>
            <dt>الحد الأدنى</dt>
            <dd dir="ltr">{formatMoney(props.stats?.min, props.currency)}</dd>
          </div>
          <div>
            <dt>الحد الأعلى</dt>
            <dd dir="ltr">{formatMoney(props.stats?.max, props.currency)}</dd>
          </div>
          <div>
            <dt>المتوسط</dt>
            <dd dir="ltr">{formatMoney(props.stats?.mean, props.currency)}</dd>
          </div>
          <div>
            <dt>الوسيط</dt>
            <dd dir="ltr">{formatMoney(props.stats?.median, props.currency)}</dd>
          </div>
          <div>
            <dt>عدد العينات</dt>
            <dd dir="ltr">{count}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
