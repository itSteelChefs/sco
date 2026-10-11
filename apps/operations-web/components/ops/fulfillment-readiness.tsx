'use client';

import type { InternalFulfillmentReadiness } from '@sco/contracts';
import { readinessReasonAr } from '../../lib/labels';
import styles from './ops.module.css';

type Props = { readiness?: InternalFulfillmentReadiness; loading?: boolean };

/**
 * Displays backend fulfillment readiness only.
 * Prefer `fulfillmentReady` / reason codes from Cursor3 DTOs — do not invent competing client rules.
 */
export function FulfillmentReadinessPanel({ readiness, loading }: Props) {
  if (loading || !readiness) {
    return (
      <section className={styles.panel} aria-labelledby="readiness-title">
        <h2 id="readiness-title">جاهزية التنفيذ</h2>
        <p className={styles.muted}>
          تُعرض جاهزية التنفيذ من حقول الخادم (`fulfillmentReady` / أسباب العقد) فقط — دون قواعد منافسة في الواجهة.
        </p>
        <p className={styles.muted}>{loading ? 'جارٍ التحميل…' : 'لا تتوفر إشارة جاهزية من الخادم بعد.'}</p>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="readiness-title">
      <h2 id="readiness-title">جاهزية التنفيذ</h2>
      <p className={styles.muted}>المصدر: {readiness.source} — دون إعادة حساب قواعد منافسة محليًا.</p>
      <p>
        <span className={readiness.ready ? styles.badgeOk : styles.badgeWarn}>
          {readiness.ready ? 'جاهز للتنفيذ' : 'غير جاهز للتنفيذ'}
        </span>
      </p>
      {readiness.fulfillmentReady != null ? (
        <p className={styles.muted}>
          fulfillmentReady (خادم): {String(readiness.fulfillmentReady)}
        </p>
      ) : null}
      {readiness.reasons.length === 0 ? (
        <p className={styles.muted}>{readiness.ready ? 'لا موانع معلنة من الخادم.' : 'لا أسباب مفصّلة.'}</p>
      ) : (
        <ul>
          {readiness.reasons.map((reason) => (
            <li key={reason}>{readinessReasonAr(reason)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
