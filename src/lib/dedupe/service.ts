import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';

/**
 * Duplicate detection.
 *
 * Priority order:
 *   1. `provider` + `externalId` — authoritative when the source supplies one.
 *   2. A deterministic `dedupeKey` built from normalised name + address + phone.
 *   3. Normalised name + normalised phone.
 *   4. Phone + locality, for the same business listed under a slightly
 *      different name ("… - Lyon 1", "Dr X —" prefixes, a branch suffix).
 *   5. Website domain + postal code, for a listing with no phone.
 *
 * Rules 4 and 5 both pair a strong identifier with a locality check. Phone or
 * domain alone would merge the separate branches of a chain, which are
 * genuinely different prospects with different review profiles.
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

export type DuplicateMatch = {
  id: string;
  reason: 'externalId' | 'dedupeKey' | 'namePhone' | 'phoneLocality' | 'domainLocality';
};

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

  const postalCode = input.postalCode?.trim() || null;
  const city = input.city?.trim() || null;

  // Same phone in the same place is the same business, whatever it calls
  // itself. Different branches have different numbers.
  if (keys.normalizedPhone && (postalCode || city)) {
    const byPhone = await prisma.lead.findFirst({
      where: {
        normalizedPhone: keys.normalizedPhone,
        ...(postalCode ? { postalCode } : { city }),
      },
      select: { id: true },
    });
    if (byPhone) return { id: byPhone.id, reason: 'phoneLocality' };
  }

  // A listing with no phone still gives itself away by sharing a website with
  // another listing at the same postcode.
  if (keys.websiteDomain && postalCode) {
    const byDomain = await prisma.lead.findFirst({
      where: { websiteDomain: keys.websiteDomain, postalCode },
      select: { id: true },
    });
    if (byDomain) return { id: byDomain.id, reason: 'domainLocality' };
  }

  return null;
}
