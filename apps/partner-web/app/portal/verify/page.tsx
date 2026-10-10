'use client';

import { type PartnerDocumentUploadResult } from '@sco/contracts';
import { useState } from 'react';
import { PortalPage } from '../../../components/portal/portal-page';
import { DocumentsPanel } from '../../../components/readiness/documents-panel';
import { VerifyPanel } from '../../../components/readiness/verify-panel';

export default function PortalVerifyPage() {
  const [uploads, setUploads] = useState<PartnerDocumentUploadResult[]>([]);

  return (
    <PortalPage title="تأكّد" lead="توثيق عرض السعر فقط — المسودة والإرفاق والإرسال ونتيجة الخادم.">
      {({ companyId }) => (
        <>
          <DocumentsPanel
            companyId={companyId}
            sessionDocuments={uploads}
            onUploaded={(doc) => setUploads((current) => [doc, ...current])}
          />
          <VerifyPanel companyId={companyId} uploadedDocuments={uploads} />
        </>
      )}
    </PortalPage>
  );
}
