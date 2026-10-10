import Link from 'next/link';
import { PublicChrome } from './public-chrome';
import styles from './reception.module.css';

/**
 * SCO digital reception — Arabic-first, membership/commercial-counterparty framing.
 * No trust claims without evidence. Journey links: live login; shell partnership/verify.
 */
export function ReceptionHome() {
  return (
    <PublicChrome active="home">
      <section className={styles.hero} aria-labelledby="sco-brand">
        <div className={styles.heroInner}>
          <h1 id="sco-brand" className={styles.brandHero}>
            سكو
            <span className={styles.brandHeroLatin}>SCO</span>
          </h1>
          <p className={styles.headline}>مشتريات أعمال بفهم هندسي.</p>
          <p className={styles.lede}>
            سكو منصة أعمال تربط مسارات المشتريات بالفهم الهندسي عبر التكييف والكهرباء والسباكة —
            والطرف التجاري في العلاقة هو سكو، لا سوقًا مفتوحًا بين الشركاء والمورّدين.
          </p>
          <ul className={styles.domains} aria-label="المجالات">
            <li>التكييف</li>
            <li>الكهرباء</li>
            <li>السباكة</li>
          </ul>
          <div className={styles.ctaRow}>
            <Link href="/login" className={styles.button}>
              تسجيل الدخول
            </Link>
            <Link href="/partnership" className={styles.buttonGhost}>
              مسار الشراكة
            </Link>
            <Link href="/verify" className={styles.buttonGhost}>
              مدخل التوثيق
            </Link>
          </div>
        </div>
      </section>

      <main id="main" className={styles.main}>
        <section id="what" className={styles.section} aria-labelledby="what-title">
          <h2 id="what-title">ماذا يفعل سكو</h2>
          <p>
            يوفّر سكو مسارًا محكومًا لمشتريات الأعمال والعمليات المرتبطة بها، مع طبقة فهم هندسي
            تساعد فرق التطوير والمقاولات والمشتريات على العمل ضمن حدود واضحة للصلاحيات والمستأجر.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="signal-title">
          <h2 id="signal-title">مشتريات + هندسة</h2>
          <ul className={styles.signalList}>
            <li>
              <strong>المشتريات</strong>
              <span>مسارات طلب وتوريد وتشغيل ضمن علاقة تجارية مع سكو.</span>
            </li>
            <li>
              <strong>الهندسة</strong>
              <span>فهم فني للمجالات الثلاثة دون تحويل الصفحة إلى كتالوج تسويقي.</span>
            </li>
            <li>
              <strong>حوكمة المسار</strong>
              <span>دخول موثّق، صلاحيات، وحدود مستأجر — لا وظائف وهمية على الواجهة العامة.</span>
            </li>
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="journey-title">
          <h2 id="journey-title">كيف تبدأ</h2>
          <p>
            استخدم تسجيل الدخول إن كان لديك حساب شريك فعّال. مسار الشراكة ومدخل التوثيق معروضان
            كمداخل منتج واضحة؛ ما لم يكن المسار مكتملًا في هذه المرحلة يُبيَّن ذلك صراحةً.
          </p>
          <p className={styles.note} role="note">
            لا ندّعي هنا حصص سوق أو شهادات أو نسب توفير أو أرقام عملاء دون دليل موثّق.
          </p>
          <div className={styles.ctaRow}>
            <Link href="/login" className={styles.button}>
              الدخول إلى بوابة الشريك
            </Link>
            <Link href="/partnership" className={styles.buttonGhost}>
              معرفة مسار الشراكة
            </Link>
          </div>
        </section>
      </main>
    </PublicChrome>
  );
}
