import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicChrome } from '../../components/reception/public-chrome';
import styles from '../../components/reception/reception.module.css';

export const metadata: Metadata = {
  title: 'مدخل التوثيق',
};

/**
 * VERIFY_ENTRY_STATUS=SHELL
 * No Verify business logic in Wave 1 — visible product entry only.
 */
export default function VerifyEntryPage() {
  return (
    <PublicChrome active="verify">
      <main id="main" className={styles.shellPage}>
        <p className={styles.status}>SHELL · منطق التوثيق غير مُنفَّذ هنا</p>
        <h1>مدخل التوثيق</h1>
        <p>
          هذه نقطة دخول مرئية لمسار التوثيق في منتج سكو. لا تُنفَّذ عمليات تحقق أو اعتماد من هذه
          الصفحة في الموجة الحالية، ولا تُعرض نتائج وهمية.
        </p>
        <p>
          عندما يتوفر سطح توثيق شريك مكتمل، سيُربط هذا المدخل بالمسار الحقيقي دون تغيير معنى
          «توثيق» إلى وظيفة مزيفة.
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
