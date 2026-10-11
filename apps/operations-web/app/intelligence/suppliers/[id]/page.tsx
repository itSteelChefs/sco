import { OpsChrome } from '../../../../components/ops/ops-chrome';
import { IntelligenceSupplierDetail } from '../../../../components/ops/intelligence-suppliers';

type Props = { params: Promise<{ id: string }> };

export default async function IntelligenceSupplierDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <OpsChrome title="تفاصيل المورّد" lead="نشاط · فئات · تأكيد · إلغاء — داخلي مصرّح فقط.">
      <IntelligenceSupplierDetail supplierCompanyId={id} />
    </OpsChrome>
  );
}
