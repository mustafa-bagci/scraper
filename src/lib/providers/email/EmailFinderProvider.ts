import type { EmailStatus } from '@prisma/client';

/**
 * Email discovery + verification contracts.
 *
 * Implementations must only return contact details that the business itself
 * publishes. Permutation guessing (first.last@domain) is explicitly out of
 * scope for every provider registered here.
 */

export type EmailCandidate = {
  email: string;
  /** Which mechanism produced it, e.g. "website-crawler" or "hunter". */
  source: string;
  /** Exact public page the address was read from, when known. */
  sourceUrl: string | null;
  isGeneric: boolean;
  /** Higher = better business contact. Used to elect the primary address. */
  score: number;
};

export type FindEmailsInput = {
  website: string | null;
  businessName: string;
  domain?: string | null;
  country?: string | null;
};

export type FindEmailsResult = {
  candidates: EmailCandidate[];
  /** Pages actually fetched — shown in the lead's activity trail. */
  pagesChecked: Array<{ url: string; ok: boolean; status: number | null; reason?: string }>;
  providerCalls: number;
  error: string | null;
};

export type VerifyEmailResult = {
  status: EmailStatus;
  /** False when no verifier is configured — the UI then says so plainly. */
  verified: boolean;
  provider: string;
  detail: string;
};

export interface EmailFinderProvider {
  readonly id: string;
  readonly name: string;
  isConfigured(): boolean;
  findEmails(input: FindEmailsInput): Promise<FindEmailsResult>;
}

export interface EmailVerificationProvider {
  readonly id: string;
  readonly name: string;
  isConfigured(): boolean;
  verifyEmail(email: string): Promise<VerifyEmailResult>;
}

export const VERIFICATION_UNAVAILABLE = 'Verification unavailable';
