'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type InternalPurchaseIntent } from '@sco/contracts';
import { api } from '../../lib/api';
import { moneyAr, purchaseStatusAr } from '../../lib/labels';
import { EmptyState, ErrorState, LoadingState } from '../product-state';
import { IntelligenceDecisionSupportPanel } from './intelligence-decision-support';
import { mapOpsError } from './safe-error';
import styles from './ops.module.css';

type Props = { purchaseIntentId: string };

/** Purchase intent workspace — Cursor3 commercial purchase intent. */
export function PurchaseWorkspace({ purchaseIntentId }: Props) {
  const router = useRouter();
  const [intent, setIntent] = useState<InternalPurchaseIntent>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [approveAck, setApproveAck] = useState(false);
  const [approveToken, setApproveToken] = useState('');
  const [extraIntentIds, setExtraIntentIds] = useState('');
  const [commercialTerms, setCommercialTerms] = useState('');

  const showMargin = intent?.canViewMargin === true || intent?.grossMargin != null;

  async function reload() {
    setError(undefined);
    try {
      setIntent(await api.internalPurchaseGet(purchaseIntentId));
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      setError(mapOpsError(failure, 'تعذر تحميل نية الشراء.'));
    }
  }

  useEffect(() => {
    void reload();
  }, [purchaseIntentId]);

  async function approve(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setMessage(undefined);
    if (!approveAck) {
      setError('أكد مراجعة المورّد والمبلغ وطلب الشريك قبل الاعتماد.');
      return;
    }
    if (approveToken.trim() !== purchaseIntentId) {
      setError('للتأكيد الآمن اكتب معرّف نية الشراء كاملًا — الاعتماد ليس نقرة واحدة.');
      return;
    }
    setBusy(true);
    try {
      const updated = await api.internalPurchaseApprove(purchaseIntentId);
      setIntent(updated);
      setMessage('تم الاعتماد التجاري لنية الشراء.');
      setApproveAck(false);
      setApproveToken('');
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر الاعتماد التجاري.'));
    } finally {
      setBusy(false);
    }
  }

  async function createSupplierOrder(event: FormEvent) {
    event.preventDefault();
    if (!intent) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const extras = extraIntentIds
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      const intentIds = [intent.id, ...extras];
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `po-${intent.id}-${Date.now()}`;
      const order = await api.internalSupplierOrderCreate({
        intentIds,
        idempotencyKey,
        commercialTerms: commercialTerms || undefined,
      });
      setMessage('تم إنشاء أمر المورّد (تجميع النوايا المتوافقة فقط).');
      router.push(`/commercial/supplier-orders/${order.id}`);
    } catch (failure) {
      setError(mapOpsError(failure, 'تعذر إنشاء أمر المورّد — تحقق من توافق المورّد وعدم الدمج العابر.'));
    } finally {
      setBusy(false);
    }
  }

  if (error && !intent) return <ErrorState message={error} />;
  if (!intent) return <LoadingState />;

  const needsApproval = intent.status === 'DRAFT' || intent.status === 'PENDING_APPROVAL';
  const canBuildPo = intent.status === 'APPROVED' || intent.status === 'CONVERTED';

  return (
    <div className={styles.split}>
      <section className={styles.panel} aria-labelledby="intent-title">
        <h2 id="intent-title">تحضير الشراء — نية شراء</h2>
        <p className={styles.muted}>مصدر D · العرض · المورّد · الخطوط · تكلفة الشراء · الشروط · طلب الشريك</p>
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
            <dt>الحالة</dt>
            <dd>
              <span className={styles.badge}>{purchaseStatusAr(intent.status)}</span>
            </dd>
          </div>
          <div>
            <dt>المورّد</dt>
            <dd dir="ltr">{intent.supplierCompanyId}</dd>
          </div>
          <div>
            <dt>اسم مستعار للشريك</dt>
            <dd>{intent.aliasLabel || '—'}</dd>
          </div>
          <div>
            <dt>عرض المصدر</dt>
            <dd dir="ltr">{intent.quoteId}</dd>
          </div>
          <div>
            <dt>مرشّح الاختيار</dt>
            <dd dir="ltr">{intent.selectionCandidateId}</dd>
          </div>
          <div>
            <dt>المتطلب / الشريك</dt>
            <dd>
              <span dir="ltr">{intent.requirementId}</span>
              <div className={styles.muted} dir="ltr">
                {intent.partnerCompanyId}
              </div>
            </dd>
          </div>
          <div>
            <dt>إجمالي تكلفة الشراء</dt>
            <dd dir="ltr">{moneyAr(intent.purchaseTotal, intent.currencyCode)}</dd>
          </div>
          <div>
            <dt>شروط الدفع</dt>
            <dd>{intent.paymentTerms || 'CASH (نقدًا أولًا — لا اعتماد ائتماني وهمي)'}</dd>
          </div>
          {showMargin ? (
            <div>
              <dt>هامش إجمالي (دور مصرّح)</dt>
              <dd dir="ltr">{moneyAr(intent.grossMargin ?? null, intent.currencyCode)}</dd>
            </div>
          ) : (
            <div>
              <dt>هامش إجمالي</dt>
              <dd className={styles.muted}>مخفي ما لم يُرجع الخادم الحقل — يُحترم إذن الهامش.</dd>
            </div>
          )}
        </dl>

        <h3 className={styles.muted}>خطوط الشراء — تكلفة الشراء فقط</h3>
        {intent.lines.length === 0 ? (
          <EmptyState message="لا خطوط." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">الوصف</th>
                  <th scope="col">الكمية</th>
                  <th scope="col">تكلفة الوحدة</th>
                  <th scope="col">تكلفة السطر</th>
                </tr>
              </thead>
              <tbody>
                {intent.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.description || '—'}</td>
                    <td dir="ltr">{line.quantity}</td>
                    <td dir="ltr">{moneyAr(line.purchaseUnitPrice, intent.currencyCode)}</td>
                    <td dir="ltr">{moneyAr(line.lineAmount, intent.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className={styles.note}>
          المستندات التجارية عبر{' '}
          <Link className={styles.rowLink} href="/documents">
            مركز المستندات
          </Link>{' '}
          — أمر مورّد · تأكيد · أمر شريك.
        </p>
      </section>

      <div style={{ display: 'grid', gap: '1.25rem' }}>
        {intent.lines.find((line) => line.quoteLineId)?.quoteLineId ? (
          <IntelligenceDecisionSupportPanel
            quoteLineId={intent.lines.find((line) => line.quoteLineId)!.quoteLineId!}
          />
        ) : null}
        {needsApproval ? (
          <section className={styles.panel} aria-labelledby="approve-title">
            <h2 id="approve-title">الاعتماد التجاري</h2>
            <form className={styles.confirmBox} onSubmit={(e) => void approve(e)}>
              <ul>
                <li>المورّد: <span dir="ltr">{intent.supplierCompanyId}</span></li>
                <li>المبلغ: {moneyAr(intent.purchaseTotal, intent.currencyCode)}</li>
                <li>الشريك: <span dir="ltr">{intent.partnerCompanyId}</span></li>
                <li>
                  الهامش:{' '}
                  {showMargin ? moneyAr(intent.grossMargin ?? null, intent.currencyCode) : 'غير متاح لدورك'}
                </li>
                <li>الشروط: {intent.paymentTerms || 'CASH'}</li>
              </ul>
              <label className={styles.field}>
                <input
                  type="checkbox"
                  checked={approveAck}
                  onChange={(e) => setApproveAck(e.target.checked)}
                  disabled={busy}
                />{' '}
                راجعت المورّد والمبلغ وطلب الشريك والشروط
              </label>
              <label className={styles.field}>
                اكتب معرّف نية الشراء للتأكيد
                <input
                  value={approveToken}
                  onChange={(e) => setApproveToken(e.target.value)}
                  dir="ltr"
                  disabled={busy}
                  required
                  autoComplete="off"
                />
              </label>
              <button type="submit" className={styles.button} disabled={busy}>
                اعتماد نية الشراء
              </button>
            </form>
          </section>
        ) : null}

        <section className={styles.panel} aria-labelledby="consolidate-title">
          <h2 id="consolidate-title">تجميع → أمر مورّد</h2>
          <p className={styles.muted}>
            دمج نوايا متوافقة لنفس المورّد فقط. الدمج عبر مورّدين مرفوض من الخادم.
          </p>
          <form className={styles.confirmBox} onSubmit={(e) => void createSupplierOrder(e)}>
            <label className={styles.field}>
              نوايا إضافية للتجميع (اختياري — UUID مفصولة)
              <textarea
                value={extraIntentIds}
                onChange={(e) => setExtraIntentIds(e.target.value)}
                dir="ltr"
                disabled={busy || !canBuildPo}
                placeholder="intent-uuid-2, intent-uuid-3"
              />
            </label>
            <label className={styles.field}>
              شروط تجارية
              <textarea
                value={commercialTerms}
                onChange={(e) => setCommercialTerms(e.target.value)}
                disabled={busy || !canBuildPo}
              />
            </label>
            <button type="submit" className={styles.button} disabled={busy || !canBuildPo}>
              إنشاء أمر المورّد من هذه النية
            </button>
            {!canBuildPo ? (
              <p className={styles.muted}>يلزم اعتماد النية قبل إنشاء أمر المورّد.</p>
            ) : null}
          </form>
        </section>
      </div>
    </div>
  );
}
