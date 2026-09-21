import { z } from 'zod';
import { apiSuccess, parseBody, withAuth } from '@/lib/api/handler';
import { getBusinessProvider } from '@/lib/providers/registry';
import { ProviderError } from '@/lib/providers/business/BusinessDataProvider';

const schema = z.object({
  country: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  /** Include the provider's raw payload, for checking the field mapping. */
  raw: z.boolean().optional(),
});

export const maxDuration = 60;

/**
 * Runs one minimal live query against the configured business provider.
 *
 * It exists so a mapping can be checked against a real account without server
 * logs: it reports what the app understood, and optionally the raw payload it
 * understood it from.
 */
export const POST = withAuth(
  async (request) => {
    const body = await parseBody(request, schema);
    const provider = await getBusinessProvider();

    if (!provider.isConfigured()) {
      return apiSuccess({
        ok: false,
        provider: { id: provider.id, name: provider.name },
        error: 'This provider has no credentials configured yet.',
      });
    }

    const started = Date.now();
    try {
      const page = await provider.searchBusinesses({
        country: body.country,
        city: body.city,
        category: body.category,
        limit: 1,
      });

      const first = page.businesses[0];

      return apiSuccess({
        ok: true,
        provider: { id: provider.id, name: provider.name, capabilities: provider.capabilities },
        ms: Date.now() - started,
        returned: page.businesses.length,
        // What the app made of the record — the fields that drive the product.
        sample: first
          ? {
              externalId: first.externalId,
              name: first.name,
              category: first.primaryCategory,
              city: first.city,
              country: first.country,
              postalCode: first.postalCode,
              phone: first.phone,
              website: first.website,
              rating: first.rating,
              reviewCount: first.reviewCount,
              ratingBreakdown: first.ratingBreakdown,
              reviewBreakdownAvailable: first.ratingBreakdown !== null,
              sourceUrl: first.sourceUrl,
            }
          : null,
        ...(body.raw && provider.probe ? { raw: await provider.probe() } : {}),
      });
    } catch (error) {
      console.error('[provider-test] failed', error);
      return apiSuccess({
        ok: false,
        provider: { id: provider.id, name: provider.name },
        ms: Date.now() - started,
        error:
          error instanceof ProviderError
            ? error.message
            : 'The provider call failed. The details have been logged on the server.',
      });
    }
  },
  { rateLimit: { key: 'provider:test', limit: 20, windowMs: 60_000 } },
);
