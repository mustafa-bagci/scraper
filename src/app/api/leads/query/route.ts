import { z } from 'zod';
import { apiSuccess, parseBody, withAuth } from '@/lib/api/handler';
import { leadFiltersSchema, leadQuerySchema } from '@/types/filters';
import { listLeads } from '@/server/leads/service';

const querySchema = z.object({
  filters: leadFiltersSchema.default({}),
  sortBy: leadQuerySchema.shape.sortBy,
  sortDir: leadQuerySchema.shape.sortDir,
  page: leadQuerySchema.shape.page,
  pageSize: leadQuerySchema.shape.pageSize,
});

/**
 * Filtered lead listing.
 *
 * POST because the filter object is structured and can exceed a practical
 * query string; it is a read-only operation and mutates nothing.
 */
export const POST = withAuth(async (request) => {
  const query = await parseBody(request, querySchema);
  return apiSuccess(await listLeads(query));
});
