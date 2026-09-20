import { z } from 'zod';
import { apiError, apiSuccess, parseBody, withAuth } from '@/lib/api/handler';
import { startEmailDiscovery } from '@/server/jobs/email-discovery';

const schema = z.object({
  leadIds: z.array(z.string().cuid()).min(1).max(500),
  verify: z.boolean().optional(),
});

/** Queues bulk public-email discovery. Long work never blocks the request. */
export const POST = withAuth(
  async (request, { user }) => {
    const body = await parseBody(request, schema);

    const result = await startEmailDiscovery(body.leadIds, { userId: user.id, verify: body.verify });
    if (!result.ok) {
      return apiError(result.error, result.code === 'QUOTA' ? 429 : 400, { code: result.code });
    }

    return apiSuccess({ jobId: result.jobId, total: result.total }, { status: 202 });
  },
  { rateLimit: { key: 'email:find', limit: 30, windowMs: 60_000 } },
);
