'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiClientError,
  type InternalPartnerAllocation,
  type InternalResaleOrder,
} from '@sco/contracts';
import { api } from '../../lib/api';
import { formatWhen, moneyAr, resaleStatusAr } from '../../lib/labels';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { FulfillmentReadinessPanel } from './fulfillment-readiness';
import { mapOpsError } from './safe-error';
import styles from './ops.module.css';

type Props = {
  resaleOrderId?: string;
  partnerCompanyId?: string;
  supplierOrderId?: string;
  allocations?: InternalPartnerAllocation[];
};

export function ResaleOps({ resaleOrderId, partnerCompanyId, allocations = [] }: Props) {
  const router = useRouter();
  const [order, setOrder] = useState<InternalResaleOrder>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmToken, setConfirmToken] = useState('');
  const [approveToken, setApproveToken] = useState('');
  const [salePrices, setSalePrices] = useState<Record<string, string>>({});

  async function load() {
    if (!resaleOrderId) return;
    setError(undefined);
    try {
      setOrder(await api.internalResaleGet(resaleOrderId));
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      setError(mapOpsError(failure, 'تعذر تحميل أمر إعادة البيع.'));
    }
  }

  useEffect(() => {
    void load();
  }, [resaleOrderId]);

  async function createResale(event: FormEvent) {
    event.preventDefault();
    if (!partnerCompanyId) {
      setError('يلزم شريك واحد — لا يُدمج شركاء في أمر إعادة بيع واحد.');
      return;
    }
    const payload = allocations
      .filter((row) => row.allocatedQuantity > 0)
      .map((row) => ({
        allocationId: row.id,
        saleUnitPrice: Number(salePrices[row.id]),
      }));
    if (payload.length === 0) {
      setError('لا توزيعات لهذا الشريك.');
      return;
    }
    if (payload.some((line) => !Number.isFinite(line.saleUnitPrice) || line.saleUnitPrice < 0)) {
      setError('سعر البيع مطلوب لكل توزيع — منفصل عن تكلفة الشراء.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `resale-${partnerCompanyId}-${Date.now()}`;
      const created = await api.internalResaleCreate({
        partnerCompanyId,
        allocations: payload,
        idempotencyKey,
        paymentTerms: 'CASH',
      });
      setMessage('تم إنشاء أمر إعادة البيع للشريك.');
      router.push(`/commercial/resale/${created.id}`);
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر إنشاء أمر إعادة البيع.'));
    } finally {
      setBusy(false);
    }
  }

  async function approveResale(event: FormEvent) {
    event.preventDefault();
    if (!resaleOrderId || !order) return;
    if (approveToken.trim() !== order.id) {
      setError('للتأكيد الآمن اكتب معرّف أمر إعادة البيع.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      setOrder(await api.internalResaleApprove(resaleOrderId));
      setMessage('تم اعتماد أمر إعادة البيع.');
      setApproveToken('');
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر اعتماد أمر إعادة البيع.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmResale(event: FormEvent) {
    event.preventDefault();
    if (!resaleOrderId || !order) return;
    if (confirmToken.trim() !== order.id) {
      setError('للتأكيد الآمن اكتب معرّف أمر إعادة البيع كاملًا — لا يكفي نقرة واحدة.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      setOrder(await api.internalResaleConfirm(resaleOrderId));
      setMessage('تم تأكيد أمر إعادة البيع للشريك.');
      setConfirmToken('');
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر تأكيد أمر إعادة البيع.'));
    } finally {
      setBusy(false);
    }
  }

  if (resaleOrderId) {
    if (error && !order) return <ErrorState message={error} />;
    if (!order) return <LoadingState />;
    const showMargin = order.canViewMargin === true || order.grossMargin != null;
    const showCost = showMargin || order.purchaseCostTotal != null;
    return (
      <div className={styles.split}>
        <section className={styles.panel} aria-labelledby="resale-detail-title">
          <h2 id="resale-detail-title">أمر إعادة بيع — شريك واحد</h2>
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
              <dt>الشريك</dt>
              <dd dir="ltr">{order.partnerCompanyId}</dd>
            </div>
            <div>
              <dt>الحالة</dt>
              <dd>
                <span className={styles.badge}>{resaleStatusAr(order.status)}</span>
              </dd>
            </div>
            <div>
              <dt>إجمالي سعر البيع</dt>
              <dd dir="ltr">{moneyAr(order.saleTotal, order.currencyCode)}</dd>
            </div>
            <div>
              <dt>شروط الدفع</dt>
              <dd>{order.paymentTerms || 'CASH (نقدًا أولًا)'}</dd>
            </div>
            {showCost ? (
              <div>
                <dt>إجمالي تكلفة الشراء (داخلي)</dt>
                <dd dir="ltr">{moneyAr(order.purchaseCostTotal ?? null, order.currencyCode)}</dd>
              </div>
            ) : (
              <div>
                <dt>تكلفة الشراء</dt>
                <dd className={styles.muted}>غير متاحة لدورك.</dd>
              </div>
            )}
            {showMargin ? (
              <div>
                <dt>هامش إجمالي</dt>
                <dd dir="ltr">{moneyAr(order.grossMargin ?? null, order.currencyCode)}</dd>
              </div>
            ) : (
              <div>
                <dt>هامش إجمالي</dt>
                <dd className={styles.muted}>غير متاح لدورك — يُحترم إذن الخادم.</dd>
              </div>
            )}
            <div>
              <dt>آخر تأكيد</dt>
              <dd>{formatWhen(order.confirmedAt)}</dd>
            </div>
          </dl>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.muted}>أعمدة التكلفة وسعر البيع منفصلة بوضوح</caption>
              <thead>
                <tr>
                  <th scope="col">الوصف</th>
                  <th scope="col">الكمية</th>
                  <th scope="col">تكلفة الشراء (داخلي)</th>
                  <th scope="col">سعر البيع للشريك</th>
                  {showMargin ? <th scope="col">هامش السطر</th> : null}
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.description || '—'}</td>
                    <td dir="ltr">{line.quantity}</td>
                    <td dir="ltr">
                      {showCost ? moneyAr(line.purchaseUnitPrice ?? null, order.currencyCode) : '—'}
                    </td>
                    <td dir="ltr">{moneyAr(line.saleUnitPrice, order.currencyCode)}</td>
                    {showMargin ? (
                      <td dir="ltr">{moneyAr(line.lineGrossMargin ?? null, order.currencyCode)}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {order.status === 'DRAFT' ? (
            <form className={styles.confirmBox} onSubmit={(e) => void approveResale(e)}>
              <h3 className={styles.muted}>اعتماد أمر إعادة البيع</h3>
              <label className={styles.field}>
                اكتب المعرّف للتأكيد
                <input value={approveToken} onChange={(e) => setApproveToken(e.target.value)} dir="ltr" required />
              </label>
              <button type="submit" className={styles.button} disabled={busy}>
                اعتماد
              </button>
            </form>
          ) : null}

          {order.status === 'APPROVED' ? (
            <form className={styles.confirmBox} onSubmit={(e) => void confirmResale(e)}>
              <h3 className={styles.muted}>تأكيد أمر إعادة البيع</h3>
              <p className={styles.muted}>
                اكتب <span dir="ltr">{order.id}</span> للمتابعة.
              </p>
              <label className={styles.field}>
                رمز التأكيد
                <input value={confirmToken} onChange={(e) => setConfirmToken(e.target.value)} dir="ltr" required />
              </label>
              <button type="submit" className={styles.button} disabled={busy}>
                تأكيد الأمر التجاري للشريك
              </button>
            </form>
          ) : null}
        </section>

        <FulfillmentReadinessPanel
          readiness={{
            ready: order.fulfillmentReady === true,
            reasons: [],
            source: 'RESALE_ORDER',
            resaleOrderId: order.id,
            fulfillmentReady: order.fulfillmentReady,
          }}
        />
      </div>
    );
  }

  if (!partnerCompanyId) {
    return <EmptyState message="اختر شريكًا واحدًا لإنشاء أمر إعادة بيع منفصل." />;
  }

  return (
    <section className={styles.panel} aria-labelledby="resale-create-title">
      <h2 id="resale-create-title">إنشاء أمر إعادة بيع — شريك واحد</h2>
      <p className={styles.muted}>
        شريك: <strong dir="ltr">{partnerCompanyId}</strong> · لا يُدمج شركاء · نقدًا أولًا
      </p>
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
      {allocations.length === 0 ? (
        <EmptyState message="لا توزيعات محفوظة لهذا الشريك بعد — أنشئ توزيعًا أولًا." />
      ) : (
        <form onSubmit={(e) => void createResale(e)}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">التوزيع</th>
                  <th scope="col">الكمية</th>
                  <th scope="col">تكلفة الشراء (مرجع)</th>
                  <th scope="col">سعر البيع للوحدة</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((row) => (
                  <tr key={row.id}>
                    <td dir="ltr">{row.id.slice(0, 8)}…</td>
                    <td dir="ltr">{row.allocatedQuantity}</td>
                    <td dir="ltr">{moneyAr(row.purchaseUnitPrice, 'SAR')}</td>
                    <td>
                      <label className={styles.field}>
                        سعر البيع
                        <input
                          type="number"
                          min={0}
                          step="any"
                          dir="ltr"
                          disabled={busy}
                          value={salePrices[row.id] ?? ''}
                          onChange={(e) => setSalePrices((prev) => ({ ...prev, [row.id]: e.target.value }))}
                          required
                        />
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.actions}>
            <button type="submit" className={styles.button} disabled={busy}>
              {busy ? 'جارٍ الإنشاء…' : 'إنشاء أمر إعادة البيع'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
