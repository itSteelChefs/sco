'use client';
import { FormEvent } from 'react';
export default function Login() {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); }
  return <main><h1>تسجيل الدخول</h1><form onSubmit={submit}><label>البريد الإلكتروني<input name="email" type="email" required /></label><label>كلمة المرور<input name="password" type="password" required /></label><button type="submit">دخول</button></form></main>;
}
