import { apiError, apiSuccess, handleUnexpected } from '@/lib/api/handler';
import { getCurrentUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

type Params = { params: Promise<{ id: string }> };

/** Progress for background jobs (email discovery, imports). */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError('Authentication required.', 401);

    const { id } = await params;
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return apiError('Job not found.', 404);

    return apiSuccess({
      id: job.id,
      kind: job.kind,
      status: job.status,
      total: job.total,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      statusMessage: job.statusMessage,
      error: job.error,
      finishedAt: job.finishedAt,
    });
  } catch (error) {
    return handleUnexpected(error);
  }
}
