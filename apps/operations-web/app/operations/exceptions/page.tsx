import { Suspense } from 'react';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { HOperationsExceptions } from '../../../components/ops/h-operations-exceptions';
import { LoadingState } from '../../../components/product-state';

export default function Page() {
  return (
    <OpsChrome title="الحالات المتعثرة" lead="إقرار · إعادة محاولة · حل مع ملاحظة — بلا تتبع خام.">
      <Suspense fallback={<LoadingState />}>
        <HOperationsExceptions />
      </Suspense>
    </OpsChrome>
  );
}
