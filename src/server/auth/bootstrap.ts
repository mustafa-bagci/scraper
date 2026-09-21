import 'server-only';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { hashPassword } from '@/lib/security/crypto';

/**
 * First-run admin bootstrap.
 *
 * A hosted deployment has no terminal to run the seed from, so the very first
 * account is created from ADMIN_EMAIL / ADMIN_PASSWORD instead.
 *
 * It is deliberately narrow:
 *
 *  - It only ever runs while the `User` table is **empty**. Once an account
 *    exists it can never create, overwrite or re-enable another one, so the
 *    environment cannot be used to seize an existing installation.
 *  - Both variables must be set explicitly. There is no default, because a
 *    default password on an internet-facing admin login is a backdoor.
 *  - The password must be long, and the sample from the docs is refused
 *    outright so a copy-paste cannot become a live credential.
 *  - The address itself is never shown on the login page. The operator already
 *    knows what they configured; a passer-by should not be handed the admin
 *    username of a brand-new installation.
 */

const MIN_PASSWORD_LENGTH = 12;

/** Passwords that appear in this repo's docs and must never reach production. */
const REFUSED_PASSWORDS = new Set(['changeme!2026', 'changeme', 'password', 'admin']);

export type BootstrapResult =
  /** This request created the account. */
  | { status: 'created' }
  /** An account exists but has never been signed into — the operator is still
   *  arriving, so the login page keeps telling them which credentials to use. */
  | { status: 'awaiting-first-login' }
  | { status: 'exists' }
  | { status: 'unconfigured'; reason: string };

const emailSchema = z.string().email();

export async function ensureAdminUser(): Promise<BootstrapResult> {
  const existing = await prisma.user.findMany({ select: { lastLoginAt: true }, take: 2 });

  if (existing.length > 0) {
    // Any request can be the one that triggers creation — a health check, a
    // crawler, a preview screenshot — so "you have an account now" has to stay
    // on screen until someone actually signs in, not just for that one request.
    const untouched = existing.length === 1 && existing[0]?.lastLoginAt === null;
    return untouched ? { status: 'awaiting-first-login' } : { status: 'exists' };
  }

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    return {
      status: 'unconfigured',
      reason: 'Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment, then reload this page.',
    };
  }

  if (!emailSchema.safeParse(email).success) {
    return { status: 'unconfigured', reason: 'ADMIN_EMAIL is not a valid email address.' };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      status: 'unconfigured',
      reason: `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  if (REFUSED_PASSWORDS.has(password.trim().toLowerCase())) {
    return {
      status: 'unconfigured',
      reason: 'ADMIN_PASSWORD is a known example password. Choose a real one.',
    };
  }

  try {
    await prisma.user.create({
      data: {
        email,
        name: 'Administrator',
        passwordHash: await hashPassword(password),
        role: 'ADMIN',
      },
    });
    console.log(`[bootstrap] created the first admin account for ${email}`);
    return { status: 'created' };
  } catch (error) {
    // Two simultaneous first requests race here; the unique index settles it
    // and the loser simply reports that an account now exists.
    const account = await prisma.user.count();
    if (account > 0) return { status: 'awaiting-first-login' };

    console.error('[bootstrap] failed to create the admin account', error);
    return { status: 'unconfigured', reason: 'The admin account could not be created. Check the server logs.' };
  }
}
