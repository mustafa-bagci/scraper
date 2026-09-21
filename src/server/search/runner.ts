import 'server-only';
import { JobStatus, type Prisma, type SearchRun } from '@prisma/client';
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
 * Business discovery.
 *
 * The job is **resumable and executed in bounded slices**, because a serverless
 * invocation is frozen the moment it returns a response — a fire-and-forget
 * promise would simply be killed mid-search.
 *
 * Each tick claims a lock, processes provider pages until its time budget is
 * spent, persists its cursor and counters, and releases the lock. The first
 * tick is scheduled with `after()` so work starts immediately without delaying
 * the response; every subsequent client poll advances the job further. A tick
 * that dies mid-flight leaves a stale lock, which the next tick reclaims.
 */

/** A lock older than this is assumed to belong to a dead invocation. */
const LOCK_TTL_MS = 90_000;

/** Budget for the tick started by the API route via `after()`. */
export const INITIAL_TICK_BUDGET_MS = 50_000;
/** Budget for a tick driven by a client poll — must stay responsive. */
export const POLL_TICK_BUDGET_MS = 8_000;

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

  return { ok: true, searchRunId: run.id };
}

/**
 * Processes one slice of a search run.
 *
 * Safe to call concurrently and repeatedly: if another tick holds the lock, or
 * the run has already finished, it returns the current state untouched.
 */
export async function advanceSearchRun(
  searchRunId: string,
  budgetMs: number = POLL_TICK_BUDGET_MS,
): Promise<SearchRun | null> {
  const existing = await prisma.searchRun.findUnique({ where: { id: searchRunId } });
  if (!existing) return null;
  if (existing.status === JobStatus.COMPLETED || existing.status === JobStatus.FAILED) return existing;

  const claimed = await prisma.searchRun.updateMany({
    where: {
      id: searchRunId,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
      OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(Date.now() - LOCK_TTL_MS) } }],
    },
    data: {
      status: JobStatus.RUNNING,
      lockedAt: new Date(),
      ...(existing.startedAt ? {} : { startedAt: new Date(), statusMessage: 'Contacting data provider…' }),
    },
  });

  // Another tick is already working on this run; report what we have.
  if (claimed.count === 0) return prisma.searchRun.findUnique({ where: { id: searchRunId } });

  try {
    return await processSlice(searchRunId, budgetMs);
  } catch (error) {
    // Technical detail stays server-side; the operator gets a clean message.
    console.error('[search] tick failed', { searchRunId, error });
    const message =
      error instanceof ProviderError
        ? error.message
        : 'Business data provider temporarily unavailable. Please retry.';

    return prisma.searchRun.update({
      where: { id: searchRunId },
      data: { status: JobStatus.FAILED, error: message, lockedAt: null, finishedAt: new Date() },
    });
  }
}

async function processSlice(searchRunId: string, budgetMs: number): Promise<SearchRun> {
  const settings = await getSettings();
  const provider = await getBusinessProvider();

  if (!provider.isConfigured()) {
    throw new ProviderError(provider.id, 'Provider is not configured. Add an API key in Settings → Data Providers.');
  }

  let run = await prisma.searchRun.findUniqueOrThrow({ where: { id: searchRunId } });
  const filters = run.filters as LeadFilters;

  const requested = filters.limit ?? settings.general.defaultResultLimit;
  const limit = Math.min(requested, settings.limits.maxBusinessesPerSearch);

  // Counters accumulate across ticks, so they start from what is persisted.
  let discovered = run.discovered;
  let duplicates = run.duplicates;
  let matched = run.matched;
  let created = run.created;
  let updated = run.updated;
  let providerCalls = run.providerCalls;
  let providerCost = run.providerCost;
  let cursor = run.cursor;

  const deadline = Date.now() + budgetMs;
  let exhausted = false;
  // Every tick processes at least one page. Without this a tick whose budget
  // is already spent on entry would return having done nothing, and a job
  // driven only by such ticks would never finish.
  let firstPage = true;

  while (discovered < limit && (firstPage || Date.now() < deadline)) {
    firstPage = false;
    const page = await provider.searchBusinesses(
      {
        country: filters.country,
        region: filters.region,
        city: filters.city,
        postalCode: filters.postalCode,
        category: filters.category,
        keyword: filters.keyword,
        openNow: filters.openNow,
        // The ceiling for the whole search. Position comes from `cursor`, so
        // sending the remaining count here would truncate the final page.
        limit,
      },
      cursor,
    );

    providerCalls += page.providerCalls;
    providerCost += page.providerCost ?? 0;

    if (page.businesses.length === 0) {
      exhausted = true;
      break;
    }

    for (const business of page.businesses) {
      if (discovered >= limit) break;
      discovered += 1;

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

      if (outcome.created) {
        created += 1;
      } else {
        updated += 1;
        duplicates += 1;
      }
    }

    cursor = page.nextPageToken;

    run = await prisma.searchRun.update({
      where: { id: searchRunId },
      data: {
        discovered,
        unique: discovered - duplicates,
        duplicates,
        matched,
        created,
        updated,
        providerCalls,
        providerCost,
        cursor,
        // Refresh the lock so a long slice is not mistaken for a dead one.
        lockedAt: new Date(),
        progress: Math.min(99, Math.round((discovered / limit) * 100)),
        statusMessage: `${discovered.toLocaleString('en-US')} businesses discovered`,
      },
    });

    if (!cursor) {
      exhausted = true;
      break;
    }
  }

  const finished = exhausted || discovered >= limit;

  return prisma.searchRun.update({
    where: { id: searchRunId },
    data: {
      lockedAt: null,
      ...(finished
        ? {
            status: JobStatus.COMPLETED,
            progress: 100,
            statusMessage: `${created.toLocaleString('en-US')} new leads · ${updated.toLocaleString('en-US')} refreshed`,
            finishedAt: new Date(),
          }
        : {}),
    },
  });
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
