import { OpsChrome } from '../../../../components/ops/ops-chrome';
import { ResaleOps } from '../../../../components/ops/resale-ops';

type Props = { params: Promise<{ id: string }> };

export default async function ResaleDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <OpsChrome
      title="أمر إعادة البيع للشريك"
      lead="أمر تجاري واحد لكل شريك — سعر البيع منفصل عن تكلفة الشراء — الهامش حسب الصلاحية."
    >
      <ResaleOps resaleOrderId={id} />
    </OpsChrome>
  );
}
