'use client';

import { type ActiveCompany, ApiClientError } from '@sco/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { EmptyState, ErrorState, LoadingState } from './product-state';

export function OperationsDashboard() {
  const router = useRouter();
  const [companies, setCompanies] = useState<ActiveCompany[]>();
  const [selected, setSelected] = useState('');
  const [items, setItems] = useState<Array<{ id: string; name: string; type: string; status: string }>>();
  const [error, setError] = useState<string>();
  async function loadContext() { try { const result = await api.context(); setCompanies(result.companies); setSelected(result.companies.length === 1 ? result.companies[0].id : ''); } catch (failure) { if (failure instanceof ApiClientError && failure.status === 401) { router.replace('/login'); return; } setError('تعذر تحميل سياق العمليات.'); } }
  async function loadCompanies(companyId: string) { setItems(undefined); setError(undefined); try { setItems((await api.companies(companyId)).items); } catch (failure) { setError(failure instanceof ApiClientError && failure.status === 403 ? 'لا تملك صلاحية عرض الشركات في هذا السياق.' : 'تعذر تحميل بيانات العمليات.'); } }
  useEffect(() => { void loadContext(); }, []);
  useEffect(() => { if (selected) void loadCompanies(selected); }, [selected]);
  if (error) return <ErrorState message={error} onRetry={() => void loadContext()} />;
  if (!companies) return <LoadingState />;
  if (!companies.length) return <EmptyState message="لا توجد شركة نشطة متاحة لهذا الحساب." />;
  return <section><h2>سياق العمليات</h2>{companies.length > 1 && <select aria-label="شركة العمليات" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">اختر الشركة النشطة</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select>}{!selected || !items ? <LoadingState /> : <><h3>الشركات المتاحة</h3>{items.length ? <ul>{items.map((company) => <li key={company.id}>{company.name} - {company.type}</li>)}</ul> : <EmptyState message="لا توجد شركات ضمن هذا السياق." />}</>}</section>;
}