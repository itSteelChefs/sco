import { Suspense } from 'react';
import { OpsChrome } from '../../components/ops/ops-chrome';
import { HOperationsQueue } from '../../components/ops/h-operations-queue';
import { LoadingState } from '../../components/product-state';

export default function OperationsCenterPage() {
  return (
    <OpsChrome title="العمليات" lead="مركز تنسيق تشغيلي — بلا إعادة بناء A–G وبلا لوحة BI.">
      <Suspense fallback={<LoadingState />}>
        <HOperationsQueue
          title="مركز العمليات"
          defaultView="all"
          lead="إجراء مطلوب · مصدر · مرجع · إسناد · أولوية · عمر · حالة · إجراء تالٍ — بلا مقاييس ملفّقة."
        />
      </Suspense>
    </OpsChrome>
  );
}
