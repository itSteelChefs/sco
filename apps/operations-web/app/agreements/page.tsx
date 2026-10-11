'use client';

import { OpsChrome } from '../../components/ops/ops-chrome';
import { AgreementsOps } from '../../components/ops/agreements-ops';

export default function AgreementsPage() {
  return (
    <OpsChrome
      title="عمليات الاتفاقيات"
      lead="جاهزية الشراكة وحالة استيفاء اتفاقيات الإطلاق — دون تأليف نص قانوني."
    >
      <AgreementsOps />
    </OpsChrome>
  );
}
