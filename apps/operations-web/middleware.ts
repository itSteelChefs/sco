import { NextResponse } from 'next/server'; import type { NextRequest } from 'next/server';
export function middleware(request: NextRequest) { if (!request.cookies.has('sco_session') && request.nextUrl.pathname !== '/login') return NextResponse.redirect(new URL('/login', request.url)); return NextResponse.next(); }
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
