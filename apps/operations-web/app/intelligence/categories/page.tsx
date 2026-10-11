import { Suspense } from 'react';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { IntelligenceCategories } from '../../../components/ops/intelligence-categories';
import { LoadingState } from '../../../components/product-state';

export default function IntelligenceCategoriesPage() {
  return (
    <OpsChrome title="الفئات" lead="نشاط · تغطية · إشارات طلب حسب القطاع.">
      <Suspense fallback={<LoadingState />}>
        <IntelligenceCategories />
      </Suspense>
    </OpsChrome>
  );
}
