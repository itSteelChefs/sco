import { Suspense } from 'react';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { HOperationsCycles } from '../../../components/ops/h-operations-cycles';
import { LoadingState } from '../../../components/product-state';

export default function Page() {
  return (
    <OpsChrome title="الدورات الأسبوعية" lead="جمع أحد–خميس · قفل خميس · توريد سبت.">
      <Suspense fallback={<LoadingState />}>
        <HOperationsCycles />
      </Suspense>
    </OpsChrome>
  );
}
