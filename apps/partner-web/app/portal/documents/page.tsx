'use client';

import { PortalPage } from '../../../components/portal/portal-page';
import { DocumentsPanel } from '../../../components/readiness/documents-panel';

export default function PortalDocumentsPage() {
  return (
    <PortalPage
      title="مركز المستندات"
      lead="رفع المستندات فعّال الآن. قائمة الخادم والتنزيل ينتظران عقد Codex1."
    >
      {({ companyId }) => <DocumentsPanel companyId={companyId} />}
    </PortalPage>
  );
}
