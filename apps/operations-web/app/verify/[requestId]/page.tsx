'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { VerifyWorkspace } from '../../../components/ops/verify-workspace';
import { LoadingState } from '../../../components/product-state';

export default function VerifyDetailPage() {
  const params = useParams<{ requestId: string }>();
  const requestId = params?.requestId;
  return (
    <OpsChrome title="مساحة تأكّد" lead="محلل ومعتمد — صلاحيات منفصلة، أدلة خام غير معروضة افتراضيًا.">
      <Suspense fallback={<LoadingState />}>
        {requestId ? <VerifyWorkspace requestId={requestId} /> : null}
      </Suspense>
    </OpsChrome>
  );
}
