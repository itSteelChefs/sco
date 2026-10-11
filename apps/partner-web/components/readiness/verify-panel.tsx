'use client';

import { ApiClientError, type PartnerDocumentUploadResult, type PartnerVerifyResult } from '@sco/contracts';
import { useMemo, useState } from 'react';
import { readinessApi } from '../../lib/readiness-api';
import {
  coverageQualityLabelAr,
  verifyClassificationLabelAr,
  verifyRequestStatusLabelAr,
} from './readiness-labels';
import styles from './readiness.module.css';

type Props = {
  companyId: string;
  uploadedDocuments: PartnerDocumentUploadResult[];
};

/**
 * Partner Verify intake + result — Quote Check only.
 * Quote lines require unitId; Partner unit-list HTTP is absent → optional
 * NEXT_PUBLIC_SCO_DEFAULT_UNIT_ID until a partner unit catalog exists.
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
  const [result, setResult] = useState<PartnerVerifyResult | null>(null);
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
    if (failure.status === 404) return 'لا نتيجة متاحة لهذا الطلب بعد.';
    if (failure.code === 'DOCUMENT_LINK_INVALID') return 'المستند غير صالح أو لا يخص شركتك.';
    if (failure.code === 'VERIFY_QUOTE_REQUIRED') return 'يلزم إرفاق عرض السعر قبل الإرسال.';
    if (failure.code === 'VALIDATION_FAILED') return 'بيانات غير صالحة.';
    return 'تعذر إكمال طلب التوثيق.';
  }

  async function createDraft() {
    setBusy(true);
    setError('');
    setResult(null);
    setMessage('جارٍ إنشاء مسودة توثيق عرض السعر...');
    try {
      const draft = await readinessApi.verifyCreate(companyId);
      setRequestId(draft.requestId);
      setStatus(draft.status);
      setRevisionId('');
      setMessage(`مسودة جاهزة · توثيق عرض سعر · ${draft.requestId.slice(0, 8)}…`);
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
      setError('اختر مستند عرض سعر مرفوعًا (فئة عرض السعر للتوثيق).');
      return;
    }
    if (!/^[0-9a-f-]{36}$/i.test(unitId.trim())) {
      setError('معرّف الوحدة غير متوفر حاليًا. أكمل الإعداد مع فريق سكو أو ارفع العرض بعد توفر كتالوج الوحدات.');
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
            itemDescription: description.trim() || 'بند عرض سعر',
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
      setMessage(`تم إرسال طلب التوثيق · الحالة ${verifyRequestStatusLabelAr(submitted.status)}`);
    } catch (failure) {
      setMessage('');
      setError(mapError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function loadResult() {
    if (!requestId) {
      setError('أنشئ أو اختر طلبًا أولًا.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('جارٍ جلب النتيجة من الخادم...');
    try {
      const current = await readinessApi.verifyGetResult(companyId, requestId);
      setResult(current);
      setStatus(current.status);
      setMessage(`نتيجة متاحة · ${verifyClassificationLabelAr(current.classification)}`);
    } catch (failure) {
      setResult(null);
      setMessage('');
      setError(mapError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="verify-title" data-testid="verify-panel">
      <div className={styles.statusRow}>
        <h2 id="verify-title">تأكّد — توثيق عرض السعر</h2>
        <span className={styles.truth}>مسار فعّال · عرض سعر فقط</span>
      </div>
      <p className={styles.panelLead}>
        إدخال طلب توثيق عرض سعر فقط. لا يشمل فحص سعر عامًا، ولا RFQ، ولا أمر شراء، ولا تفاوضًا.
      </p>

      <div className={styles.actions}>
        <button type="button" className={styles.button} disabled={busy} onClick={() => void createDraft()}>
          بدء مسودة التوثيق
        </button>
        <button type="button" className={styles.buttonGhost} disabled={busy || !requestId} onClick={() => void loadResult()}>
          جلب النتيجة
        </button>
      </div>

      {requestId ? (
        <p className={styles.hint} role="status" data-testid="verify-status">
          رقم الطلب: {requestId.slice(0, 8)}… · الحالة: {verifyRequestStatusLabelAr(status)}
          {revisionId ? ` · مراجعة: ${revisionId.slice(0, 8)}…` : ''}
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
            <option value="">{quoteDocs.length ? 'اختر مستند عرض السعر' : 'ارفع مستند عرض السعر أولًا'}</option>
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
          <input
            id="verify-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            disabled={busy}
            maxLength={3}
          />
        </div>
        {defaultUnitId ? (
          <p className={styles.hint}>وحدة القياس مُعدّة لهذا المسار تلقائيًا.</p>
        ) : (
          <div className={styles.field}>
            <label htmlFor="verify-unit">معرّف الوحدة</label>
            <input
              id="verify-unit"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              disabled={busy}
              aria-describedby="verify-unit-hint"
            />
            <p id="verify-unit-hint" className={styles.hint}>
              لا توجد واجهة شريك لسرد الوحدات بعد.
            </p>
          </div>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={busy || !requestId} onClick={() => void attachAndSubmit()}>
            إرفاق العرض وإرسال التوثيق
          </button>
        </div>
      </div>

      {result ? (
        <section aria-labelledby="verify-result-title" data-testid="verify-result">
          <h3 id="verify-result-title">نتيجة التوثيق</h3>
          <dl className={styles.summaryGrid}>
            <dt>الحالة</dt>
            <dd>{verifyRequestStatusLabelAr(result.status)}</dd>
            <dt>التصنيف</dt>
            <dd>{verifyClassificationLabelAr(result.classification)}</dd>
            <dt>تاريخ الإقفال</dt>
            <dd>{result.finalizedAt ? new Date(result.finalizedAt).toLocaleString('ar') : '—'}</dd>
          </dl>
          <h4>نطاق التغطية</h4>
          {result.coverage.length === 0 ? (
            <p className={styles.hint}>لا بيانات تغطية في النتيجة.</p>
          ) : (
            <ul className={styles.agreementList}>
              {result.coverage.map((entry) => (
                <li key={`${entry.currency}-${entry.totalLineCount}`}>
                  <strong>{entry.currency}</strong>
                  <span className={styles.badge}>{coverageQualityLabelAr(entry)}</span>
                  <span className={styles.hint}>
                    بنود محققة {entry.verifiedLineCount}/{entry.totalLineCount} · مستبعدة {entry.excludedLineCount} ·
                    غير كافية {entry.insufficientLineCount}
                  </span>
                  <span className={styles.hint}>
                    تغطية البنود {entry.lineCoveragePercent}% · تغطية القيمة {entry.valueCoveragePercent}%
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h4>الحقول التشغيلية</h4>
          <dl className={styles.summaryGrid} data-testid="verify-operational-fields">
            <dt>قيمة العرض</dt>
            <dd>{result.offerValue == null ? '—' : JSON.stringify(result.offerValue)}</dd>
            <dt>النطاق المرجعي المحقّق</dt>
            <dd>{result.verifiedReferenceScope == null ? '—' : JSON.stringify(result.verifiedReferenceScope)}</dd>
            <dt>الفجوة</dt>
            <dd>{result.gap == null ? '—' : JSON.stringify(result.gap)}</dd>
            <dt>الثقة</dt>
            <dd>{result.confidence == null ? '—' : JSON.stringify(result.confidence)}</dd>
            <dt>الإجراء المقترح</dt>
            <dd>{result.proposedAction || '—'}</dd>
          </dl>
        </section>
      ) : null}

      <div className={styles.liveRegion} aria-live="polite">
        {message}
        {error ? (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
