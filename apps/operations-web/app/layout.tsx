import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'سكو | عمليات داخلية',
  description: 'وحدة تشغيل SCO الداخلية للتأهيل والاتفاقيات والمستندات وتأكّد والعمليات التجارية.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
