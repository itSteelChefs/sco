import { Suspense } from 'react';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { HOperationsAudit } from '../../../components/ops/h-operations-audit';
import { LoadingState } from '../../../components/product-state';

export default function Page() {
  return (
    <OpsChrome title="أدلة التدقيق" lead="أثر تشغيلي داخلي مع فلاتر.">
      <Suspense fallback={<LoadingState />}>
        <HOperationsAudit />
      </Suspense>
    </OpsChrome>
  );
}
