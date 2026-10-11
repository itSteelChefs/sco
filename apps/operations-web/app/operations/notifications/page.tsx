import { Suspense } from 'react';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { HOperationsNotifications } from '../../../components/ops/h-operations-notifications';
import { LoadingState } from '../../../components/product-state';

export default function Page() {
  return (
    <OpsChrome title="الإشعارات" lead="مقروء/غير مقروء مع روابط المصدر.">
      <Suspense fallback={<LoadingState />}>
        <HOperationsNotifications />
      </Suspense>
    </OpsChrome>
  );
}
