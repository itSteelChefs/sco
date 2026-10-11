'use client';

import { OpsChrome } from '../../components/ops/ops-chrome';
import { OperationsDashboard } from '../../components/operations-dashboard';

/** Legacy companies context retained; A+B+C ops live under dedicated routes. */
export default function CompaniesPage() {
  return (
    <OpsChrome title="سياق الشركات" lead="سياق هوية داخلي مساعد — التشغيل اليومي عبر طوابير التأهيل/الاتفاقيات/تأكّد.">
      <OperationsDashboard />
    </OpsChrome>
  );
}
