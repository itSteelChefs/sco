'use client';
import { useRouter } from 'next/navigation';
import { OperationsDashboard } from '../components/operations-dashboard';
import { api } from '../lib/api';
export default function Home() { const router = useRouter(); async function logout() { await api.logout().catch(() => undefined); router.replace('/login'); } return <main><header><h1>SCO Internal Operations</h1><button type="button" onClick={() => void logout()}>تسجيل الخروج</button></header><nav><a href="/companies">الشركات</a><a href="/memberships">العضويات</a><a href="/roles">الأدوار والصلاحيات</a></nav><OperationsDashboard /></main>; }
