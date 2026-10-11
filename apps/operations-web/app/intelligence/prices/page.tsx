import { Suspense } from 'react';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { IntelligencePrices } from '../../../components/ops/intelligence-prices';
import { LoadingState } from '../../../components/product-state';

export default function IntelligencePricesPage() {
  return (
    <OpsChrome title="سجل الأسعار" lead="عروض · مختارة · شراء مؤكد — سلاسل منفصلة مع أدلة.">
      <Suspense fallback={<LoadingState />}>
        <IntelligencePrices />
      </Suspense>
    </OpsChrome>
  );
}
