import { apiError, apiSuccess, handleUnexpected } from '@/lib/api/handler';
import { getCurrentUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { serialiseJob } from '@/server/jobs/serialise';

type Params = { params: Promise<{ id: string }> };

/** Read-only progress for a background job. Advancing it is a POST to ./advance. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError('Authentication required.', 401);

    const { id } = await params;
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return apiError('Job not found.', 404);

    return apiSuccess(serialiseJob(job));
  } catch (error) {
    return handleUnexpected(error);
  }
}
