import { OpsChrome } from '../../../../components/ops/ops-chrome';
import { SupplierOrderWorkspace } from '../../../../components/ops/supplier-order-workspace';

type Props = { params: Promise<{ id: string }> };

export default async function SupplierOrderPage({ params }: Props) {
  const { id } = await params;
  return (
    <OpsChrome
      title="أمر شراء المورّد"
      lead="اعتماد · إصدار · تأكيد مورّد · تجميع ظاهر · توزيع · إعادة بيع."
    >
      <SupplierOrderWorkspace supplierOrderId={id} />
    </OpsChrome>
  );
}
