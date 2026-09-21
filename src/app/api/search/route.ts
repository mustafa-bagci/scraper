import { after } from 'next/server';
import { z } from 'zod';
import { apiError, apiSuccess, parseBody, withAuth } from '@/lib/api/handler';
import { leadFiltersSchema } from '@/types/filters';
import { INITIAL_TICK_BUDGET_MS, advanceSearchRun, startSearchRun } from '@/server/search/runner';

const schema = z.object({
  filters: leadFiltersSchema,
  savedSearchId: z.string().cuid().nullable().optional(),
  label: z.string().trim().max(160).optional(),
});

/** Upper bound for the `after()` tick; also the platform function timeout. */
export const maxDuration = 60;

/**
 * Queues a business discovery job and returns immediately with its id.
 *
 * The first slice is scheduled with `after()`, so work begins without delaying
 * the response and — unlike a bare fire-and-forget promise — survives on
 * serverless, where the invocation is kept alive until the callback settles.
 * Whatever the slice does not finish, the client's polls carry on.
 */
export const POST = withAuth(
  async (request, { user }) => {
    const body = await parseBody(request, schema);

    const result = await startSearchRun(body.filters, {
      userId: user.id,
      savedSearchId: body.savedSearchId ?? null,
      label: body.label,
    });

    if (!result.ok) {
      return apiError(result.error, result.code === 'QUOTA' ? 429 : 502, { code: result.code });
    }

    after(async () => {
      try {
        await advanceSearchRun(result.searchRunId, INITIAL_TICK_BUDGET_MS);
      } catch (error) {
        console.error('[search] initial tick failed', error);
      }
    });

    return apiSuccess({ searchRunId: result.searchRunId }, { status: 202 });
  },
  { rateLimit: { key: 'search:start', limit: 20, windowMs: 60_000 } },
);
