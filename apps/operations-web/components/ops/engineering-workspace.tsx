'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiClientError,
  type InternalDocumentListItem,
  type InternalEngineeringBoqLine,
  type InternalEngineeringBoqVersion,
  type InternalEngineeringDHandoff,
  type InternalEngineeringRequestDetail,
} from '@sco/contracts';
import { api } from '../../lib/api';
import {
  boqVersionStatusAr,
  engineeringDocClassAr,
  engineeringStatusAr,
  formatWhen,
} from '../../lib/labels';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { mapOpsError } from './safe-error';
import styles from './ops.module.css';

type Props = { requestId: string };

const EMPTY_LINE = {
  description: '',
  specification: '',
  discipline: 'HVAC',
  quantity: '',
  unitId: '',
  brandPreference: '',
  modelPreference: '',
  engineeringNotes: '',
  partnerVisibleNotes: '',
  sourceDocumentId: '',
  sourceReference: '',
};

export function EngineeringWorkspace({ requestId }: Props) {
  const router = useRouter();
  const [request, setRequest] = useState<InternalEngineeringRequestDetail>();
  const [boq, setBoq] = useState<InternalEngineeringBoqVersion>();
  const [docs, setDocs] = useState<InternalDocumentListItem[]>([]);
  const [handoff, setHandoff] = useState<InternalEngineeringDHandoff>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [engineerUserId, setEngineerUserId] = useState('');
  const [partnerMessage, setPartnerMessage] = useState('');
  const [internalScratch, setInternalScratch] = useState('');
  const [approveAck, setApproveAck] = useState(false);
  const [approveToken, setApproveToken] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('');
  const [handoffAck, setHandoffAck] = useState(false);
  const [lineForm, setLineForm] = useState({ ...EMPTY_LINE, lineId: '' as string | undefined });
  const [editingLineId, setEditingLineId] = useState<string>();

  const draftVersion = useMemo(
    () => request?.versions.find((v) => v.status === 'DRAFT' || v.status === 'IN_REVIEW'),
    [request],
  );
  const approvedVersion = useMemo(
    () =>
      request?.versions.find((v) => v.id === request.currentApprovedBoqVersionId) ||
      request?.versions.filter((v) => v.status === 'APPROVED').slice(-1)[0],
    [request],
  );
  const boqImmutable = boq?.status === 'APPROVED' || boq?.status === 'SUPERSEDED';

  async function reload() {
    setError(undefined);
    try {
      const detail = await api.internalEngineeringRequestGet(requestId);
      setRequest(detail);
      const versionId =
        detail.versions.find((v) => v.status === 'DRAFT')?.id ||
        detail.currentApprovedBoqVersionId ||
        detail.versions.slice(-1)[0]?.id;
      if (versionId) {
        setBoq(await api.internalEngineeringBoqGet(versionId));
      } else {
        setBoq(undefined);
      }
      try {
        const page = await api.internalDocuments(1, 100);
        setDocs(
          page.items.filter(
            (doc) =>
              doc.linked_entity_type === 'ENGINEERING_REQUEST' && doc.linked_entity_id === requestId,
          ),
        );
      } catch {
        setDocs([]);
      }
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      setError(mapOpsError(failure, 'تعذر تحميل طلب الهندسة.'));
    }
  }

  useEffect(() => {
    void reload();
  }, [requestId]);

  async function assign(event: FormEvent) {
    event.preventDefault();
    if (!engineerUserId.trim()) {
      setError('معرّف المهندس مطلوب.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      setRequest(await api.internalEngineeringAssign(requestId, { engineerUserId: engineerUserId.trim() }));
      setMessage('تم إسناد المهندس.');
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر الإسناد.'));
    } finally {
      setBusy(false);
    }
  }

  async function transition(nextStatus: string, reason?: string) {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      // internalScratch never sent — only partner-visible reason when ACTION_REQUIRED
      setRequest(
        await api.internalEngineeringTransition(requestId, {
          nextStatus,
          reason: nextStatus === 'ACTION_REQUIRED' ? reason : reason,
        }),
      );
      setMessage(`تم تحديث الحالة إلى ${engineeringStatusAr(nextStatus)}.`);
      setPartnerMessage('');
      setInternalScratch('');
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر تحديث حالة الطلب.'));
    } finally {
      setBusy(false);
    }
  }

  async function createDraftBoq() {
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.internalEngineeringBoqVersionCreate(requestId);
      setBoq(created);
      setMessage(`تم إنشاء مسودة جداول كميات v${created.versionNumber}.`);
      await reload();
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر إنشاء مسودة جداول الكميات.'));
    } finally {
      setBusy(false);
    }
  }

  async function loadVersion(versionId: string) {
    setBusy(true);
    setError(undefined);
    try {
      setBoq(await api.internalEngineeringBoqGet(versionId));
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر تحميل إصدار جداول الكميات.'));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(line: InternalEngineeringBoqLine) {
    setEditingLineId(line.id);
    setLineForm({
      lineId: line.id,
      description: line.description,
      specification: line.specification || '',
      discipline: line.discipline || 'HVAC',
      quantity: String(line.quantity),
      unitId: line.unitId,
      brandPreference: line.brandPreference || '',
      modelPreference: line.modelPreference || '',
      engineeringNotes: line.engineeringNotes || '',
      partnerVisibleNotes: line.partnerVisibleNotes || '',
      sourceDocumentId: line.sourceDocumentId || '',
      sourceReference: line.sourceReference || '',
    });
  }

  async function saveLine(event: FormEvent) {
    event.preventDefault();
    if (!boq || boqImmutable) {
      setError('لا يمكن تعديل إصدار معتمد أو مُستبدَل.');
      return;
    }
    const qty = Number(lineForm.quantity);
    if (!lineForm.description.trim()) {
      setError('الوصف مطلوب.');
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('الكمية يجب أن تكون أكبر من صفر.');
      return;
    }
    if (!lineForm.unitId.trim()) {
      setError('معرّف الوحدة مطلوب.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const updated = await api.internalEngineeringBoqLineUpsert(boq.id, {
        lineId: lineForm.lineId || undefined,
        description: lineForm.description.trim(),
        specification: lineForm.specification || undefined,
        discipline: lineForm.discipline || undefined,
        quantity: qty,
        unitId: lineForm.unitId.trim(),
        brandPreference: lineForm.brandPreference || undefined,
        modelPreference: lineForm.modelPreference || undefined,
        engineeringNotes: lineForm.engineeringNotes || undefined,
        partnerVisibleNotes: lineForm.partnerVisibleNotes || undefined,
        sourceDocumentId: lineForm.sourceDocumentId || undefined,
        sourceReference: lineForm.sourceReference || undefined,
      });
      setBoq(updated);
      setMessage(editingLineId ? 'تم تحديث البند.' : 'تم إضافة البند.');
      setEditingLineId(undefined);
      setLineForm({ ...EMPTY_LINE, lineId: undefined });
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر حفظ بند جداول الكميات.'));
    } finally {
      setBusy(false);
    }
  }

  async function approveBoq(event: FormEvent) {
    event.preventDefault();
    if (!boq) return;
    if (!approveAck || approveToken.trim() !== boq.id) {
      setError('أكد المراجعة واكتب معرّف إصدار جداول الكميات — الاعتماد ليس نقرة واحدة.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const approved = await api.internalEngineeringBoqApprove(boq.id);
      setBoq(approved);
      setMessage('تم اعتماد جداول الكميات — الإصدار أصبح غير قابل للتعديل.');
      setApproveAck(false);
      setApproveToken('');
      await reload();
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر اعتماد جداول الكميات.'));
    } finally {
      setBusy(false);
    }
  }

  async function handoffToD(event: FormEvent) {
    event.preventDefault();
    if (!boq || boq.status !== 'APPROVED') {
      setError('يلزم إصدار جداول كميات معتمد للتسليم إلى المشتريات.');
      return;
    }
    if (!handoffAck || !deliveryLocation.trim()) {
      setError('موقع التسليم وتأكيد عدم التكرار مطلوبان.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const idempotencyKey = `f-d-handoff-${boq.id}`;
      const result = await api.internalEngineeringHandoffToD(boq.id, {
        deliveryLocation: deliveryLocation.trim(),
        idempotencyKey,
      });
      setHandoff(result);
      setMessage(
        result.status === 'CREATED'
          ? 'تم إنشاء متطلب المشتريات (D) من جداول الكميات المعتمدة.'
          : `حالة التسليم: ${result.status}`,
      );
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر التسليم إلى المشتريات — قد يكون مكررًا أو مرفوضًا.'));
    } finally {
      setBusy(false);
    }
  }

  if (error && !request) return <ErrorState message={error} />;
  if (!request) return <LoadingState />;

  return (
    <div className={styles.split}>
      <div style={{ display: 'grid', gap: '1.25rem' }}>
        <section className={styles.panel} aria-labelledby="eng-detail-title">
          <h2 id="eng-detail-title">تفاصيل طلب الهندسة</h2>
          {error ? (
            <p className={styles.alert} role="alert">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className={styles.ok} role="status">
              {message}
            </p>
          ) : null}
          <dl className={styles.dl}>
            <div>
              <dt>العنوان</dt>
              <dd>{request.title}</dd>
            </div>
            <div>
              <dt>الشركة الشريكة</dt>
              <dd dir="ltr">{request.companyId}</dd>
            </div>
            <div>
              <dt>القطاع</dt>
              <dd>{request.sector}</dd>
            </div>
            <div>
              <dt>التفاصيل</dt>
              <dd>{request.description || '—'}</dd>
            </div>
            <div>
              <dt>الحالة</dt>
              <dd>
                <span className={styles.badge}>{engineeringStatusAr(request.status)}</span>
              </dd>
            </div>
            <div>
              <dt>المهندس المُسنَد</dt>
              <dd dir="ltr">{request.assignedEngineerId || '—'}</dd>
            </div>
            <div>
              <dt>رسالة ظاهرة للشريك</dt>
              <dd>{request.partnerVisibleNotes || request.actionRequiredMessage || '—'}</dd>
            </div>
            <div>
              <dt>ملاحظات داخلية</dt>
              <dd className={styles.muted}>{request.internalNotes || '— (داخلية فقط — لا تُعرض للشريك)'}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.panel} aria-labelledby="assign-title">
          <h2 id="assign-title">إسناد مهندس</h2>
          <form className={styles.confirmBox} onSubmit={(e) => void assign(e)}>
            <label className={styles.field}>
              معرّف مستخدم المهندس (داخلي SCO)
              <input
                value={engineerUserId}
                onChange={(e) => setEngineerUserId(e.target.value)}
                dir="ltr"
                disabled={busy}
                required
              />
            </label>
            <button type="submit" className={styles.button} disabled={busy}>
              إسناد
            </button>
          </form>
        </section>

        <section className={styles.panel} aria-labelledby="docs-title">
          <h2 id="docs-title">مراجعة المستندات</h2>
          <p className={styles.muted}>
            عبر مركز المستندات الكنسي — بلا عارض جديد.{' '}
            <Link className={styles.rowLink} href="/documents">
              فتح مركز المستندات
            </Link>
          </p>
          {docs.length === 0 ? (
            <EmptyState message="لا مستندات مرتبطة بهذا الطلب في القائمة الداخلية المتاحة." />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">الملف</th>
                    <th scope="col">التصنيف</th>
                    <th scope="col">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc) => (
                    <tr key={doc.id}>
                      <td>{doc.filename}</td>
                      <td>{engineeringDocClassAr(doc.document_category)}</td>
                      <td>{doc.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="review-title">
          <h2 id="review-title">المراجعة</h2>
          <p className={styles.muted}>
            النص الظاهر للشريك منفصل عن المسودة الداخلية. المسودة الداخلية لا تُرسل مع الانتقالات.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.buttonGhost}
              disabled={busy}
              onClick={() => void transition('IN_REVIEW')}
            >
              بدء المراجعة
            </button>
            <button
              type="button"
              className={styles.buttonGhost}
              disabled={busy}
              onClick={() => void transition('BOQ_IN_PROGRESS')}
            >
              بدء إعداد جداول الكميات
            </button>
            <button
              type="button"
              className={styles.buttonGhost}
              disabled={busy}
              onClick={() => void transition('PENDING_APPROVAL')}
            >
              إرسال للاعتماد
            </button>
          </div>
          <form
            className={styles.confirmBox}
            onSubmit={(e) => {
              e.preventDefault();
              if (!partnerMessage.trim()) {
                setError('رسالة الشريك مطلوبة عند طلب معلومات.');
                return;
              }
              // internalScratch intentionally discarded
              void transition('ACTION_REQUIRED', partnerMessage.trim());
            }}
          >
            <label className={styles.field}>
              رسالة ظاهرة للشريك (تُرسل)
              <textarea value={partnerMessage} onChange={(e) => setPartnerMessage(e.target.value)} disabled={busy} />
            </label>
            <label className={styles.field}>
              مسودة داخلية (لا تُرسل أبدًا)
              <textarea
                value={internalScratch}
                onChange={(e) => setInternalScratch(e.target.value)}
                disabled={busy}
                placeholder="لن تُضمَّن في طلب الخادم"
              />
            </label>
            <button type="submit" className={styles.button} disabled={busy}>
              طلب معلومات من الشريك
            </button>
          </form>
        </section>

        <section className={styles.panel} aria-labelledby="boq-title">
          <h2 id="boq-title">مساحة جداول الكميات (BOQ)</h2>
          <div className={styles.toolbar}>
            <button type="button" className={styles.button} disabled={busy} onClick={() => void createDraftBoq()}>
              إنشاء مسودة / مراجعة
            </button>
            {request.versions.map((v) => (
              <button
                key={v.id}
                type="button"
                className={boq?.id === v.id ? styles.button : styles.buttonGhost}
                disabled={busy}
                onClick={() => void loadVersion(v.id)}
              >
                v{v.versionNumber} · {boqVersionStatusAr(v.status)}
              </button>
            ))}
          </div>

          {!boq ? (
            <EmptyState message="لا إصدار جداول كميات محمّل — أنشئ مسودة أو اختر إصدارًا." />
          ) : (
            <>
              <dl className={styles.dl}>
                <div>
                  <dt>الإصدار</dt>
                  <dd>
                    v{boq.versionNumber} · <span className={styles.badge}>{boqVersionStatusAr(boq.status)}</span>
                  </dd>
                </div>
                <div>
                  <dt>يستبدل</dt>
                  <dd dir="ltr">{boq.supersedesVersionId || '—'}</dd>
                </div>
                <div>
                  <dt>تاريخ الاعتماد</dt>
                  <dd>{formatWhen(boq.approvedAt)}</dd>
                </div>
                {boqImmutable ? (
                  <div>
                    <dt>قابلية التعديل</dt>
                    <dd className={styles.badgeOk}>معتمد/مُستبدَل — غير قابل للتعديل من الواجهة</dd>
                  </div>
                ) : null}
              </dl>

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">الوصف</th>
                      <th scope="col">المواصفات</th>
                      <th scope="col">التخصص</th>
                      <th scope="col">الوحدة</th>
                      <th scope="col">الكمية</th>
                      <th scope="col">ماركة/موديل</th>
                      <th scope="col">ملاحظات هندسية</th>
                      <th scope="col">مرجع المصدر</th>
                      <th scope="col">إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boq.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.description}</td>
                        <td>{line.specification || '—'}</td>
                        <td>{line.discipline || '—'}</td>
                        <td dir="ltr">{line.unitId.slice(0, 8)}…</td>
                        <td dir="ltr">{line.quantity}</td>
                        <td dir="ltr">
                          {[line.brandPreference, line.modelPreference].filter(Boolean).join(' / ') || '—'}
                        </td>
                        <td>{line.engineeringNotes || '—'}</td>
                        <td>
                          {line.sourceReference || '—'}
                          {line.sourceDocumentId ? (
                            <div className={styles.muted} dir="ltr">
                              doc {line.sourceDocumentId.slice(0, 8)}…
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {!boqImmutable ? (
                            <button type="button" className={styles.buttonGhost} onClick={() => startEdit(line)}>
                              تعديل
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!boqImmutable ? (
                <form className={styles.confirmBox} onSubmit={(e) => void saveLine(e)} aria-labelledby="line-form-title">
                  <h3 id="line-form-title" className={styles.muted}>
                    {editingLineId ? 'تعديل بند' : 'إضافة بند'}
                  </h3>
                  <p className={styles.note}>
                    حذف البنود غير متاح في عقد الخادم الحالي — عدّل البند أو أنشئ مراجعة جديدة عند الحاجة.
                  </p>
                  <label className={styles.field}>
                    الوصف
                    <input
                      value={lineForm.description}
                      onChange={(e) => setLineForm((f) => ({ ...f, description: e.target.value }))}
                      required
                      disabled={busy}
                    />
                  </label>
                  <label className={styles.field}>
                    المواصفات
                    <textarea
                      value={lineForm.specification}
                      onChange={(e) => setLineForm((f) => ({ ...f, specification: e.target.value }))}
                      disabled={busy}
                    />
                  </label>
                  <label className={styles.field}>
                    التخصص
                    <select
                      value={lineForm.discipline}
                      onChange={(e) => setLineForm((f) => ({ ...f, discipline: e.target.value }))}
                      disabled={busy}
                    >
                      {['HVAC', 'ELECTRICAL', 'PLUMBING', 'MULTI', 'OTHER'].map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    الكمية
                    <input
                      type="number"
                      min={0.0001}
                      step="any"
                      dir="ltr"
                      value={lineForm.quantity}
                      onChange={(e) => setLineForm((f) => ({ ...f, quantity: e.target.value }))}
                      required
                      disabled={busy}
                    />
                  </label>
                  <label className={styles.field}>
                    معرّف الوحدة (unitId)
                    <input
                      value={lineForm.unitId}
                      onChange={(e) => setLineForm((f) => ({ ...f, unitId: e.target.value }))}
                      dir="ltr"
                      required
                      disabled={busy}
                    />
                  </label>
                  <label className={styles.field}>
                    تفضيل الماركة
                    <input
                      value={lineForm.brandPreference}
                      onChange={(e) => setLineForm((f) => ({ ...f, brandPreference: e.target.value }))}
                      dir="ltr"
                      disabled={busy}
                    />
                  </label>
                  <label className={styles.field}>
                    تفضيل الموديل
                    <input
                      value={lineForm.modelPreference}
                      onChange={(e) => setLineForm((f) => ({ ...f, modelPreference: e.target.value }))}
                      dir="ltr"
                      disabled={busy}
                    />
                  </label>
                  <label className={styles.field}>
                    ملاحظات هندسية (داخلية)
                    <textarea
                      value={lineForm.engineeringNotes}
                      onChange={(e) => setLineForm((f) => ({ ...f, engineeringNotes: e.target.value }))}
                      disabled={busy}
                    />
                  </label>
                  <label className={styles.field}>
                    ملاحظات ظاهرة للشريك على البند
                    <textarea
                      value={lineForm.partnerVisibleNotes}
                      onChange={(e) => setLineForm((f) => ({ ...f, partnerVisibleNotes: e.target.value }))}
                      disabled={busy}
                    />
                  </label>
                  <label className={styles.field}>
                    مستند المصدر (documentId)
                    <input
                      value={lineForm.sourceDocumentId}
                      onChange={(e) => setLineForm((f) => ({ ...f, sourceDocumentId: e.target.value }))}
                      dir="ltr"
                      disabled={busy}
                    />
                  </label>
                  <label className={styles.field}>
                    مرجع المصدر (صفحة/لوحة/نص)
                    <input
                      value={lineForm.sourceReference}
                      onChange={(e) => setLineForm((f) => ({ ...f, sourceReference: e.target.value }))}
                      disabled={busy}
                    />
                  </label>
                  <div className={styles.actions}>
                    <button type="submit" className={styles.button} disabled={busy}>
                      حفظ البند
                    </button>
                    {editingLineId ? (
                      <button
                        type="button"
                        className={styles.buttonGhost}
                        onClick={() => {
                          setEditingLineId(undefined);
                          setLineForm({ ...EMPTY_LINE, lineId: undefined });
                        }}
                      >
                        إلغاء التعديل
                      </button>
                    ) : null}
                  </div>
                </form>
              ) : null}
            </>
          )}
        </section>

        {boq && (boq.status === 'DRAFT' || boq.status === 'IN_REVIEW') ? (
          <section className={styles.panel} aria-labelledby="approve-boq-title">
            <h2 id="approve-boq-title">اعتماد جداول الكميات</h2>
            <form className={styles.confirmBox} onSubmit={(e) => void approveBoq(e)}>
              <ul>
                <li>الإصدار: v{boq.versionNumber}</li>
                <li>عدد البنود: {boq.lines.length}</li>
                <li>بعد الاعتماد يصبح الإصدار غير قابل للتعديل</li>
              </ul>
              <label className={styles.field}>
                <input type="checkbox" checked={approveAck} onChange={(e) => setApproveAck(e.target.checked)} /> راجعت
                البنود والمستندات والملاحظات
              </label>
              <label className={styles.field}>
                اكتب معرّف الإصدار للتأكيد
                <input value={approveToken} onChange={(e) => setApproveToken(e.target.value)} dir="ltr" required />
              </label>
              <button type="submit" className={styles.button} disabled={busy}>
                اعتماد ونشر نتيجة للمسار الداخلي
              </button>
            </form>
          </section>
        ) : null}

        {boq?.status === 'APPROVED' ? (
          <section className={styles.panel} aria-labelledby="publish-preview-title">
            <h2 id="publish-preview-title">معاينة نتيجة الشريك</h2>
            <p className={styles.muted}>حقول ظاهرة فقط — بلا ملاحظات داخلية أو engineeringNotes.</p>
            <ul>
              {boq.lines.map((line) => (
                <li key={line.id}>
                  {line.description} · {line.quantity} · {line.partnerVisibleNotes || '—'} · مصدر:{' '}
                  {line.sourceReference || '—'}
                </li>
              ))}
            </ul>
            <p className={styles.note}>ملاحظات الإصدار الظاهرة: {boq.partnerVisibleNotes || '—'}</p>
            <p className={styles.muted}>الملاحظات الداخلية مخفية هنا عمدًا.</p>
          </section>
        ) : null}

        <section className={styles.panel} aria-labelledby="handoff-title">
          <h2 id="handoff-title">تسليم إلى المشتريات (D)</h2>
          <p className={styles.muted}>
            من إصدار معتمد فقط · عملية واحدة مكررة آمنة عبر idempotencyKey · نفس سلطة الخادم للشريك/الداخلي.
          </p>
          {approvedVersion ? (
            <p>
              الإصدار المعتمد الحالي: v{approvedVersion.versionNumber}{' '}
              <span dir="ltr">({approvedVersion.id.slice(0, 8)}…)</span>
            </p>
          ) : (
            <p className={styles.muted}>لا إصدار معتمد بعد.</p>
          )}
          {handoff ? (
            <dl className={styles.dl}>
              <div>
                <dt>حالة التسليم</dt>
                <dd>{handoff.status}</dd>
              </div>
              <div>
                <dt>متطلب D</dt>
                <dd dir="ltr">{handoff.procurementRequirementId}</dd>
              </div>
              <div>
                <dt>وقت التسليم</dt>
                <dd>{formatWhen(handoff.handedOffAt)}</dd>
              </div>
            </dl>
          ) : null}
          <form className={styles.confirmBox} onSubmit={(e) => void handoffToD(e)}>
            <label className={styles.field}>
              موقع التسليم
              <input
                value={deliveryLocation}
                onChange={(e) => setDeliveryLocation(e.target.value)}
                disabled={busy || !boq || boq.status !== 'APPROVED'}
                required
              />
            </label>
            <label className={styles.field}>
              <input
                type="checkbox"
                checked={handoffAck}
                onChange={(e) => setHandoffAck(e.target.checked)}
                disabled={busy}
              />{' '}
              أفهم أن التسليم المكرر لن يُنشئ متطلب D ثانيًا لنفس الإصدار
            </label>
            <button type="submit" className={styles.button} disabled={busy || !boq || boq.status !== 'APPROVED'}>
              تسليم إلى المشتريات
            </button>
          </form>
        </section>
      </div>

      <aside className={styles.panel} aria-labelledby="history-title">
        <h2 id="history-title">سجل الإصدارات</h2>
        {request.versions.length === 0 ? (
          <EmptyState message="لا إصدارات بعد." />
        ) : (
          <ul>
            {request.versions.map((v) => (
              <li key={v.id}>
                <button type="button" className={styles.rowLink} onClick={() => void loadVersion(v.id)}>
                  v{v.versionNumber} · {boqVersionStatusAr(v.status)}
                </button>
                <div className={styles.muted}>{formatWhen(v.createdAt)}</div>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.note}>المسودة الحالية: {draftVersion ? `v${draftVersion.versionNumber}` : '—'}</p>
        <p className={styles.note}>
          المعتمد الحالي: {approvedVersion ? `v${approvedVersion.versionNumber}` : '—'}
        </p>
      </aside>
    </div>
  );
}
