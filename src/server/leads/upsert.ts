import 'server-only';
import { ActivityType, type Lead, type Prisma, WebsiteStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { buildDedupeKeys, findDuplicate } from '@/lib/dedupe/service';
import { computeReviewStats } from '@/lib/reviews/stats';
import { scoreLead, toStoredBreakdown } from '@/lib/scoring/engine';
import type { NormalizedBusiness } from '@/lib/providers/business/BusinessDataProvider';
import type { AppSettings } from '@/types/settings';

export type UpsertOutcome = {
  lead: Lead;
  created: boolean;
  duplicateOf: string | null;
};

/**
 * Normalises a provider record into a Lead, applying the operator's review
 * definition and scoring rules, and collapsing duplicates onto the existing
 * row rather than creating a second business.
 */
export async function upsertBusinessAsLead(
  business: NormalizedBusiness,
  context: {
    provider: string;
    settings: AppSettings;
    ownerId?: string | null;
    searchRunId?: string | null;
    importBatchId?: string | null;
    source?: string;
  },
): Promise<UpsertOutcome> {
  const { settings } = context;

  const stats = computeReviewStats(business.ratingBreakdown, business.reviewCount, settings.reviews);
  const keys = buildDedupeKeys({
    provider: context.provider,
    externalId: business.externalId,
    businessName: business.name,
    address: business.address,
    city: business.city,
    postalCode: business.postalCode,
    phone: business.phone,
    website: business.website,
  });

  const score = scoreLead(
    {
      rating: business.rating,
      reviewCount: stats.reviewCount,
      badReviewCount: stats.badReviewCount,
      badReviewPercentage: stats.badReviewPercentage,
      email: business.email,
      website: business.website,
      phone: business.phone,
    },
    settings.scoring,
  );

  const data = {
    externalId: business.externalId || null,
    provider: context.provider,
    businessName: business.name,
    category: business.primaryCategory,
    categories: business.categories,
    country: business.country,
    countryCode: business.countryCode,
    region: business.region,
    city: business.city,
    postalCode: business.postalCode,
    address: business.address,
    latitude: business.latitude,
    longitude: business.longitude,
    phone: business.phone,
    website: business.website,
    websiteDomain: keys.websiteDomain,
    rating: business.rating,
    reviewCount: stats.reviewCount,
    oneStarCount: stats.oneStarCount,
    twoStarCount: stats.twoStarCount,
    threeStarCount: stats.threeStarCount,
    fourStarCount: stats.fourStarCount,
    fiveStarCount: stats.fiveStarCount,
    badReviewCount: stats.badReviewCount,
    badReviewPercentage: stats.badReviewPercentage,
    reviewBreakdownAvailable: stats.breakdownAvailable,
    leadScore: score.score,
    scoreBreakdown: toStoredBreakdown(score) as unknown as Prisma.InputJsonValue,
    websiteStatus: business.website ? WebsiteStatus.UNKNOWN : WebsiteStatus.NO_WEBSITE,
    openNow: business.openNow,
    businessStatus: business.businessStatus,
    sourceUrl: business.sourceUrl,
    dedupeKey: keys.dedupeKey,
    normalizedName: keys.normalizedName,
    normalizedPhone: keys.normalizedPhone,
  } satisfies Prisma.LeadUncheckedUpdateInput;

  const duplicate = await findDuplicate({
    provider: context.provider,
    externalId: business.externalId,
    businessName: business.name,
    address: business.address,
    city: business.city,
    postalCode: business.postalCode,
    phone: business.phone,
    website: business.website,
  });

  if (duplicate) {
    const existing = await prisma.lead.findUniqueOrThrow({ where: { id: duplicate.id } });

    // Refresh the review and score signals — that is the point of seeing the
    // business again — but never trade known contact details for blanks. A
    // sparser duplicate listing must fill gaps, not erase what we already
    // have, and the operator's own work (status, notes, a discovered email)
    // stays untouched.
    const lead = await prisma.lead.update({
      where: { id: duplicate.id },
      data: {
        ...data,
        ...keepBest(existing, data),
        email: undefined,
        emailStatus: undefined,
        searchRunId: context.searchRunId ?? undefined,
      },
    });

    await replaceReviews(lead.id, business, context.settings);
    return { lead, created: false, duplicateOf: duplicate.id };
  }

  const lead = await prisma.lead.create({
    data: {
      ...data,
      email: business.email,
      ownerId: context.ownerId ?? null,
      searchRunId: context.searchRunId ?? null,
      importBatchId: context.importBatchId ?? null,
      source: context.source ?? 'search',
      collectedAt: new Date(),
    } as Prisma.LeadUncheckedCreateInput,
  });

  await replaceReviews(lead.id, business, context.settings);

  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      userId: context.ownerId ?? null,
      type: context.importBatchId ? ActivityType.IMPORTED : ActivityType.CREATED,
      message: context.importBatchId
        ? 'Lead imported from CSV'
        : `Lead discovered via ${context.provider} provider`,
      metadata: { provider: context.provider, sourceUrl: business.sourceUrl } as Prisma.InputJsonValue,
    },
  });

  return { lead, created: true, duplicateOf: null };
}

/**
 * Fields a re-sighting may fill in but must not blank out.
 *
 * Provider listings vary in completeness: the same business can come back
 * without the phone number it had last time. Losing a phone matters — it is
 * the fallback when no email is published.
 */
const PRESERVED_FIELDS = [
  'phone',
  'website',
  'websiteDomain',
  'address',
  'postalCode',
  'city',
  'region',
  'country',
  'countryCode',
  'latitude',
  'longitude',
  'category',
  'sourceUrl',
  'externalId',
] as const;

function keepBest(existing: Lead, incoming: Prisma.LeadUncheckedUpdateInput): Prisma.LeadUncheckedUpdateInput {
  const kept: Record<string, unknown> = {};

  for (const field of PRESERVED_FIELDS) {
    const next = incoming[field];
    const current = existing[field];
    const nextIsBlank = next === null || next === undefined || next === '';
    const currentIsBlank = current === null || current === undefined || current === '';

    if (nextIsBlank && !currentIsBlank) kept[field] = current;
  }

  return kept as Prisma.LeadUncheckedUpdateInput;
}

async function replaceReviews(
  leadId: string,
  business: NormalizedBusiness,
  settings: AppSettings,
): Promise<void> {
  if (business.reviews.length === 0) return;

  const limit = settings.reviews.maxStoredReviewsPerLead;
  if (limit === 0) return;

  const reviews = business.reviews.slice(0, limit);

  await prisma.$transaction([
    prisma.review.deleteMany({ where: { leadId } }),
    prisma.review.createMany({
      data: reviews.map((review) => ({
        leadId,
        externalId: review.externalId,
        rating: review.rating,
        text: review.text,
        authorName: review.authorName,
        publishedAt: review.publishedAt,
        language: review.language,
        source: business.sourceUrl ? 'provider' : null,
        sourceUrl: review.sourceUrl ?? business.sourceUrl,
      })),
    }),
  ]);
}
