import { z } from 'zod';
import { apiSuccess, parseBody, withAuth } from '@/lib/api/handler';
import { prisma } from '@/lib/db/prisma';
import { leadFiltersSchema } from '@/types/filters';

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional(),
  filters: leadFiltersSchema,
});

export const GET = withAuth(async () => {
  const searches = await prisma.savedSearch.findMany({ orderBy: { updatedAt: 'desc' } });
  return apiSuccess(searches);
});

export const POST = withAuth(async (request, { user }) => {
  const body = await parseBody(request, schema);

  const saved = await prisma.savedSearch.create({
    data: {
      userId: user.id,
      name: body.name,
      description: body.description ?? null,
      filters: body.filters as object,
    },
  });

  return apiSuccess(saved, { status: 201 });
});
