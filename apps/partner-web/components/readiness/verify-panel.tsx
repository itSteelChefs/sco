'use client';

import { ApiClientError, type PartnerDocumentUploadResult } from '@sco/contracts';
import { useMemo, useState } from 'react';
import { readinessApi } from '../../lib/readiness-api';
import styles from './readiness.module.css';

type Props = {
  companyId: string;
  uploadedDocuments: PartnerDocumentUploadResult[];
};

/**
 * Partner Verify intake — Quote Check only.
 * Quote lines require unitId; Partner unit-list HTTP is absent → use optional
 * NEXT_PUBLIC_SCO_DEFAULT_UNIT_ID until Cursor3/Cursor4 provide a catalog.
 */
export function VerifyPanel({ companyId, uploadedDocuments }: Props) {
  const quoteDocs = useMemo(
    () => uploadedDocuments.filter((doc) => doc.category === 'VERIFY_QUOTE'),
    [uploadedDocuments],
  );
  const defaultUnitId = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SCO_DEFAULT_UNIT_ID ?? '' : '';

  const [requestId, setRequestId] = useState('');
  const [revisionId, setRevisionId] = useState('');
  const [status, setStatus] = useState('');
  const [selectedDoc, setSelectedDoc] = useState('');
  const [description, setDescription] = useState('عرض سعر');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('0');
  const [currency, setCurrency] = useState('SAR');
  const [unitId, setUnitId] = useState(defaultUnitId);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function mapError(failure: unknown): string {
    if (!(failure instanceof ApiClientError)) return 'تعذر إكمال طلب التوثيق.';
    if (failure.status === 401) return 'انتهت الجلسة.';
    if (failure.status === 403) return 'غير مصرح بهذا الإجراء.';
    if (failure.code === 'DOCUMENT_LINK_INVALID') return 'المستند غير صالح أو لا يخص شركتك.';
    if (failure.code === 'VERIFY_QUOTE_REQUIRED') return 'يلزم إرفاق عرض السعر قبل الإرسال.';
    if (failure.code === 'VALIDATION_FAILED') return 'بيانات غير صالحة.';
    return 'تعذر إكمال طلب التوثيق.';
  }

  async function createDraft() {
    setBusy(true);
    setError('');
    setMessage('جارٍ إنشاء مسودة Quote Check...');
    try {
      const draft = await readinessApi.verifyCreate(companyId);
      setRequestId(draft.requestId);
      setStatus(draft.status);
      setRevisionId('');
      setMessage(`مسودة جاهزة · ${draft.productMode} · ${draft.requestId.slice(0, 8)}…`);
    } catch (failure) {
      setMessage('');
      setError(mapError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function attachAndSubmit() {
    setError('');
    if (!requestId) {
      setError('أنشئ مسودة أولًا.');
      return;
    }
    const doc = quoteDocs.find((item) => item.documentId === selectedDoc);
    if (!doc) {
      setError('اختر مستند عرض سعر مرفوعًا (فئة VERIFY_QUOTE).');
      return;
    }
    if (!/^[0-9a-f-]{36}$/i.test(unitId.trim())) {
      setError('معرّف الوحدة غير متوفر. يلزم كتالوج وحدات للشريك أو ضبط NEXT_PUBLIC_SCO_DEFAULT_UNIT_ID.');
      return;
    }
    setBusy(true);
    setMessage('جارٍ إرفاق العرض...');
    try {
      const attached = await readinessApi.verifyAttachQuote(companyId, requestId, {
        documentId: doc.documentId,
        documentVersionId: doc.versionId,
        currencies: [currency],
        idempotencyKey:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `verify-${Date.now()}`,
        lines: [
          {
            lineNumber: 1,
            itemDescription: description.trim() || 'Quote line',
            unitId: unitId.trim(),
            quantity: Number(quantity) || 1,
            currencyCode: currency,
            unitPrice: Number(unitPrice) || 0,
          },
        ],
      });
      setRevisionId(attached.revisionId);
      setStatus(attached.status);
      setMessage('تم الإرفاق · جارٍ الإرسال...');
      const submitted = await readinessApi.verifySubmit(companyId, requestId, attached.revisionId);
      setStatus(submitted.status);
      setMessage(`تم إرسال طلب التوثيق · الحالة ${submitted.status}`);
    } catch (failure) {
      setMessage('');
      setError(mapError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="verify-title" data-testid="verify-panel">
      <div className={styles.statusRow}>
        <h2 id="verify-title">تأكّد / Verify — Quote Check</h2>
        <span className={styles.truth}>LIVE · Quote Check only</span>
      </div>
      <p className={styles.panelLead}>
        إدخال طلب توثيق عرض سعر فقط. لا يوجد فحص سعر عام، ولا RFQ، ولا أمر شراء، ولا تفاوض.
      </p>

      <div className={styles.actions}>
        <button type="button" className={styles.button} disabled={busy} onClick={() => void createDraft()}>
          بدء مسودة Quote Check
        </button>
      </div>

      {requestId ? (
        <p className={styles.hint} role="status">
          الطلب: {requestId} · الحالة: {status || '—'}
          {revisionId ? ` · المراجعة: ${revisionId.slice(0, 8)}…` : ''}
        </p>
      ) : null}

      <div className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="verify-doc">مستند عرض السعر (من رفعاتك)</label>
          <select
            id="verify-doc"
            value={selectedDoc}
            onChange={(e) => setSelectedDoc(e.target.value)}
            disabled={busy || !quoteDocs.length}
          >
            <option value="">{quoteDocs.length ? 'اختر مستند VERIFY_QUOTE' : 'ارفع مستند VERIFY_QUOTE أولًا'}</option>
            {quoteDocs.map((doc) => (
              <option key={doc.documentId} value={doc.documentId}>
                {doc.filename}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="verify-desc">وصف البند</label>
          <input id="verify-desc" value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
        </div>
        <div className={styles.field}>
          <label htmlFor="verify-qty">الكمية</label>
          <input id="verify-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} disabled={busy} />
        </div>
        <div className={styles.field}>
          <label htmlFor="verify-price">سعر الوحدة</label>
          <input id="verify-price" inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} disabled={busy} />
        </div>
        <div className={styles.field}>
          <label htmlFor="verify-currency">العملة</label>
          <input id="verify-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} disabled={busy} maxLength={3} />
        </div>
        <div className={styles.field}>
          <label htmlFor="verify-unit">معرّف الوحدة (unitId)</label>
          <input
            id="verify-unit"
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            disabled={busy}
            placeholder="يلزم كتالوج وحدات للشريك"
            aria-describedby="verify-unit-hint"
          />
          <p id="verify-unit-hint" className={styles.hint}>
            لا توجد واجهة شريك لسرد الوحدات بعد. يمكن ضبط NEXT_PUBLIC_SCO_DEFAULT_UNIT_ID مؤقتًا للبيئات التي تملك وحدة معروفة.
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={busy || !requestId} onClick={() => void attachAndSubmit()}>
            إرفاق العرض وإرسال التوثيق
          </button>
        </div>
      </div>

      <div className={styles.liveRegion} aria-live="polite">
        {message}
        {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
