import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';

/**
 * Duplicate detection.
 *
 * Priority order:
 *   1. `provider` + `externalId` — authoritative when the source supplies one.
 *   2. A deterministic `dedupeKey` built from normalised name + address + phone.
 *   3. A looser normalised-name + normalised-phone probe.
 */

export type DedupeInput = {
  provider: string;
  externalId?: string | null;
  businessName: string;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  website?: string | null;
};

export type DedupeKeys = {
  dedupeKey: string;
  normalizedName: string;
  normalizedPhone: string | null;
  websiteDomain: string | null;
};

export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(sarl|sas|sasu|eurl|sa|ltd|llc|inc|gmbh|bv|bvba|nv|srl|spa|plc|co)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/[^\d+]/g, '').replace(/^00/, '+');
  const compact = digits.replace(/\D/g, '');
  if (compact.length < 6) return null;
  // Compare on the last 9 significant digits so +33 1 23 45 67 89 and
  // 01 23 45 67 89 collapse to the same key.
  return compact.slice(-9);
}

export function normalizeAddress(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function extractDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export function buildDedupeKeys(input: DedupeInput): DedupeKeys {
  const normalizedName = normalizeName(input.businessName);
  const normalizedPhone = normalizePhone(input.phone);
  const websiteDomain = extractDomain(input.website);

  const identity =
    input.externalId && input.externalId.trim()
      ? `ext:${input.provider}:${input.externalId.trim()}`
      : [
          'fuzzy',
          normalizedName,
          normalizeAddress(input.address),
          input.postalCode?.trim().toLowerCase() ?? '',
          normalizedPhone ?? websiteDomain ?? '',
        ].join('|');

  return {
    dedupeKey: createHash('sha256').update(identity).digest('hex').slice(0, 40),
    normalizedName,
    normalizedPhone,
    websiteDomain,
  };
}

export type DuplicateMatch = { id: string; reason: 'externalId' | 'dedupeKey' | 'namePhone' };

/** Looks for an existing lead that represents the same business. */
export async function findDuplicate(input: DedupeInput): Promise<DuplicateMatch | null> {
  const keys = buildDedupeKeys(input);

  if (input.externalId) {
    const byExternal = await prisma.lead.findFirst({
      where: { provider: input.provider, externalId: input.externalId },
      select: { id: true },
    });
    if (byExternal) return { id: byExternal.id, reason: 'externalId' };
  }

  const byKey = await prisma.lead.findUnique({ where: { dedupeKey: keys.dedupeKey }, select: { id: true } });
  if (byKey) return { id: byKey.id, reason: 'dedupeKey' };

  if (keys.normalizedPhone && keys.normalizedName) {
    const byNamePhone = await prisma.lead.findFirst({
      where: { normalizedName: keys.normalizedName, normalizedPhone: keys.normalizedPhone },
      select: { id: true },
    });
    if (byNamePhone) return { id: byNamePhone.id, reason: 'namePhone' };
  }

  return null;
}
