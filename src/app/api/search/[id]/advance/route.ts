import { apiError, apiSuccess, handleUnexpected } from '@/lib/api/handler';
import { getCurrentUser } from '@/lib/auth/session';
import { POLL_TICK_BUDGET_MS, advanceSearchRun } from '@/server/search/runner';
import { serialiseSearchRun } from '@/server/search/serialise';

type Params = { params: Promise<{ id: string }> };

export const maxDuration = 60;

/**
 * Advances a search run by one bounded slice and returns its current state.
 *
 * This is what the search console polls. Ticks are mutually exclusive, so a
 * poll that arrives while another slice is running simply reads the live
 * counters instead of duplicating work.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError('Authentication required.', 401);

    const { id } = await params;
    const run = await advanceSearchRun(id, POLL_TICK_BUDGET_MS);
    if (!run) return apiError('Search run not found.', 404);

    return apiSuccess(serialiseSearchRun(run));
  } catch (error) {
    return handleUnexpected(error);
  }
}
