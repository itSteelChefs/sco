import { OpsChrome } from '../../../../components/ops/ops-chrome';
import { PurchaseWorkspace } from '../../../../components/ops/purchase-workspace';

type Props = { params: Promise<{ id: string }> };

export default async function PurchaseDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <OpsChrome
      title="نية الشراء التجاري"
      lead="من اختيار D → اعتماد النية → تجميع في أمر مورّد."
    >
      <PurchaseWorkspace purchaseIntentId={id} />
    </OpsChrome>
  );
}
