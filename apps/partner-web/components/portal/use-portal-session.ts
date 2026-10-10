'use client';

import { ApiClientError, type ActiveCompany, type PartnerAgreement, type PartnerJourney } from '@sco/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { readinessApi } from '../../lib/readiness-api';
import { readStoredCompanyId, writeStoredCompanyId } from '../../lib/partner-company';

function mapError(failure: unknown): string {
  if (failure instanceof ApiClientError) {
    if (failure.status === 401) return 'UNAUTHENTICATED';
    if (failure.status === 403) return 'لا تملك صلاحية عرض بيانات هذه الشركة.';
    if (failure.code === 'NOT_FOUND') return 'تعذر العثور على البيانات المطلوبة.';
    if (failure.code === 'VALIDATION_FAILED') return 'تعذر التحقق من الطلب.';
    if (failure.code === 'CONFLICT') return 'تعارض في الحالة. حدّث الصفحة.';
  }
  return 'تعذر تحميل بيانات البوابة. حاول مرة أخرى.';
}

export function usePortalSession() {
  const router = useRouter();
  const [companies, setCompanies] = useState<ActiveCompany[]>();
  const [selected, setSelected] = useState('');
  const [journey, setJourney] = useState<PartnerJourney>();
  const [agreements, setAgreements] = useState<PartnerAgreement[]>();
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  const controller = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const ac = new AbortController();
    void readinessApi
      .context(ac.signal)
      .then((context) => {
        setCompanies(context.companies);
        const stored = readStoredCompanyId();
        if (context.companies.length === 1) {
          setSelected(context.companies[0].id);
          writeStoredCompanyId(context.companies[0].id);
        } else if (stored && context.companies.some((item) => item.id === stored)) {
          setSelected(stored);
        }
      })
      .catch((failure) => {
        if (failure?.name === 'AbortError') return;
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        setError(mapError(failure));
      });
    return () => ac.abort();
  }, [router]);

  useEffect(() => {
    if (!selected) return;
    writeStoredCompanyId(selected);
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setError(undefined);
    setJourney(undefined);
    setAgreements(undefined);
    void Promise.all([
      readinessApi.partnerJourney(selected, ac.signal),
      readinessApi.partnerAgreements(selected, ac.signal).catch((failure) => {
        if (failure instanceof ApiClientError && failure.status === 403) return [] as PartnerAgreement[];
        throw failure;
      }),
    ])
      .then(([currentJourney, currentAgreements]) => {
        if (ac.signal.aborted) return;
        setJourney(currentJourney);
        setAgreements(currentAgreements);
      })
      .catch((failure) => {
        if (failure?.name === 'AbortError') return;
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
          return;
        }
        setError(mapError(failure));
      });
    return () => ac.abort();
  }, [selected, reload, router]);

  return {
    companies,
    selected,
    setSelected: (companyId: string) => setSelected(companyId),
    journey,
    agreements,
    error,
    reload: () => setReload((value) => value + 1),
    mapError,
  };
}
