'use client';
import { useRouter } from 'next/navigation';
import { PartnerContext } from '../components/company-context';
import { api } from '../lib/api';

export default function PartnerHome() {
  const router = useRouter();
  async function logout() { await api.logout().catch(() => undefined); router.replace('/login'); }
  return <main><header><h1>SCO Partner Portal</h1><button type="button" onClick={() => void logout()}>تسجيل الخروج</button></header><PartnerContext /></main>;
}
