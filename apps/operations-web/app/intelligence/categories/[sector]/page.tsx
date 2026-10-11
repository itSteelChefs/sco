import { OpsChrome } from '../../../../components/ops/ops-chrome';
import { IntelligenceCategoryDetail } from '../../../../components/ops/intelligence-categories';

type Props = { params: Promise<{ sector: string }> };

export default async function IntelligenceCategoryDetailPage({ params }: Props) {
  const { sector } = await params;
  return (
    <OpsChrome title="ذكاء الفئة" lead="تغطية وأدلة حسب القطاع.">
      <IntelligenceCategoryDetail sector={decodeURIComponent(sector)} />
    </OpsChrome>
  );
}
