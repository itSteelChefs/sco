import { Suspense } from 'react';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { IntelligenceSuppliers } from '../../../components/ops/intelligence-suppliers';
import { LoadingState } from '../../../components/product-state';

export default function IntelligenceSuppliersPage() {
  return (
    <OpsChrome title="أداء الموردين" lead="مقاييس تأكيد وتعديل وإلغاء — بلا نجوم.">
      <Suspense fallback={<LoadingState />}>
        <IntelligenceSuppliers />
      </Suspense>
    </OpsChrome>
  );
}
