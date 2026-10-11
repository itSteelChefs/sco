import { Suspense } from 'react';
import { OpsChrome } from '../../components/ops/ops-chrome';
import { EngineeringQueue } from '../../components/ops/engineering-queue';
import { LoadingState } from '../../components/product-state';

export default function EngineeringPage() {
  return (
    <OpsChrome
      title="الدراسات الهندسية"
      lead="طابور داخلي: إسناد · مراجعة مستندات · جداول كميات · اعتماد · تسليم للمشتريات — بلا CAD/BIM."
    >
      <Suspense fallback={<LoadingState />}>
        <EngineeringQueue />
      </Suspense>
    </OpsChrome>
  );
}
