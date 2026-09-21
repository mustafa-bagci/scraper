import { z } from 'zod';
import { apiSuccess, parseBody, withAuth } from '@/lib/api/handler';
import { leadFiltersSchema } from '@/types/filters';
import { countLeads, listLeadIds } from '@/server/leads/service';

/**
 * The ids of every lead matching a filter, so the list can offer "select all
 * results" rather than only the page in view.
 *
 * Bounded: a selection larger than this is not something the bulk actions can
 * carry anyway, and the response says when it was cut short so the operator is
 * never silently given a subset.
 */
const MAX_SELECTABLE = 2000;

const schema = z.object({ filters: leadFiltersSchema.default({}) });

/** POST because the filter object is structured; it reads and mutates nothing. */
export const POST = withAuth(
  async (request) => {
    const { filters } = await parseBody(request, schema);

    const [matching, ids] = await Promise.all([
      countLeads(filters),
      listLeadIds({ filters }, MAX_SELECTABLE),
    ]);

    return apiSuccess({ ids, matching, truncated: matching > ids.length, limit: MAX_SELECTABLE });
  },
  { rateLimit: { key: 'leads:ids', limit: 60, windowMs: 60_000 } },
);
