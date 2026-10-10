import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Public routes reachable without sco_session (Wave 1 reception). */
const PUBLIC_PATHS = new Set(['/', '/login', '/partnership', '/verify']);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has('sco_session');

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (!hasSession) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
