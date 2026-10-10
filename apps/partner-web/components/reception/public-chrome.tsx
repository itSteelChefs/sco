import Link from 'next/link';
import styles from './reception.module.css';

type PublicChromeProps = {
  children: React.ReactNode;
  active?: 'home' | 'partnership' | 'verify' | 'login';
};

export function PublicChrome({ children, active }: PublicChromeProps) {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        تخطي إلى المحتوى
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.brandMark} aria-label="سكو — الصفحة الرئيسية">
          <span className={styles.brandPrimary}>سكو</span>
          <span className={styles.brandSecondary}>SCO</span>
        </Link>
        <nav className={styles.nav} aria-label="التنقل الرئيسي">
          <Link href="/#what" aria-current={active === 'home' ? 'page' : undefined}>
            ماذا نقدّم
          </Link>
          <Link href="/partnership" aria-current={active === 'partnership' ? 'page' : undefined}>
            الشراكة
          </Link>
          <Link href="/verify" aria-current={active === 'verify' ? 'page' : undefined}>
            التوثيق
          </Link>
          <Link
            href="/login"
            className={styles.navCta}
            aria-current={active === 'login' ? 'page' : undefined}
          >
            تسجيل الدخول
          </Link>
        </nav>
      </header>
      {children}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <p>سكو — الطرف التجاري في مسار المشتريات والهندسة.</p>
          <div className={styles.footerLinks}>
            <Link href="/login">تسجيل الدخول</Link>
            <Link href="/partnership">مسار الشراكة</Link>
            <Link href="/verify">مدخل التوثيق</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
