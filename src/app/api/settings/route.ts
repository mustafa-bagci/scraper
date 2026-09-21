import { z } from 'zod';
import { apiSuccess, parseBody, withAuth } from '@/lib/api/handler';
import { getSettings, resetSetting, updateSetting } from '@/lib/settings/service';
import { recomputeAllLeads } from '@/server/leads/service';
import { SETTINGS_SCHEMAS } from '@/types/settings';

const sectionSchema = z.enum(['general', 'scoring', 'reviews', 'crawler', 'limits', 'export', 'security']);

const schema = z.union([
  z.object({ section: sectionSchema, reset: z.literal(true) }),
  z.object({ section: sectionSchema, value: z.unknown() }),
]);

export const GET = withAuth(async () => apiSuccess(await getSettings()));

/**
 * Updating the scoring rules or the bad-review definition changes what every
 * stored lead is worth, so those two sections trigger a full recompute.
 */
export const PATCH = withAuth(async (request) => {
  const body = await parseBody(request, schema);

  // Resetting drops the stored row so the section falls back to the defaults
  // that ship with the build — which is how a retuned default reaches an
  // installation that already saved its own values.
  const saved =
    'reset' in body
      ? await resetSetting(body.section)
      : await updateSetting(body.section, SETTINGS_SCHEMAS[body.section].parse(body.value));

  let recomputed = 0;
  if (body.section === 'scoring' || body.section === 'reviews') {
    recomputed = await recomputeAllLeads();
  }

  return apiSuccess({ section: body.section, value: saved, recomputed });
});
