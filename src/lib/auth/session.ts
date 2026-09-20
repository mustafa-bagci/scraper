import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import type { User } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getEnv } from '@/lib/env';
import { sha256 } from '@/lib/security/crypto';

export const SESSION_COOKIE = 'murgay_session';
export const CSRF_COOKIE = 'murgay_csrf';

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: User['role'];
};

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().AUTH_SECRET);
}

/**
 * Creates a database-backed session and sets an HTTP-only, SameSite=Lax,
 * Secure (in production) cookie holding a signed JWT. Only the SHA-256 hash of
 * the token is persisted, so a database leak does not yield usable sessions.
 */
export async function createSession(
  userId: string,
  ttlHours: number,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

  await prisma.authSession.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 250) ?? null,
      ipHash: meta.ip ? sha256(meta.ip).slice(0, 32) : null,
    },
  });

  const jwt = await new SignJWT({ sid: token, uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('murgay-lead-intelligence')
    .setExpirationTime(expiresAt)
    .sign(secretKey());

  const store = await cookies();
  const secure = process.env.NODE_ENV === 'production';

  store.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  // Double-submit CSRF token: readable by the browser, compared server-side.
  store.set(CSRF_COOKIE, randomBytes(24).toString('base64url'), {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const jwt = store.get(SESSION_COOKIE)?.value;
  if (!jwt) return null;

  let sessionToken: string;
  try {
    const { payload } = await jwtVerify(jwt, secretKey(), { issuer: 'murgay-lead-intelligence' });
    if (typeof payload.sid !== 'string') return null;
    sessionToken = payload.sid;
  } catch {
    return null;
  }

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: sha256(sessionToken) },
    include: { user: true },
  });

  if (!session || session.expiresAt <= new Date() || !session.user.isActive) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const jwt = store.get(SESSION_COOKIE)?.value;

  if (jwt) {
    try {
      const { payload } = await jwtVerify(jwt, secretKey(), { issuer: 'murgay-lead-intelligence' });
      if (typeof payload.sid === 'string') {
        await prisma.authSession.deleteMany({ where: { tokenHash: sha256(payload.sid) } });
      }
    } catch {
      // An unverifiable cookie is simply cleared below.
    }
  }

  store.delete(SESSION_COOKIE);
  store.delete(CSRF_COOKIE);
}

export async function purgeExpiredSessions(): Promise<void> {
  await prisma.authSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}

export class UnauthorizedError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}
