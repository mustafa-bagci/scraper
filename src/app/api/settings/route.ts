import { z } from 'zod';
import { apiSuccess, parseBody, withAuth } from '@/lib/api/handler';
import { getSettings, updateSetting } from '@/lib/settings/service';
import { recomputeAllLeads } from '@/server/leads/service';
import { SETTINGS_SCHEMAS } from '@/types/settings';

const schema = z.object({
  section: z.enum(['general', 'scoring', 'reviews', 'crawler', 'limits', 'export', 'security']),
  value: z.unknown(),
});

export const GET = withAuth(async () => apiSuccess(await getSettings()));

/**
 * Updating the scoring rules or the bad-review definition changes what every
 * stored lead is worth, so those two sections trigger a full recompute.
 */
export const PATCH = withAuth(async (request) => {
  const body = await parseBody(request, schema);
  const parsed = SETTINGS_SCHEMAS[body.section].parse(body.value);
  const saved = await updateSetting(body.section, parsed);

  let recomputed = 0;
  if (body.section === 'scoring' || body.section === 'reviews') {
    recomputed = await recomputeAllLeads();
  }

  return apiSuccess({ section: body.section, value: saved, recomputed });
});
