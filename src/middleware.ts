import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Edge middleware: route protection and security headers.
 *
 * The signature check here is a fast gate — it keeps unauthenticated traffic
 * away from application pages. The authoritative check (session row still
 * exists, user still active) happens server-side in `getCurrentUser`.
 */

const SESSION_COOKIE = 'murgay_session';
const PUBLIC_PATHS = ['/login'];

function securityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // Next.js injects inline bootstrap scripts and style tags.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  );

  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let authenticated = false;

  if (token && process.env.AUTH_SECRET) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET), {
        issuer: 'murgay-lead-intelligence',
      });
      authenticated = true;
    } catch {
      authenticated = false;
    }
  }

  if (!authenticated && !isPublic) {
    // API clients get a JSON 401; only page requests are redirected to the
    // login screen. Returning an HTML login page to a fetch() is never useful.
    if (pathname.startsWith('/api/')) {
      const response = NextResponse.json(
        { ok: false, error: 'Authentication required.', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
      if (token) response.cookies.delete(SESSION_COOKIE);
      return securityHeaders(response);
    }

    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') loginUrl.searchParams.set('next', pathname);
    const response = NextResponse.redirect(loginUrl);
    if (token) response.cookies.delete(SESSION_COOKIE);
    return securityHeaders(response);
  }

  if (authenticated && isPublic) {
    return securityHeaders(NextResponse.redirect(new URL('/dashboard', request.url)));
  }

  return securityHeaders(NextResponse.next());
}

export const config = {
  matcher: ['/((?!api/health|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)'],
};
