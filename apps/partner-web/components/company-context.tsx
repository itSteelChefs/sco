'use client';

import { type ActiveCompany, ApiClientError } from '@sco/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { EmptyState, ErrorState, LoadingState } from './product-state';

export function PartnerContext() {
  const router = useRouter();
  const [companies, setCompanies] = useState<ActiveCompany[]>();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string>();
  const [allowed, setAllowed] = useState(false);

  async function load() {
    setError(undefined);
    try {
      const context = await api.context();
      setCompanies(context.companies);
      setSelected(context.companies.length === 1 ? context.companies[0].id : '');
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 401) {
        router.replace('/login');
        return;
      }
      setError('تعذر تحميل سياق الشركة.');
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!selected) return;
    setAllowed(false);
    void api.partner(selected).then(() => setAllowed(true)).catch((failure) => {
      setError(failure instanceof ApiClientError && failure.status === 403 ? 'لا تملك صلاحية الوصول إلى بوابة الشريك لهذه الشركة.' : 'تعذر التحقق من صلاحية الوصول.');
    });
  }, [selected]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!companies) return <LoadingState />;
  if (!companies.length) return <EmptyState message="لا توجد شركة نشطة متاحة لهذا الحساب." />;
  if (companies.length > 1 && !selected) return <section><h2>اختر الشركة</h2><select aria-label="الشركة" defaultValue="" onChange={(event) => setSelected(event.target.value)}><option value="" disabled>اختر الشركة النشطة</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></section>;
  if (!allowed) return <LoadingState />;
  const company = companies.find((item) => item.id === selected)!;
  return <section aria-live="polite"><h2>{company.name}</h2><p>بوابة الشريك جاهزة لرحلات المشتريات المعتمدة لاحقًا.</p></section>;
}