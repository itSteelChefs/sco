'use client';

import { Suspense } from 'react';
import { OpsChrome } from '../../components/ops/ops-chrome';
import { QualificationQueue } from '../../components/ops/qualification-queue';
import { LoadingState } from '../../components/product-state';

export default function QualificationsPage() {
  return (
    <OpsChrome title="مراجعة التأهيل" lead="طابور تشغيلي لطلبات تأهيل الشركاء.">
      <Suspense fallback={<LoadingState />}>
        <QualificationQueue />
      </Suspense>
    </OpsChrome>
  );
}
