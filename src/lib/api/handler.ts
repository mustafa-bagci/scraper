import 'server-only';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { ZodError, type TypeOf, type ZodTypeAny } from 'zod';
import { CSRF_COOKIE, type SessionUser, getCurrentUser } from '@/lib/auth/session';
import { ProviderError } from '@/lib/providers/business/BusinessDataProvider';
import { checkRateLimit } from '@/lib/security/rate-limit';

/**
 * Shared API plumbing.
 *
 * Every route handler goes through `withAuth`, which enforces the session,
 * CSRF protection on state-changing verbs, a request-size ceiling, and a
 * consistent error envelope that never leaks stack traces or API keys.
 */

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: string; code?: string; details?: unknown };

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export function apiSuccess<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data }, init);
}

export function apiError(message: string, status = 400, extra?: { code?: string; details?: unknown }) {
  return NextResponse.json<ApiFailure>({ ok: false, error: message, ...extra }, { status });
}

export type RouteContext = { user: SessionUser; ip: string };

type Handler = (request: Request, context: RouteContext) => Promise<Response> | Response;

export function withAuth(handler: Handler, options: { rateLimit?: { limit: number; windowMs: number; key: string } } = {}) {
  return async (request: Request): Promise<Response> => {
    try {
      const user = await getCurrentUser();
      if (!user) return apiError('Authentication required.', 401, { code: 'UNAUTHENTICATED' });

      if (MUTATING_METHODS.has(request.method)) {
        const csrf = await verifyCsrf(request);
        if (!csrf.ok) return apiError(csrf.reason, 403, { code: 'CSRF' });

        const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
          return apiError('Request body is too large.', 413, { code: 'PAYLOAD_TOO_LARGE' });
        }
      }

      const headerList = await headers();
      const ip = headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

      if (options.rateLimit) {
        const { limit, windowMs, key } = options.rateLimit;
        const result = checkRateLimit(`${key}:${user.id}`, limit, windowMs);
        if (!result.allowed) {
          return NextResponse.json<ApiFailure>(
            { ok: false, error: `Too many requests. Try again in ${result.retryAfterSeconds}s.`, code: 'RATE_LIMITED' },
            { status: 429, headers: { 'retry-after': String(result.retryAfterSeconds) } },
          );
        }
      }

      return await handler(request, { user, ip });
    } catch (error) {
      return handleUnexpected(error);
    }
  };
}

export function handleUnexpected(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return apiError('The request could not be validated.', 422, {
      code: 'VALIDATION',
      details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }

  if (error instanceof ProviderError) {
    // Operator-facing message only; details stay in the server log.
    console.error('[api] provider error', error);
    return apiError(error.message, error.retryable ? 503 : 502, { code: 'PROVIDER' });
  }

  console.error('[api] unexpected error', error);
  return apiError('An unexpected error occurred. Please try again.', 500, { code: 'INTERNAL' });
}

/** Parses and validates a JSON body. Throws ZodError, handled by `withAuth`. */
export async function parseBody<S extends ZodTypeAny>(request: Request, schema: S): Promise<TypeOf<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  return schema.parse(raw);
}

export function parseQuery<S extends ZodTypeAny>(request: Request, schema: S): TypeOf<S> {
  const url = new URL(request.url);
  const params: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const existing = params[key];
    if (existing === undefined) params[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else params[key] = [existing, value];
  }
  return schema.parse(params);
}

/**
 * CSRF defence: same-origin check plus a double-submit cookie token.
 *
 * The session cookie is SameSite=Lax, so a cross-site POST cannot carry it;
 * these checks close the remaining gaps for form-like requests.
 */
async function verifyCsrf(request: Request): Promise<{ ok: true } | { ok: false; reason: string }> {
  const headerList = await headers();
  const origin = headerList.get('origin');
  const host = headerList.get('host');

  if (origin) {
    try {
      if (new URL(origin).host !== host) return { ok: false, reason: 'Cross-origin request rejected.' };
    } catch {
      return { ok: false, reason: 'Invalid origin header.' };
    }
  }

  const store = await cookies();
  const expected = store.get(CSRF_COOKIE)?.value;
  const provided = request.headers.get('x-csrf-token');

  if (!expected) return { ok: true }; // Session predates the CSRF cookie; origin check applies.
  if (!provided || provided !== expected) return { ok: false, reason: 'Missing or invalid CSRF token.' };

  return { ok: true };
}
