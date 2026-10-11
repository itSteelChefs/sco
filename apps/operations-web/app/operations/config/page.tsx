import { Suspense } from 'react';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { HOperationsConfig } from '../../../components/ops/h-operations-config';
import { LoadingState } from '../../../components/product-state';

export default function Page() {
  return (
    <OpsChrome title="الإعدادات التشغيلية" lead="مفاتيح معتمدة فقط.">
      <Suspense fallback={<LoadingState />}>
        <HOperationsConfig />
      </Suspense>
    </OpsChrome>
  );
}
