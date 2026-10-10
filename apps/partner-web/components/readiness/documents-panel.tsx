'use client';

import { ApiClientError, type PartnerDocumentCategory, type PartnerDocumentUploadResult } from '@sco/contracts';
import { useState } from 'react';
import { readinessApi } from '../../lib/readiness-api';
import { DOCUMENT_CATEGORY_OPTIONS } from './readiness-labels';
import styles from './readiness.module.css';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'application/json']);

type Props = {
  companyId: string;
  onUploaded?: (doc: PartnerDocumentUploadResult) => void;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('READ_FAILED'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function DocumentsPanel({ companyId, onUploaded }: Props) {
  const [category, setCategory] = useState<PartnerDocumentCategory>('VERIFY_QUOTE');
  const [file, setFile] = useState<File | null>(null);
  const [uploads, setUploads] = useState<PartnerDocumentUploadResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function upload() {
    setError('');
    setMessage('');
    if (!file) {
      setError('اختر ملفًا أولًا.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('حجم الملف يتجاوز 10 ميغابايت.');
      return;
    }
    if (!ALLOWED.has(file.type) && !ALLOWED.has(file.type.toLowerCase())) {
      setError('نوع الملف غير مسموح. استخدم PDF أو صورة أو نص.');
      return;
    }
    setBusy(true);
    setMessage('جارٍ الرفع...');
    try {
      const contentBase64 = await fileToBase64(file);
      const result = await readinessApi.documentUpload(companyId, {
        category,
        filename: file.name,
        contentType: file.type || 'application/pdf',
        contentBase64,
      });
      setUploads((current) => [result, ...current]);
      setMessage(`تم الرفع: ${result.filename}`);
      setFile(null);
      onUploaded?.(result);
    } catch (failure) {
      setMessage('');
      if (failure instanceof ApiClientError) {
        if (failure.status === 401) setError('انتهت الجلسة.');
        else if (failure.status === 403) setError('لا تملك صلاحية رفع المستندات.');
        else if (failure.code === 'DOCUMENT_TYPE_NOT_ALLOWED') setError('نوع/فئة المستند غير مسموحة.');
        else if (failure.code === 'DOCUMENT_TOO_LARGE') setError('الملف كبير جدًا.');
        else if (failure.code === 'VALIDATION_FAILED') setError('تعذر قبول الملف.');
        else setError('فشل الرفع.');
      } else setError('فشل قراءة الملف أو الرفع.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="docs-title" data-testid="documents-panel">
      <div className={styles.statusRow}>
        <h2 id="docs-title">مستندات الشريك</h2>
        <span className={styles.truth}>LIVE</span>
      </div>
      <p className={styles.panelLead}>
        رفع مستندات ضمن فئات موجّهة. تُحفظ النسخة الأصلية لدى سكو طوال العلاقة النشطة وما بعدها حسب سياسة الاحتفاظ —
        دون عرض تفاصيل داخلية للمعالجة.
      </p>

      <div className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="doc-category">الفئة</label>
          <select
            id="doc-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as PartnerDocumentCategory)}
            disabled={busy}
          >
            {DOCUMENT_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="doc-file">الملف</label>
          <input
            id="doc-file"
            type="file"
            accept=".pdf,image/png,image/jpeg,text/plain,application/json"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? <p className={styles.hint}>{file.name} · {(file.size / 1024).toFixed(1)} ك.ب</p> : null}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={busy || !file} onClick={() => void upload()}>
            {busy ? 'جارٍ الرفع...' : 'رفع المستند'}
          </button>
        </div>
      </div>

      <div className={styles.liveRegion} aria-live="polite">
        {message}
        {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
      </div>

      {uploads.length ? (
        <ul className={styles.agreementList}>
          {uploads.map((doc) => (
            <li key={doc.documentId}>
              <strong>{doc.filename}</strong>
              <span className={styles.badge}>{doc.category}</span>
              <span className={styles.hint}>{doc.documentId.slice(0, 8)}…</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
