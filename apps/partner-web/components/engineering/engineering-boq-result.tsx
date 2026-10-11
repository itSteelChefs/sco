'use client';

import type { PartnerEngineeringResultVersion } from './engineering-types';
import { engineeringStatusLabelAr, formatDateAr } from './engineering-labels';
import styles from './engineering.module.css';

type Props = {
  versions: PartnerEngineeringResultVersion[];
};

export function EngineeringBoqResult({ versions }: Props) {
  if (!versions.length) {
    return (
      <section className={styles.panel} aria-labelledby="eng-boq-title" data-testid="engineering-boq-result">
        <h2 id="eng-boq-title">نتيجة الدراسة / جدول الكميات</h2>
        <p className={styles.hint} role="status">
          لا نتيجة معتمدة معروضة بعد.
        </p>
      </section>
    );
  }

  const current = versions.find((item) => item.isCurrent) ?? versions[0];
  const previous = versions.filter((item) => item.versionId !== current.versionId);

  return (
    <section className={styles.panel} aria-labelledby="eng-boq-title" data-testid="engineering-boq-result">
      <div className={styles.row}>
        <h2 id="eng-boq-title">نتيجة الدراسة / جدول الكميات</h2>
        <span className={`${styles.badge} ${styles.badgeAccent}`} data-testid="eng-current-version">
          الإصدار الحالي: {current.versionLabel}
        </span>
        <span className={styles.badge}>{engineeringStatusLabelAr(current.status)}</span>
      </div>
      {current.approvedAt ? <p className={styles.hint}>تاريخ الاعتماد: {formatDateAr(current.approvedAt)}</p> : null}
      {current.summary ? <p className={styles.panelLead}>{current.summary}</p> : null}

      <div className={styles.tableWrap}>
        <table className={styles.boqTable} data-testid="engineering-boq-table">
          <caption className={styles.hint}>بنود جدول الكميات المعتمد</caption>
          <thead>
            <tr>
              <th scope="col">البند</th>
              <th scope="col">الوصف</th>
              <th scope="col">المواصفة</th>
              <th scope="col">الوحدة</th>
              <th scope="col">الكمية</th>
              <th scope="col">التصنيف</th>
              <th scope="col">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {current.lines.map((line) => (
              <tr key={line.lineNumber} data-testid="engineering-boq-line">
                <td className={styles.mixed}>{line.itemCode ?? line.lineNumber}</td>
                <td className={styles.mixed}>{line.description}</td>
                <td className={styles.mixed}>{line.specification ?? '—'}</td>
                <td className={styles.mixed}>{line.unit}</td>
                <td>{line.quantity}</td>
                <td>{line.classification ?? '—'}</td>
                <td>{line.notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.boqCards} data-testid="engineering-boq-cards">
        {current.lines.map((line) => (
          <div key={line.lineNumber} className={styles.boqCard}>
            <strong className={styles.mixed}>
              البند {line.itemCode ?? line.lineNumber}: {line.description}
            </strong>
            <span className={styles.mixed}>المواصفة: {line.specification ?? '—'}</span>
            <span className={styles.mixed}>
              الوحدة: {line.unit} · الكمية: {line.quantity}
            </span>
            <span>التصنيف: {line.classification ?? '—'}</span>
            {line.notes ? <span>ملاحظات: {line.notes}</span> : null}
          </div>
        ))}
      </div>

      {current.sourceReferences?.length ? (
        <div>
          <h3>مراجع المصدر</h3>
          <ul className={styles.list}>
            {current.sourceReferences.map((ref) => (
              <li key={`${ref.label}-${ref.documentId ?? ''}`} className={styles.hint}>
                {ref.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {previous.length > 0 ? (
        <div data-testid="engineering-previous-versions">
          <h3>إصدارات سابقة</h3>
          <p className={styles.hint}>الإصدارات السابقة تبقى للمرجعية — لا تُحذف ضمنيًا.</p>
          <ul className={styles.list}>
            {previous.map((version) => (
              <li key={version.versionId} className={styles.listItem}>
                <strong>{version.versionLabel}</strong>
                <span className={styles.badge}>{engineeringStatusLabelAr(version.status)}</span>
                {version.approvedAt ? <span className={styles.hint}>{formatDateAr(version.approvedAt)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
