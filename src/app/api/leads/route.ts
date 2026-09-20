import { z } from 'zod';
import { apiError, apiSuccess, parseBody, parseQuery, withAuth } from '@/lib/api/handler';
import { getSettings } from '@/lib/settings/service';
import { leadFiltersSchema, leadQuerySchema } from '@/types/filters';
import { filtersFromSearchParams } from '@/lib/filters/url';
import { listLeads } from '@/server/leads/service';
import { upsertBusinessAsLead } from '@/server/leads/upsert';
import { toAbsoluteUrl } from '@/lib/security/ssrf';

const createSchema = z.object({
  businessName: z.string().trim().min(1).max(200),
  category: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(24).optional(),
  address: z.string().trim().max(400).optional(),
  phone: z.string().trim().max(60).optional(),
  website: z.string().trim().max(400).optional(),
  email: z.string().trim().email().max(320).optional(),
});

const listQuerySchema = z.object({
  sortBy: leadQuerySchema.shape.sortBy,
  sortDir: leadQuerySchema.shape.sortDir,
  page: leadQuerySchema.shape.page,
  pageSize: leadQuerySchema.shape.pageSize,
});

/** Lead listing. Filters may be supplied as query parameters. */
export const GET = withAuth(async (request) => {
  const paging = parseQuery(request, listQuerySchema);
  const url = new URL(request.url);
  const filters = leadFiltersSchema.parse(filtersFromSearchParams(Object.fromEntries(url.searchParams)));

  return apiSuccess(await listLeads({ ...paging, filters }));
});

/**
 * Creates a lead manually. Duplicate detection applies, so posting a business
 * that already exists refreshes it rather than creating a second row.
 */
export const POST = withAuth(
  async (request, { user }) => {
    const body = await parseBody(request, createSchema);
    const settings = await getSettings();

    const website = body.website ? toAbsoluteUrl(body.website) : null;
    if (body.website && !website) return apiError('The website address could not be parsed.', 422);

    const outcome = await upsertBusinessAsLead(
      {
        externalId: '',
        name: body.businessName,
        primaryCategory: body.category ?? null,
        categories: body.category ? [body.category] : [],
        country: body.country ?? null,
        countryCode: null,
        region: body.region ?? null,
        city: body.city ?? null,
        postalCode: body.postalCode ?? null,
        address: body.address ?? null,
        latitude: null,
        longitude: null,
        phone: body.phone ?? null,
        website,
        email: body.email ?? null,
        rating: null,
        reviewCount: 0,
        ratingBreakdown: null,
        reviews: [],
        openNow: null,
        businessStatus: null,
        sourceUrl: null,
      },
      { provider: 'manual', settings, ownerId: user.id, source: 'manual' },
    );

    return apiSuccess(
      { lead: outcome.lead, created: outcome.created, duplicateOf: outcome.duplicateOf },
      { status: outcome.created ? 201 : 200 },
    );
  },
  { rateLimit: { key: 'leads:create', limit: 60, windowMs: 60_000 } },
);
