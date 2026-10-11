'use client';

import { OpsChrome } from '../../components/ops/ops-chrome';
import { DocumentsOps } from '../../components/ops/documents-ops';

export default function DocumentsPage() {
  return (
    <OpsChrome title="مستندات الشركاء" lead="عرض وصفي داخلي مصرّح — بلا مفاتيح تخزين.">
      <DocumentsOps />
    </OpsChrome>
  );
}
