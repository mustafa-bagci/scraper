import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { getEnv } from '@/lib/env';
import { decryptSecret } from '@/lib/security/crypto';
import { getSettings } from '@/lib/settings/service';
import type { BusinessDataProvider } from './business/BusinessDataProvider';
import { GooglePlacesProvider } from './business/GooglePlacesProvider';
import { MockBusinessProvider } from './business/MockBusinessProvider';
import type { EmailFinderProvider, EmailVerificationProvider } from './email/EmailFinderProvider';
import { MockEmailFinder } from './email/MockEmailFinder';
import { WebsiteEmailFinder } from './email/WebsiteEmailFinder';
import {
  MockEmailVerifier,
  NullEmailVerifier,
  SyntaxEmailVerifier,
} from './email/EmailVerificationProvider';

/**
 * Provider resolution.
 *
 * Selection and credentials come from the database first (Settings → Data
 * Providers, encrypted at rest) and fall back to environment variables. API
 * keys are decrypted here, inside server-only code, and never returned to any
 * caller that could serialise them to the browser.
 */

export const PROVIDER_KINDS = {
  business: 'business',
  emailFinder: 'email-finder',
  emailVerification: 'email-verification',
} as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[keyof typeof PROVIDER_KINDS];

export type ProviderDescriptor = {
  kind: ProviderKind;
  id: string;
  label: string;
  description: string;
  requiresApiKey: boolean;
};

export const AVAILABLE_PROVIDERS: ProviderDescriptor[] = [
  {
    kind: 'business',
    id: 'mock',
    label: 'Mock provider (demo data)',
    description: 'Deterministic synthetic businesses. No API key, no network calls, no cost.',
    requiresApiKey: false,
  },
  {
    kind: 'business',
    id: 'google-places',
    label: 'Google Places API',
    description:
      'Official Places API (New). Supplies rating and total review count; the star distribution is not exposed by this API.',
    requiresApiKey: true,
  },
  {
    kind: 'email-finder',
    id: 'website-crawler',
    label: 'Website crawler (public pages)',
    description: "Reads publicly published addresses from the business's own site. No API key required.",
    requiresApiKey: false,
  },
  {
    kind: 'email-finder',
    id: 'mock',
    label: 'Mock email finder (demo data)',
    description: 'Deterministic synthetic results for demos and offline development.',
    requiresApiKey: false,
  },
  {
    kind: 'email-verification',
    id: 'none',
    label: 'No verification',
    description: 'Addresses keep the status they were discovered with and are reported as unverified.',
    requiresApiKey: false,
  },
  {
    kind: 'email-verification',
    id: 'syntax',
    label: 'Local syntax & disposable check',
    description: 'Screens malformed addresses and known disposable domains. Does not prove deliverability.',
    requiresApiKey: false,
  },
  {
    kind: 'email-verification',
    id: 'mock',
    label: 'Mock verifier (demo data)',
    description: 'Deterministic statuses for demos. Never use for real outbound decisions.',
    requiresApiKey: false,
  },
];

type ResolvedSelection = { id: string; apiKey: string | null; fromDatabase: boolean };

async function resolveSelection(kind: ProviderKind, envId: string, envKey: string | undefined): Promise<ResolvedSelection> {
  const active = await prisma.providerConfig.findFirst({ where: { kind, isActive: true } });
  if (active) {
    return {
      id: active.name,
      apiKey: active.apiKeyCipher ? decryptSecret(active.apiKeyCipher) : (envKey ?? null),
      fromDatabase: true,
    };
  }
  return { id: envId, apiKey: envKey ?? null, fromDatabase: false };
}

export async function getBusinessProvider(): Promise<BusinessDataProvider> {
  const env = getEnv();
  const selection = await resolveSelection('business', env.BUSINESS_DATA_PROVIDER, env.BUSINESS_DATA_API_KEY);

  switch (selection.id) {
    case 'google-places':
      return new GooglePlacesProvider(selection.apiKey);
    case 'mock':
    default:
      return new MockBusinessProvider();
  }
}

export async function getEmailFinder(): Promise<EmailFinderProvider> {
  const env = getEnv();
  const selection = await resolveSelection('email-finder', env.EMAIL_FINDER_PROVIDER, env.EMAIL_FINDER_API_KEY);

  switch (selection.id) {
    case 'mock':
      return new MockEmailFinder();
    case 'website-crawler':
    default: {
      const settings = await getSettings();
      return new WebsiteEmailFinder(settings.crawler, settings.security.blockedHosts);
    }
  }
}

export async function getEmailVerifier(): Promise<EmailVerificationProvider> {
  const env = getEnv();
  const selection = await resolveSelection(
    'email-verification',
    env.EMAIL_VERIFICATION_PROVIDER,
    env.EMAIL_VERIFICATION_API_KEY,
  );

  switch (selection.id) {
    case 'syntax':
      return new SyntaxEmailVerifier();
    case 'mock':
      return new MockEmailVerifier();
    case 'none':
    default:
      return new NullEmailVerifier();
  }
}

/** Safe, serialisable provider state for the Settings screen. Never includes keys. */
export type ProviderStatus = {
  kind: ProviderKind;
  activeId: string;
  activeLabel: string;
  configured: boolean;
  requiresApiKey: boolean;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  source: 'database' | 'environment';
  lastError: string | null;
};

export async function getProviderStatuses(): Promise<ProviderStatus[]> {
  const env = getEnv();
  const rows = await prisma.providerConfig.findMany({ where: { isActive: true } });
  const byKind = new Map(rows.map((row) => [row.kind, row]));

  const entries: Array<{ kind: ProviderKind; envId: string; envKey: string | undefined }> = [
    { kind: 'business', envId: env.BUSINESS_DATA_PROVIDER, envKey: env.BUSINESS_DATA_API_KEY },
    { kind: 'email-finder', envId: env.EMAIL_FINDER_PROVIDER, envKey: env.EMAIL_FINDER_API_KEY },
    { kind: 'email-verification', envId: env.EMAIL_VERIFICATION_PROVIDER, envKey: env.EMAIL_VERIFICATION_API_KEY },
  ];

  return entries.map(({ kind, envId, envKey }) => {
    const row = byKind.get(kind);
    const activeId = row?.name ?? envId;
    const descriptor = AVAILABLE_PROVIDERS.find((p) => p.kind === kind && p.id === activeId);
    const hasApiKey = Boolean(row?.apiKeyCipher) || Boolean(envKey);

    return {
      kind,
      activeId,
      activeLabel: descriptor?.label ?? activeId,
      requiresApiKey: descriptor?.requiresApiKey ?? false,
      hasApiKey,
      configured: !(descriptor?.requiresApiKey ?? false) || hasApiKey,
      apiKeyHint: row?.apiKeyHint ?? (envKey ? '•••• (from environment)' : null),
      source: row ? 'database' : 'environment',
      lastError: row?.lastError ?? null,
    };
  });
}
