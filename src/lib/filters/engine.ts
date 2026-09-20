import type { Prisma } from '@prisma/client';
import type { LeadFilters, Presence } from '@/types/filters';

/**
 * The one place filter semantics are defined.
 *
 * `toPrismaWhere` is used by the lead list, dashboard scoping and exports;
 * `matchesFilters` applies the identical rules to freshly-discovered provider
 * records before they are persisted. Keeping both in this module guarantees
 * that "687 match your filters" during a search equals what the list shows.
 */
export function toPrismaWhere(filters: LeadFilters): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [];

  if (filters.country) and.push({ country: { equals: filters.country, mode: 'insensitive' } });
  if (filters.region) and.push({ region: { contains: filters.region, mode: 'insensitive' } });
  if (filters.city) and.push({ city: { contains: filters.city, mode: 'insensitive' } });
  if (filters.postalCode) and.push({ postalCode: { startsWith: filters.postalCode } });
  if (filters.category) {
    and.push({
      OR: [
        { category: { contains: filters.category, mode: 'insensitive' } },
        { categories: { has: filters.category } },
      ],
    });
  }
  if (filters.keyword) {
    const keyword = filters.keyword;
    and.push({
      OR: [
        { businessName: { contains: keyword, mode: 'insensitive' } },
        { category: { contains: keyword, mode: 'insensitive' } },
        { address: { contains: keyword, mode: 'insensitive' } },
        { website: { contains: keyword, mode: 'insensitive' } },
        { email: { contains: keyword, mode: 'insensitive' } },
      ],
    });
  }

  pushRange(and, 'rating', filters.rating);
  pushRange(and, 'reviewCount', filters.reviewCount);
  pushRange(and, 'badReviewCount', filters.badReviewCount);
  pushRange(and, 'badReviewPercentage', filters.badReviewPercentage);
  pushRange(and, 'oneStarCount', filters.oneStarCount);
  pushRange(and, 'twoStarCount', filters.twoStarCount);
  pushRange(and, 'leadScore', filters.leadScore);

  pushPresence(and, 'website', filters.website);
  pushPresence(and, 'email', filters.email);
  pushPresence(and, 'phone', filters.phone);

  if (filters.status?.length) and.push({ status: { in: filters.status } });
  if (filters.emailStatus?.length) and.push({ emailStatus: { in: filters.emailStatus } });
  if (filters.openNow !== undefined) and.push({ openNow: filters.openNow });

  return and.length ? { AND: and } : {};
}

type RangeField =
  | 'rating'
  | 'reviewCount'
  | 'badReviewCount'
  | 'badReviewPercentage'
  | 'oneStarCount'
  | 'twoStarCount'
  | 'leadScore';

function pushRange(
  and: Prisma.LeadWhereInput[],
  field: RangeField,
  range: { min?: number; max?: number } | undefined,
): void {
  if (!range) return;
  const condition: Prisma.FloatFilter & Prisma.IntFilter = {};
  let used = false;
  if (range.min !== undefined) {
    condition.gte = range.min;
    used = true;
  }
  if (range.max !== undefined) {
    condition.lte = range.max;
    used = true;
  }
  if (!used) return;

  // A null rating must not silently satisfy a rating range.
  if (field === 'rating') {
    and.push({ rating: condition });
    return;
  }
  and.push({ [field]: condition } as Prisma.LeadWhereInput);
}

function pushPresence(
  and: Prisma.LeadWhereInput[],
  field: 'website' | 'email' | 'phone',
  presence: Presence | undefined,
): void {
  if (!presence || presence === 'any') return;
  if (presence === 'required') {
    and.push({ [field]: { not: null } } as Prisma.LeadWhereInput);
    and.push({ NOT: { [field]: '' } } as Prisma.LeadWhereInput);
  } else {
    and.push({ OR: [{ [field]: null }, { [field]: '' }] } as Prisma.LeadWhereInput);
  }
}

// ---------------------------------------------------------------------------
// In-memory evaluation (identical semantics, used during discovery)
// ---------------------------------------------------------------------------

export type FilterableRecord = {
  businessName: string;
  category: string | null;
  categories?: string[];
  country: string | null;
  region: string | null;
  city: string | null;
  postalCode: string | null;
  address: string | null;
  rating: number | null;
  reviewCount: number;
  badReviewCount: number;
  badReviewPercentage: number;
  oneStarCount: number;
  twoStarCount: number;
  leadScore: number;
  website: string | null;
  email: string | null;
  phone: string | null;
  openNow?: boolean | null;
};

export function matchesFilters(record: FilterableRecord, filters: LeadFilters): boolean {
  if (filters.country && !equalsLoose(record.country, filters.country)) return false;
  if (filters.region && !containsLoose(record.region, filters.region)) return false;
  if (filters.city && !containsLoose(record.city, filters.city)) return false;
  if (filters.postalCode && !(record.postalCode ?? '').startsWith(filters.postalCode)) return false;

  if (filters.category) {
    const haystack = [record.category, ...(record.categories ?? [])].filter(Boolean).join(' ');
    if (!containsLoose(haystack, filters.category)) return false;
  }

  if (filters.keyword) {
    const haystack = [record.businessName, record.category, record.address, record.website, record.email]
      .filter(Boolean)
      .join(' ');
    if (!containsLoose(haystack, filters.keyword)) return false;
  }

  if (!inRange(record.rating, filters.rating)) return false;
  if (!inRange(record.reviewCount, filters.reviewCount)) return false;
  if (!inRange(record.badReviewCount, filters.badReviewCount)) return false;
  if (!inRange(record.badReviewPercentage, filters.badReviewPercentage)) return false;
  if (!inRange(record.oneStarCount, filters.oneStarCount)) return false;
  if (!inRange(record.twoStarCount, filters.twoStarCount)) return false;
  if (!inRange(record.leadScore, filters.leadScore)) return false;

  if (!hasPresence(record.website, filters.website)) return false;
  if (!hasPresence(record.email, filters.email)) return false;
  if (!hasPresence(record.phone, filters.phone)) return false;

  if (filters.openNow !== undefined && record.openNow !== filters.openNow) return false;

  return true;
}

function inRange(value: number | null, range: { min?: number; max?: number } | undefined): boolean {
  if (!range || (range.min === undefined && range.max === undefined)) return true;
  if (value === null || value === undefined) return false;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

function hasPresence(value: string | null, presence: Presence | undefined): boolean {
  if (!presence || presence === 'any') return true;
  const present = Boolean(value && value.trim());
  return presence === 'required' ? present : !present;
}

function equalsLoose(a: string | null, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
}

function containsLoose(a: string | null, b: string): boolean {
  return (a ?? '').toLowerCase().includes(b.trim().toLowerCase());
}
