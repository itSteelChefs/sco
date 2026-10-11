import { Suspense } from 'react';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { IntelligenceEvidence } from '../../../components/ops/intelligence-evidence';
import { LoadingState } from '../../../components/product-state';

export default function IntelligenceEvidencePage() {
  return (
    <OpsChrome title="الأدلة" lead="تفصيل سجلات الحقائق مع ترقيم الصفحات.">
      <Suspense fallback={<LoadingState />}>
        <IntelligenceEvidence />
      </Suspense>
    </OpsChrome>
  );
}
