import { Suspense } from 'react';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { IntelligenceDemand } from '../../../components/ops/intelligence-demand';
import { LoadingState } from '../../../components/product-state';

export default function IntelligenceDemandPage() {
  return (
    <OpsChrome title="إشارات الطلب" lead="طلب ملاحظ — ليس تنبؤًا. وحدات منفصلة عند الاختلاط.">
      <Suspense fallback={<LoadingState />}>
        <IntelligenceDemand />
      </Suspense>
    </OpsChrome>
  );
}
