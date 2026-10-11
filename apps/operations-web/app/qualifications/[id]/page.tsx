'use client';

import { useParams } from 'next/navigation';
import { OpsChrome } from '../../../components/ops/ops-chrome';
import { QualificationReview } from '../../../components/ops/qualification-review';

export default function QualificationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  return (
    <OpsChrome title="تفاصيل مراجعة التأهيل" lead="قرارات مراجعة مصرّح بها فقط — بدون افتراض سلطة الواجهة.">
      {id ? <QualificationReview qualificationId={id} /> : null}
    </OpsChrome>
  );
}
