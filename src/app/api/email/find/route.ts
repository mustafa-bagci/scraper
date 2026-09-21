import { after } from 'next/server';
import { z } from 'zod';
import { apiError, apiSuccess, parseBody, withAuth } from '@/lib/api/handler';
import { INITIAL_TICK_BUDGET_MS, advanceEmailDiscovery, startEmailDiscovery } from '@/server/jobs/email-discovery';

const schema = z.object({
  leadIds: z.array(z.string().cuid()).min(1).max(500),
  verify: z.boolean().optional(),
});

export const maxDuration = 60;

/**
 * Queues bulk public-email discovery. Long work never blocks the request: the
 * first slice runs in `after()` and the client's polls drive the rest.
 */
export const POST = withAuth(
  async (request, { user }) => {
    const body = await parseBody(request, schema);

    const result = await startEmailDiscovery(body.leadIds, { userId: user.id, verify: body.verify });
    if (!result.ok) {
      return apiError(result.error, result.code === 'QUOTA' ? 429 : 400, { code: result.code });
    }

    const jobId = result.jobId;
    after(async () => {
      try {
        await advanceEmailDiscovery(jobId, INITIAL_TICK_BUDGET_MS);
      } catch (error) {
        console.error('[email-discovery] initial tick failed', error);
      }
    });

    return apiSuccess({ jobId, total: result.total }, { status: 202 });
  },
  { rateLimit: { key: 'email:find', limit: 30, windowMs: 60_000 } },
);
