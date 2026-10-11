import { OpsChrome } from '../../../components/ops/ops-chrome';
import { EngineeringWorkspace } from '../../../components/ops/engineering-workspace';

type Props = { params: Promise<{ id: string }> };

export default async function EngineeringDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <OpsChrome
      title="مساحة العمل الهندسية"
      lead="تفاصيل الطلب · إسناد · مستندات · BOQ · مراجعة/اعتماد · معاينة الشريك · تسليم D."
    >
      <EngineeringWorkspace requestId={id} />
    </OpsChrome>
  );
}
