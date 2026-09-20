'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { verifyPassword } from '@/lib/security/crypto';
import { getSetting } from '@/lib/settings/service';
import { createSession, destroySession } from '@/lib/auth/session';

const credentialsSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginState = { error: string | null };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    password: String(formData.get('password') ?? ''),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid credentials' };
  }

  const headerList = await headers();
  const ip = headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

  const limit = checkRateLimit(`login:${ip}`, 10, 5 * 60 * 1000);
  if (!limit.allowed) {
    return { error: `Too many attempts. Try again in ${limit.retryAfterSeconds}s.` };
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

  // Always run a verification to keep the timing profile flat for unknown users.
  const passwordOk = await verifyPassword(
    parsed.data.password,
    user?.passwordHash ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  );

  if (!user || !user.isActive || !passwordOk) {
    return { error: 'Incorrect email or password.' };
  }

  const security = await getSetting('security');
  await createSession(user.id, security.sessionTtlHours, {
    userAgent: headerList.get('user-agent'),
    ip,
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  redirect('/dashboard');
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/login');
}
