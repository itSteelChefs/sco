'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiClientError,
  type InternalPartnerAllocation,
  type InternalSupplierOrder,
} from '@sco/contracts';
import { api } from '../../lib/api';
import { moneyAr, purchaseStatusAr } from '../../lib/labels';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { AllocationPanel } from './allocation-panel';
import { ConsolidationPanel } from './consolidation-panel';
import { FulfillmentReadinessPanel } from './fulfillment-readiness';
import { ResaleOps } from './resale-ops';
import { mapOpsError } from './safe-error';
import styles from './ops.module.css';

type Props = { supplierOrderId: string };

export function SupplierOrderWorkspace({ supplierOrderId }: Props) {
  const router = useRouter();
  const [order, setOrder] = useState<InternalSupplierOrder>();
  const [allocations, setAllocations] = useState<InternalPartnerAllocation[]>([]);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [approveAck, setApproveAck] = useState(false);
  const [approveToken, setApproveToken] = useState('');
  const [issueAck, setIssueAck] = useState(false);
  const [issueToken, setIssueToken] = useState('');
  const [confirmRef, setConfirmRef] = useState('');
  const [confirmDate, setConfirmDate] = useState('');
  const [confirmNotes, setConfirmNotes] = useState('');
  const [lineQty, setLineQty] = useState<Record<string, string>>({});
  const [resalePartnerId, setResalePartnerId] = useState('');
  const [cancelNote, setCancelNote] = useState('');

  const showMargin = order?.canViewMargin === true || order?.grossMargin != null;

  const consolidationRows = useMemo(() => {
    if (!order) return [];
    return order.lines.map((line) => ({
      partnerCompanyId: line.partnerCompanyId,
      partnerDisplayName: null,
      requirementId: line.requirementLineId || line.partnerCompanyId,
      purchaseLineId: line.id,
      supplierCompanyId: order.supplierCompanyId,
      requestedQuantity: line.orderedQuantity,
      allocatedQuantity: Number(line.allocatedQuantity ?? 0),
      remainingQuantity: Number(line.availableToAllocate),
    }));
  }, [order]);

  const allocationRows = useMemo(() => {
    if (!order) return [];
    const fromOrder = order.lines.map((line) => ({
      id: allocations.find((a) => a.supplierOrderLineId === line.id)?.id,
      purchaseLineId: line.id,
      partnerCompanyId: line.partnerCompanyId,
      requirementId: line.requirementLineId,
      purchasedQuantity: Number(line.confirmedQuantity ?? line.orderedQuantity),
      allocatedQuantity: Number(line.allocatedQuantity ?? 0),
      remainingQuantity: Number(line.availableToAllocate),
      partnerRequestedQuantity: line.orderedQuantity,
      resaleLineStatus: allocations.find((a) => a.supplierOrderLineId === line.id)?.resaleOrderLineId
        ? 'LINKED'
        : 'NONE',
    }));
    return fromOrder;
  }, [order, allocations]);

  const partnerIds = useMemo(() => {
    if (!order) return [];
    return [...new Set(order.lines.map((line) => line.partnerCompanyId))];
  }, [order]);

  async function reload() {
    setError(undefined);
    try {
      const next = await api.internalSupplierOrderGet(supplierOrderId);
      setOrder(next);
      if (!resalePartnerId && next.lines[0]) setResalePartnerId(next.lines[0].partnerCompanyId);
      const qtySeed: Record<string, string> = {};
      for (const line of next.lines) {
        qtySeed[line.id] = String(line.confirmedQuantity ?? line.orderedQuantity);
      }
      setLineQty((prev) => ({ ...qtySeed, ...prev }));
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      setError(mapOpsError(failure, 'تعذر تحميل أمر المورّد.'));
    }
  }

  useEffect(() => {
    void reload();
  }, [supplierOrderId]);

  async function approve(event: FormEvent) {
    event.preventDefault();
    if (!approveAck || approveToken.trim() !== supplierOrderId) {
      setError('أكد المراجعة واكتب معرّف أمر المورّد — الاعتماد ليس نقرة واحدة.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      setOrder(await api.internalSupplierOrderApprove(supplierOrderId));
      setMessage('تم اعتماد أمر المورّد.');
      setApproveAck(false);
      setApproveToken('');
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر اعتماد أمر المورّد.'));
    } finally {
      setBusy(false);
    }
  }

  async function issue(event: FormEvent) {
    event.preventDefault();
    if (!issueAck || issueToken.trim() !== supplierOrderId) {
      setError('أكد الإصدار واكتب معرّف الأمر كاملًا.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      setOrder(await api.internalSupplierOrderIssue(supplierOrderId));
      setMessage('تم إصدار أمر المورّد.');
      setIssueAck(false);
      setIssueToken('');
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر إصدار أمر المورّد.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!order) return;
    setBusy(true);
    setError(undefined);
    try {
      const lineConfirmations = order.lines.map((line) => ({
        lineId: line.id,
        confirmedQuantity: Number(lineQty[line.id] ?? line.orderedQuantity),
      }));
      if (lineConfirmations.some((line) => !Number.isFinite(line.confirmedQuantity) || line.confirmedQuantity < 0)) {
        setError('كميات التأكيد غير صالحة.');
        setBusy(false);
        return;
      }
      setOrder(
        await api.internalSupplierOrderConfirm(supplierOrderId, {
          confirmationReference: confirmRef || undefined,
          expectedDeliveryDate: confirmDate || undefined,
          notes: confirmNotes || undefined,
          lineConfirmations,
        }),
      );
      setMessage('تم تسجيل تأكيد المورّد.');
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر تسجيل تأكيد المورّد.'));
    } finally {
      setBusy(false);
    }
  }

  async function onAllocate(input: {
    purchaseLineId: string;
    partnerCompanyId: string;
    quantity: number;
  }) {
    setError(undefined);
    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `alloc-${input.purchaseLineId}-${Date.now()}`;
      const created = await api.internalAllocationCreate({
        orderLineId: input.purchaseLineId,
        quantity: input.quantity,
        idempotencyKey,
      });
      setAllocations((prev) => {
        const others = prev.filter((row) => row.id !== created.id);
        return [...others, created];
      });
      setMessage('تم حفظ التوزيع.');
      await reload();
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر حفظ التوزيع.'));
      throw failure;
    }
  }

  if (error && !order) return <ErrorState message={error} />;
  if (!order) return <LoadingState />;

  const needsApproval = order.status === 'DRAFT';
  const canIssue = order.status === 'APPROVED';
  const canConfirm = ['ISSUED', 'PARTIALLY_CONFIRMED', 'CONFIRMED'].includes(order.status);

  return (
    <div className={styles.split}>
      <div style={{ display: 'grid', gap: '1.25rem' }}>
        <section className={styles.panel} aria-labelledby="po-title">
          <h2 id="po-title">أمر شراء المورّد</h2>
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
              <dt>المرجع</dt>
              <dd dir="ltr">{order.orderReference || order.id}</dd>
            </div>
            <div>
              <dt>الحالة</dt>
              <dd>
                <span className={styles.badge}>{purchaseStatusAr(order.status)}</span>
              </dd>
            </div>
            <div>
              <dt>المورّد</dt>
              <dd dir="ltr">{order.supplierCompanyId}</dd>
            </div>
            <div>
              <dt>تكلفة الشراء الإجمالية</dt>
              <dd dir="ltr">{moneyAr(order.purchaseTotal, order.currencyCode)}</dd>
            </div>
            <div>
              <dt>شروط الدفع</dt>
              <dd>{order.paymentTerms || 'CASH'}</dd>
            </div>
            <div>
              <dt>مرجع التأكيد</dt>
              <dd dir="ltr">{order.confirmationReference || '—'}</dd>
            </div>
            {showMargin ? (
              <div>
                <dt>هامش (إن وُجد)</dt>
                <dd dir="ltr">{moneyAr(order.grossMargin ?? null, order.currencyCode)}</dd>
              </div>
            ) : (
              <div>
                <dt>هامش</dt>
                <dd className={styles.muted}>يُحترم إذن الهامش من الخادم.</dd>
              </div>
            )}
          </dl>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">الوصف</th>
                  <th scope="col">الشريك</th>
                  <th scope="col">مطلوب</th>
                  <th scope="col">مؤكد</th>
                  <th scope="col">موزَّع</th>
                  <th scope="col">متاح للتوزيع</th>
                  <th scope="col">تكلفة الوحدة</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.description || '—'}</td>
                    <td dir="ltr">{line.partnerCompanyId.slice(0, 8)}…</td>
                    <td dir="ltr">{line.orderedQuantity}</td>
                    <td dir="ltr">{line.confirmedQuantity ?? '—'}</td>
                    <td dir="ltr">{line.allocatedQuantity ?? 0}</td>
                    <td dir="ltr">{line.availableToAllocate}</td>
                    <td dir="ltr">{moneyAr(line.purchaseUnitPrice, order.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className={styles.note}>
            المستندات:{' '}
            <Link className={styles.rowLink} href="/documents">
              مركز المستندات
            </Link>
          </p>
        </section>

        {needsApproval ? (
          <section className={styles.panel} aria-labelledby="po-approve-title">
            <h2 id="po-approve-title">اعتماد أمر المورّد</h2>
            <form className={styles.confirmBox} onSubmit={(e) => void approve(e)}>
              <ul>
                <li>المورّد: <span dir="ltr">{order.supplierCompanyId}</span></li>
                <li>المبلغ: {moneyAr(order.purchaseTotal, order.currencyCode)}</li>
                <li>شركاء الخطوط: {partnerIds.map((id) => id.slice(0, 8)).join(' · ')}</li>
              </ul>
              <label className={styles.field}>
                <input type="checkbox" checked={approveAck} onChange={(e) => setApproveAck(e.target.checked)} />{' '}
                راجعت المورّد والمبلغ والتوزيعات المتوقعة
              </label>
              <label className={styles.field}>
                اكتب معرّف الأمر للتأكيد
                <input value={approveToken} onChange={(e) => setApproveToken(e.target.value)} dir="ltr" required />
              </label>
              <button type="submit" className={styles.button} disabled={busy}>
                اعتماد
              </button>
            </form>
          </section>
        ) : null}

        {canIssue ? (
          <section className={styles.panel} aria-labelledby="po-issue-title">
            <h2 id="po-issue-title">إصدار أمر المورّد</h2>
            <form className={styles.confirmBox} onSubmit={(e) => void issue(e)}>
              <label className={styles.field}>
                <input type="checkbox" checked={issueAck} onChange={(e) => setIssueAck(e.target.checked)} /> جاهز
                للإصدار
              </label>
              <label className={styles.field}>
                اكتب معرّف الأمر للتأكيد
                <input value={issueToken} onChange={(e) => setIssueToken(e.target.value)} dir="ltr" required />
              </label>
              <button type="submit" className={styles.button} disabled={busy}>
                إصدار أمر الشراء
              </button>
            </form>
          </section>
        ) : null}

        {canConfirm ? (
          <section className={styles.panel} aria-labelledby="po-confirm-title">
            <h2 id="po-confirm-title">تأكيد المورّد</h2>
            <form className={styles.confirmBox} onSubmit={(e) => void confirm(e)}>
              <label className={styles.field}>
                مرجع التأكيد
                <input value={confirmRef} onChange={(e) => setConfirmRef(e.target.value)} dir="ltr" />
              </label>
              <label className={styles.field}>
                تاريخ التسليم المتوقع
                <input type="date" value={confirmDate} onChange={(e) => setConfirmDate(e.target.value)} dir="ltr" />
              </label>
              <label className={styles.field}>
                ملاحظات / مستند
                <textarea value={confirmNotes} onChange={(e) => setConfirmNotes(e.target.value)} />
              </label>
              {order.lines.map((line) => (
                <label key={line.id} className={styles.field}>
                  كمية مؤكدة — {line.description || line.id.slice(0, 8)}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    dir="ltr"
                    value={lineQty[line.id] ?? ''}
                    onChange={(e) => setLineQty((prev) => ({ ...prev, [line.id]: e.target.value }))}
                  />
                </label>
              ))}
              <button type="submit" className={styles.button} disabled={busy}>
                تسجيل تأكيد المورّد
              </button>
            </form>
          </section>
        ) : null}

        <ConsolidationPanel rows={consolidationRows} />

        <AllocationPanel
          rows={allocationRows}
          disabled={busy || !canConfirm}
          onAllocate={onAllocate}
        />

        <section className={styles.panel} aria-labelledby="resale-section-title">
          <h2 id="resale-section-title">إعادة البيع — أمر لكل شريك</h2>
          <label className={styles.field}>
            الشريك
            <select value={resalePartnerId} onChange={(e) => setResalePartnerId(e.target.value)}>
              <option value="">—</option>
              {partnerIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          {resalePartnerId ? (
            <ResaleOps
              partnerCompanyId={resalePartnerId}
              supplierOrderId={supplierOrderId}
              allocations={allocations.filter((row) => row.partnerCompanyId === resalePartnerId)}
            />
          ) : (
            <EmptyState message="اختر شريكًا واحدًا — لا يُدمج شركاء في أمر إعادة بيع واحد." />
          )}
        </section>

        <section className={styles.panel} aria-labelledby="safe-actions-title">
          <h2 id="safe-actions-title">إلغاء / مراجعة</h2>
          <p className={styles.muted}>
            لا يوجد زر حذف. إن دعم الخادم الإلغاء/المراجعة لاحقًا تُعرض هنا بتحذير. الحالة الحالية:{' '}
            {purchaseStatusAr(order.status)}.
          </p>
          <label className={styles.field}>
            ملاحظة تشغيلية (لا تُرسل كحذف)
            <textarea value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} />
          </label>
          <p className={styles.note}>الإلغاء/المراجعة: في انتظار عقد خادم موقّع — لا مسار حذف.</p>
        </section>
      </div>

      <FulfillmentReadinessPanel
        readiness={{
          ready: false,
          reasons: [],
          source: 'BACKEND',
          supplierOrderId,
        }}
      />
      <p className={styles.note} style={{ marginTop: '-0.5rem' }}>
        جاهزية التنفيذ النهائية تُقرأ من حقل <span dir="ltr">fulfillmentReady</span> في أمر إعادة البيع بعد إنشائه
        وتأكيده — لا تُحسب قواعد منافسة هنا.
      </p>
    </div>
  );
}
