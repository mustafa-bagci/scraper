import { z } from 'zod';
import { apiError, apiSuccess, handleUnexpected, parseBody } from '@/lib/api/handler';
import { getCurrentUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { leadFiltersSchema } from '@/types/filters';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(400).nullable().optional(),
  filters: leadFiltersSchema.optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError('Authentication required.', 401);

    const { id } = await params;
    const body = await parseBody(request, patchSchema);

    const updated = await prisma.savedSearch.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.filters !== undefined ? { filters: body.filters as object } : {}),
      },
    });

    return apiSuccess(updated);
  } catch (error) {
    return handleUnexpected(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError('Authentication required.', 401);

    const { id } = await params;
    await prisma.savedSearch.delete({ where: { id } });

    return apiSuccess({ deleted: 1 });
  } catch (error) {
    return handleUnexpected(error);
  }
}
