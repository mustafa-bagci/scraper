import { z } from 'zod';
import { apiError, apiSuccess, parseBody, withAuth } from '@/lib/api/handler';
import { leadFiltersSchema } from '@/types/filters';
import { startSearchRun } from '@/server/search/runner';

const schema = z.object({
  filters: leadFiltersSchema,
  savedSearchId: z.string().cuid().nullable().optional(),
  label: z.string().trim().max(160).optional(),
});

/** Queues a business discovery job and returns immediately with its id. */
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

    return apiSuccess({ searchRunId: result.searchRunId }, { status: 202 });
  },
  { rateLimit: { key: 'search:start', limit: 20, windowMs: 60_000 } },
);
