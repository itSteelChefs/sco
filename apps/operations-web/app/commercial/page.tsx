import { Suspense } from 'react';
import { OpsChrome } from '../../components/ops/ops-chrome';
import { PurchaseQueue } from '../../components/ops/purchase-queue';
import { LoadingState } from '../../components/product-state';

export default function CommercialPage() {
  return (
    <OpsChrome
      title="العمليات التجارية"
      lead="شراء · تجميع · أمر مورّد · توزيع · إعادة بيع · جاهزية التنفيذ — للعاملين الداخليين المصرّح لهم فقط."
    >
      <Suspense fallback={<LoadingState />}>
        <PurchaseQueue />
      </Suspense>
    </OpsChrome>
  );
}
