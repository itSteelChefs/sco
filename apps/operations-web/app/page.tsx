'use client';

import { OpsChrome } from '../components/ops/ops-chrome';
import { OpsHome } from '../components/ops/ops-home';

export default function Home() {
  return (
    <OpsChrome
      title="لوحة التشغيل الداخلية"
      lead="طوابير قابلة للتنفيذ فقط — تأهيل، اتفاقيات، مستندات، وتأكّد."
    >
      <OpsHome />
    </OpsChrome>
  );
}
