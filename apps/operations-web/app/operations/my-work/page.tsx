import { Suspense } from 'react';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { HOperationsQueue } from '../../../components/ops/h-operations-queue';
import { LoadingState } from '../../../components/product-state';

export default function MyWorkPage() {
  return (
    <OpsChrome title="مهامي" lead="طابور العمل المسند — فتح المصدر · بدء · إنهاء حسب قواعد الخادم.">
      <Suspense fallback={<LoadingState />}>
        <HOperationsQueue
          title="مهامي"
          defaultView="my"
          lead="تصفية وفرز وفتح سجل المصدر وإسناد وإغلاق وفق صلاحيات الخادم."
        />
      </Suspense>
    </OpsChrome>
  );
}
