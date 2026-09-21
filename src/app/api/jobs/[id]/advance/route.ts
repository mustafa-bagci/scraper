import { JobKind } from '@prisma/client';
import { apiError, apiSuccess, handleUnexpected } from '@/lib/api/handler';
import { getCurrentUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { POLL_TICK_BUDGET_MS, advanceEmailDiscovery } from '@/server/jobs/email-discovery';
import { serialiseJob } from '@/server/jobs/serialise';

type Params = { params: Promise<{ id: string }> };

export const maxDuration = 60;

/**
 * Advances a background job by one bounded slice and returns its state.
 *
 * Ticks are mutually exclusive, so a poll arriving while a slice is running
 * reads the live counters rather than duplicating work.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError('Authentication required.', 401);

    const { id } = await params;
    const job = await prisma.job.findUnique({ where: { id }, select: { kind: true } });
    if (!job) return apiError('Job not found.', 404);

    if (job.kind !== JobKind.EMAIL_DISCOVERY) {
      return apiError('This job kind is not advanced through this endpoint.', 400);
    }

    const advanced = await advanceEmailDiscovery(id, POLL_TICK_BUDGET_MS);
    if (!advanced) return apiError('Job not found.', 404);

    return apiSuccess(serialiseJob(advanced));
  } catch (error) {
    return handleUnexpected(error);
  }
}
