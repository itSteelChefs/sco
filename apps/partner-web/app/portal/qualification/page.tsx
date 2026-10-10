'use client';

import { PortalPage } from '../../../components/portal/portal-page';
import { AdmissionStatusPanel } from '../../../components/readiness/admission-status';
import { QualificationForm } from '../../../components/readiness/qualification-form';

export default function PortalQualificationPage() {
  return (
    <PortalPage title="التأهيل" lead="مسودة وإرسال التأهيل عبر واجهة سكو — الحالة من الخادم فقط.">
      {({ companyId, companyName, journey, reload }) => (
        <>
          <AdmissionStatusPanel journey={journey} membershipPresent />
          <QualificationForm companyId={companyId} companyNameHint={companyName} onChanged={reload} />
        </>
      )}
    </PortalPage>
  );
}
