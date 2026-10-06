'use client';

import { type ActiveCompany, type PartnerJourney, type PartnerWorkspace, ApiClientError } from '@sco/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { classifyPartnerJourney, createRequestGeneration, shouldLoadWorkspace, shouldShowProvisionAction } from './partner-flow.mjs';
import { EmptyState, ErrorState, LoadingState } from './product-state';

export function PartnerContext() {
  const router = useRouter();
  const [companies, setCompanies] = useState<ActiveCompany[]>();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string>();
  const [journey, setJourney] = useState<PartnerJourney>();
  const [workspace, setWorkspace] = useState<PartnerWorkspace | null>();
  const [provisioning, setProvisioning] = useState(false);
  const [reload, setReload] = useState(0);
  const [contextReload, setContextReload] = useState(0);
  const gate = useRef(createRequestGeneration());
  const controller = useRef<AbortController | undefined>(undefined);
  const contextController = useRef<AbortController | undefined>(undefined);
  const provisioningRef = useRef(false);

  async function load() {
    contextController.current?.abort();
    contextController.current = new AbortController();
    const token = gate.current.begin('context');
    setError(undefined);
    try {
      const context = await api.context(contextController.current.signal);
      if (!gate.current.isCurrent(token)) return;
      setCompanies(context.companies);
      setSelected(context.companies.length === 1 ? context.companies[0].id : '');
    } catch (failure) {
      if (failure?.name === 'AbortError' || !gate.current.isCurrent(token)) return;
      if (failure instanceof ApiClientError && failure.status === 401) {
        resetSensitiveState();
        router.replace('/login');
        return;
      }
      setError('تعذر تحميل سياق الشركة.');
    }
  }

  useEffect(() => { void load(); }, [contextReload]);
  useEffect(() => () => {
    contextController.current?.abort();
    controller.current?.abort();
    gate.current.invalidate();
    provisioningRef.current = false;
  }, []);
  useEffect(() => {
    if (!selected) return;
    controller.current?.abort();
    controller.current = new AbortController();
    const token = gate.current.begin(selected);
    setError(undefined);
    setJourney(undefined);
    setWorkspace(undefined);
    provisioningRef.current = false;
    setProvisioning(false);
    void api.partnerJourney(selected, controller.current.signal)
      .then(async (currentJourney) => {
        if (!gate.current.isCurrent(token)) return;
        setJourney(currentJourney);
        if (!shouldLoadWorkspace(currentJourney)) return;
        const currentWorkspace = await api.partnerWorkspace(selected, controller.current?.signal);
        if (gate.current.isCurrent(token)) setWorkspace(currentWorkspace);
      })
      .catch((failure) => {
        if (failure?.name === 'AbortError' || !gate.current.isCurrent(token)) return;
        resetSensitiveState();
        if (failure instanceof ApiClientError && failure.status === 401) {
          router.replace('/login');
        } else {
          setError(failure instanceof ApiClientError && failure.status === 403
            ? 'لا تملك صلاحية الوصول لهذه الشركة.'
            : 'تعذر تحميل حالة الشراكة.');
        }
      });
    return () => controller.current?.abort();
  }, [selected, reload]);

  async function provisionWorkspace() {
    if (!selected || !journey || !shouldShowProvisionAction(journey, workspace ?? null) || provisioning || provisioningRef.current) return;
    controller.current?.abort();
    controller.current = new AbortController();
    const token = gate.current.begin(selected);
    provisioningRef.current = true;
    setProvisioning(true);
    setError(undefined);
    try {
      const created = await api.createPartnerWorkspace(selected, controller.current.signal);
      if (gate.current.isCurrent(token)) setWorkspace(created);
    } catch (failure) {
      if (failure?.name !== 'AbortError' && gate.current.isCurrent(token)) {
        setWorkspace(undefined);
        if (failure instanceof ApiClientError && failure.status === 401) {
          resetSensitiveState();
          router.replace('/login');
        } else {
          resetSensitiveState();
          setError(failure instanceof ApiClientError && failure.status === 403 ? 'لا تملك صلاحية إنشاء مساحة العمل.' : 'تعذر إنشاء مساحة العمل.');
        }
      }
    } finally {
      if (gate.current.isCurrent(token)) {
        provisioningRef.current = false;
        setProvisioning(false);
      }
    }
  }

  function resetSensitiveState() {
    controller.current?.abort();
    gate.current.invalidate();
    setJourney(undefined);
    setWorkspace(undefined);
    provisioningRef.current = false;
    setProvisioning(false);
  }

  if (error) return <ErrorState message={error} onRetry={() => {
    setError(undefined);
    if (!companies) setContextReload((value) => value + 1);
    else setReload((value) => value + 1);
  }} />;
  if (!companies) return <LoadingState />;
  if (!companies.length) return <EmptyState message="لا توجد شركة نشطة متاحة لهذا الحساب." />;
  if (companies.length > 1 && !selected) return <section><h2>اختر الشركة</h2><select aria-label="الشركة" defaultValue="" onChange={(event) => setSelected(event.target.value)}><option value="" disabled>اختر الشركة النشطة</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></section>;
  const company = companies.find((item) => item.id === selected)!;
  const companySelector = companies.length > 1 && <label>الشركة<select aria-label="الشركة" value={selected} onChange={(event) => setSelected(event.target.value)}>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
  if (!journey) return <section>{companySelector}<LoadingState /></section>;
  const flow = classifyPartnerJourney(journey, workspace);
  const shell = journey.experiences.find((experience) => experience.code === 'PARTNER_SHELL');
  const nextAction = journey.nextAction;
  return <section aria-live="polite">
    {companySelector}
    <h2>{company.name}</h2>
    <p>حالة الشراكة: {journey.relationship?.stage ?? 'غير متاحة'}</p>
    {nextAction && nextAction.code !== 'NONE' && <p>الإجراء التالي: {nextAction.code === 'ACCEPT_AGREEMENTS' ? 'مراجعة الاتفاقيات المطلوبة' : nextAction.code === 'CONTACT_SCO' ? 'التواصل مع فريق SCO' : 'بانتظار مراجعة SCO'}</p>}
    {journey.operational.procurementAccess === 'RESTRICTED' && <p>الوصول التشغيلي مقيّد حاليًا. لا يؤثر ذلك على مساحة العمل الأساسية.</p>}
    {!shell?.enterable && <p role="alert">مساحة العمل الأساسية غير متاحة لهذا الحساب حاليًا.</p>}
    {flow.kind === 'JOURNEY_BLOCKED' && <p role="alert">لا يمكن الدخول إلى مساحة العمل بهذه الشركة.</p>}
    {flow.kind !== 'JOURNEY_BLOCKED' && <>
      <h3>مساحة عمل الشريك</h3>
      {flow.kind === 'WORKSPACE_LOADING' ? <LoadingState /> : workspace === null ? <>
        <EmptyState message="لم تُنشأ مساحة عمل خاصة بهذه الشركة بعد." />
        <button type="button" onClick={() => void provisionWorkspace()} disabled={provisioning}>{provisioning ? 'جارٍ إنشاء مساحة العمل...' : 'إنشاء مساحة العمل'}</button>
      </> : <><p>{workspace.displayName}</p><p>{workspace.capabilities.length ? `الخدمات المتاحة: ${workspace.capabilities.join('، ')}` : 'لا توجد خدمات مفعلة حاليًا لهذه المساحة.'}</p></>}
    </>}
  </section>;
}
