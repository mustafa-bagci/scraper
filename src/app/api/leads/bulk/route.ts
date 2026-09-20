import { LeadStatus } from '@prisma/client';
import { z } from 'zod';
import { apiSuccess, parseBody, withAuth } from '@/lib/api/handler';
import { leadFiltersSchema } from '@/types/filters';
import { deleteLeads, listLeadIds, updateLeadStatus } from '@/server/leads/service';

const bulkSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('status'),
    leadIds: z.array(z.string().cuid()).min(1).max(2000),
    status: z.nativeEnum(LeadStatus),
  }),
  z.object({
    action: z.literal('delete'),
    leadIds: z.array(z.string().cuid()).min(1).max(2000),
  }),
  z.object({
    action: z.literal('delete-filtered'),
    filters: leadFiltersSchema,
  }),
]);

/** Bulk status change and permanent deletion, including "delete all results". */
export const POST = withAuth(
  async (request, { user }) => {
    const body = await parseBody(request, bulkSchema);

    if (body.action === 'status') {
      const count = await updateLeadStatus(body.leadIds, body.status, user.id);
      return apiSuccess({ updated: count });
    }

    if (body.action === 'delete') {
      const count = await deleteLeads(body.leadIds);
      return apiSuccess({ deleted: count });
    }

    const ids = await listLeadIds({ filters: body.filters }, 10000);
    const count = await deleteLeads(ids);
    return apiSuccess({ deleted: count });
  },
  { rateLimit: { key: 'leads:bulk', limit: 60, windowMs: 60_000 } },
);
