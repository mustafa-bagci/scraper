import { apiError, apiSuccess, handleUnexpected } from '@/lib/api/handler';
import { getCurrentUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

type Params = { params: Promise<{ id: string }> };

/** Polled by the search page for live job progress. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError('Authentication required.', 401);

    const { id } = await params;
    const run = await prisma.searchRun.findUnique({ where: { id } });
    if (!run) return apiError('Search run not found.', 404);

    return apiSuccess({
      id: run.id,
      label: run.label,
      status: run.status,
      progress: run.progress,
      statusMessage: run.statusMessage,
      error: run.error,
      discovered: run.discovered,
      unique: run.unique,
      duplicates: run.duplicates,
      matched: run.matched,
      created: run.created,
      updated: run.updated,
      providerCalls: run.providerCalls,
      provider: run.provider,
      filters: run.filters,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    });
  } catch (error) {
    return handleUnexpected(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError('Authentication required.', 401);

    const { id } = await params;
    await prisma.searchRun.delete({ where: { id } });

    return apiSuccess({ deleted: 1 });
  } catch (error) {
    return handleUnexpected(error);
  }
}
