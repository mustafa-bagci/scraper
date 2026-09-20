import { z } from 'zod';
import { apiError, apiSuccess, parseBody, withAuth } from '@/lib/api/handler';
import { verifyLeadEmail } from '@/server/jobs/email-discovery';

const schema = z.object({ leadId: z.string().cuid() });

export const POST = withAuth(
  async (request, { user }) => {
    const { leadId } = await parseBody(request, schema);
    const result = await verifyLeadEmail(leadId, user.id);

    if (!result.ok) return apiError(result.error, 400);
    return apiSuccess(result.verification);
  },
  { rateLimit: { key: 'email:verify', limit: 60, windowMs: 60_000 } },
);
