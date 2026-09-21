import { apiError, apiSuccess, handleUnexpected } from '@/lib/api/handler';
import { getCurrentUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { serialiseSearchRun } from '@/server/search/serialise';

type Params = { params: Promise<{ id: string }> };

/** Read-only state for a search run. Advancing it is a POST to ./advance. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError('Authentication required.', 401);

    const { id } = await params;
    const run = await prisma.searchRun.findUnique({ where: { id } });
    if (!run) return apiError('Search run not found.', 404);

    return apiSuccess(serialiseSearchRun(run));
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
