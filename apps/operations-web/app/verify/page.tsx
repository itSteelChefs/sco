'use client';

import { Suspense } from 'react';
import { OpsChrome } from '../../components/ops/ops-chrome';
import { VerifyQueue } from '../../components/ops/verify-queue';
import { LoadingState } from '../../components/product-state';

export default function VerifyPage() {
  return (
    <OpsChrome title="طابور تأكّد" lead="مسارات التحليل والاعتماد الداخلية لطلبات Quote Check.">
      <Suspense fallback={<LoadingState />}>
        <VerifyQueue />
      </Suspense>
    </OpsChrome>
  );
}
