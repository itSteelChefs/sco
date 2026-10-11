import { Suspense } from 'react';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { IntelligenceBenchmark } from '../../../components/ops/intelligence-benchmark';
import { LoadingState } from '../../../components/product-state';

export default function IntelligenceBenchmarkPage() {
  return (
    <OpsChrome title="مقارنة السعر" lead="لغة محايدة · أدلة · بلا أوامر شراء تلقائية.">
      <Suspense fallback={<LoadingState />}>
        <IntelligenceBenchmark />
      </Suspense>
    </OpsChrome>
  );
}
