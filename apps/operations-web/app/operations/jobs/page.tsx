import { Suspense } from 'react';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { HOperationsJobs } from '../../../components/ops/h-operations-jobs';
import { LoadingState } from '../../../components/product-state';

export default function Page() {
  return (
    <OpsChrome title="المهام الخلفية" lead="طلب وتشغيل يدوي مصرّح.">
      <Suspense fallback={<LoadingState />}>
        <HOperationsJobs />
      </Suspense>
    </OpsChrome>
  );
}
