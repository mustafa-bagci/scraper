import { EmailStatus } from '@prisma/client';
import { isDisposableDomain, normalizeEmail } from '@/lib/email/extract';
import type { EmailVerificationProvider, VerifyEmailResult } from './EmailFinderProvider';
import { VERIFICATION_UNAVAILABLE } from './EmailFinderProvider';

/**
 * Used when no verifier is configured.
 *
 * It deliberately refuses to claim anything about deliverability: the address
 * keeps the status it was discovered with and the UI shows
 * "Verification unavailable".
 */
export class NullEmailVerifier implements EmailVerificationProvider {
  readonly id = 'none';
  readonly name = 'No verification provider';

  isConfigured(): boolean {
    return false;
  }

  async verifyEmail(email: string): Promise<VerifyEmailResult> {
    return {
      status: normalizeEmail(email) ? EmailStatus.FOUND : EmailStatus.INVALID,
      verified: false,
      provider: this.id,
      detail: VERIFICATION_UNAVAILABLE,
    };
  }
}

/**
 * Syntax + disposable-domain screening only.
 *
 * This checks what can be checked locally and says so: a syntactically valid
 * address is reported as FOUND, never as VALID, because nothing here proves
 * the mailbox exists.
 */
export class SyntaxEmailVerifier implements EmailVerificationProvider {
  readonly id = 'syntax';
  readonly name = 'Local syntax & disposable check';

  isConfigured(): boolean {
    return true;
  }

  async verifyEmail(email: string): Promise<VerifyEmailResult> {
    const normalized = normalizeEmail(email);
    if (!normalized) {
      return { status: EmailStatus.INVALID, verified: true, provider: this.id, detail: 'Malformed email address.' };
    }

    const domain = normalized.split('@')[1] ?? '';
    if (isDisposableDomain(domain)) {
      return {
        status: EmailStatus.DISPOSABLE,
        verified: true,
        provider: this.id,
        detail: `${domain} is a known disposable mailbox provider.`,
      };
    }

    return {
      status: EmailStatus.FOUND,
      verified: false,
      provider: this.id,
      detail: 'Syntax is valid. Mailbox existence not checked — connect a verification provider for deliverability.',
    };
  }
}

/** Deterministic verifier for demos: exercises every status in the UI. */
export class MockEmailVerifier implements EmailVerificationProvider {
  readonly id = 'mock';
  readonly name = 'Mock verifier (demo data)';

  isConfigured(): boolean {
    return true;
  }

  async verifyEmail(email: string): Promise<VerifyEmailResult> {
    const normalized = normalizeEmail(email);
    if (!normalized) {
      return { status: EmailStatus.INVALID, verified: true, provider: this.id, detail: 'Malformed email address.' };
    }

    const domain = normalized.split('@')[1] ?? '';
    if (isDisposableDomain(domain)) {
      return { status: EmailStatus.DISPOSABLE, verified: true, provider: this.id, detail: 'Disposable mailbox provider.' };
    }

    const bucket = hash(normalized) % 10;
    if (bucket < 7) {
      return { status: EmailStatus.VALID, verified: true, provider: this.id, detail: 'Mailbox accepted the probe.' };
    }
    if (bucket < 9) {
      return { status: EmailStatus.RISKY, verified: true, provider: this.id, detail: 'Catch-all domain — delivery not guaranteed.' };
    }
    return { status: EmailStatus.INVALID, verified: true, provider: this.id, detail: 'Mailbox rejected the probe.' };
  }
}

function hash(value: string): number {
  let result = 5381;
  for (let i = 0; i < value.length; i += 1) result = ((result << 5) + result + value.charCodeAt(i)) >>> 0;
  return result;
}
