import { Suspense } from 'react';
import { OpsChrome } from '../../components/ops/ops-chrome';
import { IntelligenceOverview } from '../../components/ops/intelligence-overview';
import { LoadingState } from '../../components/product-state';

export default function IntelligencePage() {
  return (
    <OpsChrome
      title="ذكاء المشتريات"
      lead="أدلة أسعار · مقارنة · موردون · فئات · إشارات طلب — بلا تنبؤ أو شراء تلقائي."
    >
      <Suspense fallback={<LoadingState />}>
        <IntelligenceOverview />
      </Suspense>
    </OpsChrome>
  );
}
