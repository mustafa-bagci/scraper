import 'server-only';
import { JobStatus, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { matchesFilters } from '@/lib/filters/engine';
import { getBusinessProvider } from '@/lib/providers/registry';
import { ProviderError } from '@/lib/providers/business/BusinessDataProvider';
import { computeReviewStats } from '@/lib/reviews/stats';
import { scoreLead } from '@/lib/scoring/engine';
import { consumeDailyQuota } from '@/lib/security/rate-limit';
import { getSettings } from '@/lib/settings/service';
import { upsertBusinessAsLead } from '@/server/leads/upsert';
import { describeFilters, type LeadFilters } from '@/types/filters';

/**
 * Business discovery runs as a job, never inline in the HTTP request.
 *
 * `startSearchRun` creates the record, reserves quota and returns immediately;
 * the client polls `/api/search/:id` for live counters:
 *
 *   discovered → unique → duplicates → matched → stored
 */

export type StartSearchResult =
  | { ok: true; searchRunId: string }
  | { ok: false; error: string; code: 'QUOTA' | 'PROVIDER' | 'INVALID' };

export async function startSearchRun(
  filters: LeadFilters,
  options: { userId: string | null; savedSearchId?: string | null; label?: string },
): Promise<StartSearchResult> {
  const settings = await getSettings();
  const provider = await getBusinessProvider();

  const quota = await consumeDailyQuota('search:runs', settings.limits.maxSearchesPerDay);
  if (!quota.allowed) {
    return {
      ok: false,
      code: 'QUOTA',
      error: `Daily search limit reached (${quota.limit}/day). Raise it in Settings → Cost control.`,
    };
  }

  const run = await prisma.searchRun.create({
    data: {
      userId: options.userId,
      savedSearchId: options.savedSearchId ?? null,
      label: options.label?.trim() || describeFilters(filters),
      filters: filters as unknown as Prisma.InputJsonValue,
      provider: provider.id,
      status: JobStatus.PENDING,
      statusMessage: 'Queued',
    },
  });

  if (options.savedSearchId) {
    await prisma.savedSearch.update({
      where: { id: options.savedSearchId },
      data: { runCount: { increment: 1 }, lastRunAt: new Date() },
    });
  }

  // Fire-and-forget: the request returns as soon as the job exists.
  void executeSearchRun(run.id).catch(async (error: unknown) => {
    console.error('[search] unhandled failure', error);
    await prisma.searchRun
      .update({
        where: { id: run.id },
        data: {
          status: JobStatus.FAILED,
          error: 'The search job stopped unexpectedly.',
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined);
  });

  return { ok: true, searchRunId: run.id };
}

export async function executeSearchRun(searchRunId: string): Promise<void> {
  const run = await prisma.searchRun.findUnique({ where: { id: searchRunId } });
  if (!run || run.status !== JobStatus.PENDING) return;

  const settings = await getSettings();
  const filters = run.filters as LeadFilters;

  const requested = filters.limit ?? settings.general.defaultResultLimit;
  const limit = Math.min(requested, settings.limits.maxBusinessesPerSearch);

  await prisma.searchRun.update({
    where: { id: searchRunId },
    data: { status: JobStatus.RUNNING, startedAt: new Date(), statusMessage: 'Contacting data provider…' },
  });

  let discovered = 0;
  let duplicates = 0;
  let matched = 0;
  let created = 0;
  let updated = 0;
  let providerCalls = 0;

  try {
    const provider = await getBusinessProvider();

    if (!provider.isConfigured()) {
      throw new ProviderError(provider.id, 'Provider is not configured. Add an API key in Settings → Data Providers.');
    }

    const seenExternalIds = new Set<string>();
    let pageToken: string | null = null;

    while (discovered < limit) {
      const page = await provider.searchBusinesses(
        {
          country: filters.country,
          region: filters.region,
          city: filters.city,
          postalCode: filters.postalCode,
          category: filters.category,
          keyword: filters.keyword,
          openNow: filters.openNow,
          limit: limit - discovered,
        },
        pageToken,
      );

      providerCalls += page.providerCalls;
      if (page.businesses.length === 0) break;

      for (const business of page.businesses) {
        if (discovered >= limit) break;
        discovered += 1;

        // In-batch duplicate: the provider returned the same record twice.
        if (business.externalId && seenExternalIds.has(business.externalId)) {
          duplicates += 1;
          continue;
        }
        if (business.externalId) seenExternalIds.add(business.externalId);

        const stats = computeReviewStats(business.ratingBreakdown, business.reviewCount, settings.reviews);
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

        // Same filter engine as the lead list — the counters cannot disagree.
        const isMatch = matchesFilters(
          {
            businessName: business.name,
            category: business.primaryCategory,
            categories: business.categories,
            country: business.country,
            region: business.region,
            city: business.city,
            postalCode: business.postalCode,
            address: business.address,
            rating: business.rating,
            reviewCount: stats.reviewCount,
            badReviewCount: stats.badReviewCount,
            badReviewPercentage: stats.badReviewPercentage,
            oneStarCount: stats.oneStarCount,
            twoStarCount: stats.twoStarCount,
            leadScore: score.score,
            website: business.website,
            email: business.email,
            phone: business.phone,
            openNow: business.openNow,
          },
          { ...filters, limit: undefined },
        );

        if (!isMatch) continue;
        matched += 1;

        const outcome = await upsertBusinessAsLead(business, {
          provider: provider.id,
          settings,
          ownerId: run.userId,
          searchRunId: run.id,
          source: 'search',
        });

        if (outcome.created) created += 1;
        else {
          updated += 1;
          duplicates += 1;
        }
      }

      await prisma.searchRun.update({
        where: { id: searchRunId },
        data: {
          discovered,
          unique: discovered - duplicates,
          duplicates,
          matched,
          created,
          updated,
          providerCalls,
          progress: Math.min(99, Math.round((discovered / limit) * 100)),
          statusMessage: `${discovered.toLocaleString('en-US')} businesses discovered`,
        },
      });

      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }

    await prisma.searchRun.update({
      where: { id: searchRunId },
      data: {
        status: JobStatus.COMPLETED,
        progress: 100,
        discovered,
        unique: discovered - duplicates,
        duplicates,
        matched,
        created,
        updated,
        providerCalls,
        statusMessage: `${created.toLocaleString('en-US')} new leads · ${updated.toLocaleString('en-US')} refreshed`,
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    // Technical detail stays server-side; the operator gets a clean message.
    console.error('[search] run failed', { searchRunId, error });
    const message =
      error instanceof ProviderError
        ? error.message
        : 'Business data provider temporarily unavailable. Please retry.';

    await prisma.searchRun.update({
      where: { id: searchRunId },
      data: {
        status: JobStatus.FAILED,
        error: message,
        discovered,
        unique: discovered - duplicates,
        duplicates,
        matched,
        created,
        updated,
        providerCalls,
        finishedAt: new Date(),
      },
    });
  }
}

/** Indicative provider usage for a search, shown before it is run. */
export function estimateSearchCost(
  limit: number,
  costPerBusiness: number,
  currency: string,
): { requests: number; cost: string } {
  const requests = Math.max(1, Math.ceil(limit / 20));
  const cost = limit * costPerBusiness;
  return {
    requests,
    cost: cost > 0 ? `${cost.toFixed(2)} ${currency}` : 'No provider cost',
  };
}
