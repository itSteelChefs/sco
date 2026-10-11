import { Suspense } from 'react';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { HOperationsHealth } from '../../../components/ops/h-operations-health';
import { LoadingState } from '../../../components/product-state';

export default function Page() {
  return (
    <OpsChrome title="صحة النظام" lead="API · DB · مهام · إشعارات · G · مستندات.">
      <Suspense fallback={<LoadingState />}>
        <HOperationsHealth />
      </Suspense>
    </OpsChrome>
  );
}
