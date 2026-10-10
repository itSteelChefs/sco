'use client';

import { PortalPage } from '../../../components/portal/portal-page';
import { AgreementsPanel } from '../../../components/readiness/agreements-panel';

export default function PortalAgreementsPage() {
  return (
    <PortalPage title="الاتفاقيات" lead="حزمة الإطلاق: السرية الملزمة وشروط الشراكة. القبول عبر الخادم فقط.">
      {({ companyId, agreements, reload }) => (
        <AgreementsPanel companyId={companyId} agreements={agreements} onAccepted={reload} />
      )}
    </PortalPage>
  );
}
