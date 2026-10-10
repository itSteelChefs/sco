import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from 'next/font/google';
import './globals.css';

/**
 * WHY root layout touch:
 * - Document metadata for public reception SEO/title
 * - Load Arabic-capable fonts already available via Next (no package.json change)
 * - Preserve Arabic-first lang/dir established at baseline
 */
const scoArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sco-arabic',
  display: 'swap',
});

const scoLatin = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sco-latin',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'سكو | SCO',
    template: '%s | سكو',
  },
  description:
    'سكو — منصة أعمال للمشتريات والهندسة عبر التكييف والكهرباء والسباكة. الطرف التجاري هو سكو.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${scoArabic.variable} ${scoLatin.variable}`}>
      <body>{children}</body>
    </html>
  );
}
