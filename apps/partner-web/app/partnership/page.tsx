import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicChrome } from '../../components/reception/public-chrome';
import styles from '../../components/reception/reception.module.css';

export const metadata: Metadata = {
  title: 'مسار الشراكة',
};

/**
 * PARTNER_ENTRY_STATUS=SHELL
 * Public admission UI is not implemented; backend admission APIs remain authenticated-only.
 */
export default function PartnershipEntryPage() {
  return (
    <PublicChrome active="partnership">
      <main id="main" className={styles.shellPage}>
        <p className={styles.status}>SHELL · غير مكتمل في هذه المرحلة</p>
        <h1>مسار الشراكة</h1>
        <p>
          سكو هو الطرف التجاري في علاقة الشراكة. لا نقدّم هنا نموذج تسجيل وهميًا ولا زرًا يدّعي
          إتمام قبول شريك.
        </p>
        <p>
          قبول الاتفاقيات ومسار الانضمام الحاليان يعملان داخل بوابة الشريك بعد تسجيل الدخول
          للمستخدمين المخوّلين — وليسا سوقًا مفتوحًا للتسجيل الذاتي على هذه الصفحة.
        </p>
        <div className={styles.ctaRow}>
          <Link href="/login" className={styles.button}>
            تسجيل الدخول
          </Link>
          <Link href="/" className={styles.buttonGhost}>
            العودة إلى الاستقبال
          </Link>
        </div>
      </main>
    </PublicChrome>
  );
}
