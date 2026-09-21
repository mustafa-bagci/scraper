import 'server-only';
import { z } from 'zod';
import { fetchJson } from '@/lib/providers/http';
import {
  type BusinessDataProvider,
  type BusinessSearchPage,
  type BusinessSearchParams,
  type NormalizedBusiness,
  type ProviderCapabilities,
  type ProviderReview,
  ProviderError,
  ProviderNotConfiguredError,
} from './BusinessDataProvider';
import type { RatingBreakdown } from '@/lib/reviews/stats';

const ENDPOINT = 'https://api.dataforseo.com/v3/business_data/business_listings/search/live';
const PAGE_SIZE = 100;

/**
 * Business data from DataForSEO's Business Listings database.
 *
 * This is the provider that makes the core workflow work: unlike the Places
 * API it publishes `rating_distribution`, the 1★–5★ breakdown the bad-review
 * filters and percentages are built on.
 *
 * Credentials are DataForSEO's API login and password, stored as one secret in
 * the form `login:password` and sent as HTTP Basic auth.
 *
 * Two things to know about the response mapping below: field names are read
 * defensively, and anything unrecognised is ignored rather than throwing, so a
 * schema change on their side degrades a field instead of breaking a search.
 */
export class DataForSEOProvider implements BusinessDataProvider {
  readonly id = 'dataforseo';
  readonly name = 'DataForSEO Business Listings';
  readonly capabilities: ProviderCapabilities = {
    reviewBreakdown: true,
    // The listings endpoint carries counts, not review text. Individual reviews
    // come from a separate, pricier endpoint that is not wired up here.
    reviewText: false,
    email: false,
    maxResultsPerSearch: 1000,
  };

  constructor(private readonly credentials: string | null) {}

  isConfigured(): boolean {
    return Boolean(this.credentials && this.credentials.includes(':'));
  }

  private authHeader(): string {
    if (!this.credentials) {
      throw new ProviderNotConfiguredError(
        this.id,
        'No DataForSEO credentials configured. Add them in Settings → Data Providers as login:password.',
      );
    }
    if (!this.credentials.includes(':')) {
      throw new ProviderNotConfiguredError(
        this.id,
        'DataForSEO credentials must be your API login and password joined by a colon, as login:password.',
      );
    }
    return `Basic ${Buffer.from(this.credentials, 'utf8').toString('base64')}`;
  }

  async searchBusinesses(params: BusinessSearchParams, pageToken?: string | null): Promise<BusinessSearchPage> {
    const offset = pageToken ? Number.parseInt(pageToken, 10) || 0 : 0;
    const remaining = Math.max(0, Math.min(params.limit, this.capabilities.maxResultsPerSearch) - offset);
    if (remaining === 0) return { businesses: [], nextPageToken: null, providerCalls: 0 };

    const payload = await this.post(buildTask(params, offset, Math.min(PAGE_SIZE, remaining)));
    const result = payload.tasks?.[0]?.result?.[0];
    const items = result?.items ?? [];

    const nextOffset = offset + items.length;
    const total = result?.total_count ?? nextOffset;
    const more = items.length > 0 && nextOffset < Math.min(total, params.limit);

    return {
      businesses: items.map((item) => this.normalize(item)),
      nextPageToken: more ? String(nextOffset) : null,
      providerCalls: 1,
    };
  }

  async getBusinessDetails(externalId: string): Promise<NormalizedBusiness | null> {
    const payload = await this.post({
      filters: [['place_id', '=', externalId]],
      limit: 1,
    });
    const item = payload.tasks?.[0]?.result?.[0]?.items?.[0];
    return item ? this.normalize(item) : null;
  }

  async getBusinessReviews(): Promise<ProviderReview[]> {
    // Review text lives behind a separate endpoint; the listings response only
    // carries counts. Returning [] keeps the UI honest — it reports review
    // details as unavailable rather than showing nothing with no explanation.
    return [];
  }

  /** Runs one minimal live query and returns the raw payload, for support. */
  async probe(): Promise<unknown> {
    return this.post({ limit: 1, filters: [['rating.votes_count', '>', 0]] });
  }

  private async post(task: Record<string, unknown>): Promise<DataForSeoResponse> {
    const response = await fetchJson<unknown>(ENDPOINT, {
      method: 'POST',
      headers: { authorization: this.authHeader() },
      // Every DataForSEO endpoint takes an array of tasks.
      body: [task],
      timeoutMs: 30000,
      maxRetries: 1,
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new ProviderError(this.id, 'DataForSEO rejected the credentials. Check the login and password.', {
          statusCode: 401,
        });
      }
      throw new ProviderError(this.id, response.error, {
        retryable: response.retryable,
        statusCode: response.status,
      });
    }

    const parsed = responseSchema.safeParse(response.data);
    if (!parsed.success) {
      console.error('[dataforseo] unexpected response shape', parsed.error.issues.slice(0, 5));
      throw new ProviderError(
        this.id,
        'DataForSEO returned a response this app could not read. The raw payload has been logged; run the provider test in Settings to see it.',
      );
    }

    const body = parsed.data;

    // DataForSEO reports failures in the body with HTTP 200.
    if (body.status_code !== 20000) {
      throw new ProviderError(this.id, `DataForSEO: ${body.status_message ?? `status ${body.status_code}`}`, {
        retryable: body.status_code >= 50000,
      });
    }

    const firstTask = body.tasks?.[0];
    if (firstTask && firstTask.status_code !== 20000) {
      throw new ProviderError(this.id, `DataForSEO: ${firstTask.status_message ?? `status ${firstTask.status_code}`}`, {
        retryable: firstTask.status_code >= 50000,
      });
    }

    return body;
  }

  private normalize(item: ListingItem): NormalizedBusiness {
    const info = item.address_info ?? {};
    const distribution = toBreakdown(item.rating_distribution);
    const website = normaliseUrl(item.url) ?? (item.domain ? `https://${item.domain}` : null);

    return {
      externalId: item.place_id ?? item.cid ?? '',
      name: item.title ?? 'Unknown business',
      primaryCategory: item.category ?? null,
      categories: [item.category, ...(item.additional_categories ?? [])].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ),
      country: info.country_code ?? null,
      countryCode: info.country_code ?? null,
      region: info.region ?? null,
      city: info.city ?? null,
      postalCode: info.zip ?? null,
      address: item.address ?? info.address ?? null,
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      phone: item.phone ?? null,
      website,
      email: null,
      rating: item.rating?.value ?? null,
      reviewCount: item.rating?.votes_count ?? 0,
      ratingBreakdown: distribution,
      reviews: [],
      openNow: null,
      businessStatus: item.is_claimed === false ? 'UNCLAIMED' : null,
      sourceUrl: item.check_url ?? (item.place_id ? `https://www.google.com/maps/place/?q=place_id:${item.place_id}` : null),
    };
  }
}

// --- request shaping ---------------------------------------------------------

/** Country names the operator is likely to type, mapped to ISO codes. */
const COUNTRY_CODES: Record<string, string> = {
  france: 'FR',
  belgique: 'BE',
  belgium: 'BE',
  belgie: 'BE',
  suisse: 'CH',
  switzerland: 'CH',
  luxembourg: 'LU',
  nederland: 'NL',
  netherlands: 'NL',
  deutschland: 'DE',
  germany: 'DE',
  espana: 'ES',
  spain: 'ES',
  italia: 'IT',
  italy: 'IT',
  'united kingdom': 'GB',
  turkiye: 'TR',
  turkey: 'TR',
};

export function toCountryCode(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  const normalised = trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return COUNTRY_CODES[normalised];
}

type Filter = [string, string, string | number];

/**
 * Builds one DataForSEO task.
 *
 * Location and rating constraints are pushed to the API so the operator is not
 * billed for records the filter engine would discard locally.
 */
export function buildTask(params: BusinessSearchParams, offset: number, limit: number): Record<string, unknown> {
  const filters: Filter[] = [];

  const country = toCountryCode(params.country);
  if (country) filters.push(['address_info.country_code', '=', country]);
  if (params.city) filters.push(['address_info.city', '=', params.city.trim()]);
  if (params.region) filters.push(['address_info.region', '=', params.region.trim()]);
  if (params.postalCode) filters.push(['address_info.zip', 'like', `${params.postalCode.trim()}%`]);

  const task: Record<string, unknown> = { limit, offset };

  // DataForSEO matches categories against its own taxonomy, so a free-text
  // keyword is sent as a title search instead.
  if (params.category) task.categories = [normaliseCategory(params.category)];
  if (params.keyword) task.title = params.keyword.trim();

  if (filters.length > 0) task.filters = joinFilters(filters);
  task.order_by = ['rating.votes_count,desc'];

  return task;
}

/** DataForSEO's filter arrays are interleaved with literal "and" separators. */
function joinFilters(filters: Filter[]): unknown[] {
  return filters.flatMap((filter, index) => (index === 0 ? [filter] : ['and', filter]));
}

function normaliseCategory(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');
}

function normaliseUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).toString();
  } catch {
    return null;
  }
}

/** `{"1": 18, "2": 13, ...}` → the app's breakdown, or null when absent. */
export function toBreakdown(distribution: Record<string, number | undefined> | null | undefined): RatingBreakdown | null {
  if (!distribution) return null;

  const read = (star: string) => {
    const value = distribution[star];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
  };

  const breakdown: RatingBreakdown = {
    oneStarCount: read('1'),
    twoStarCount: read('2'),
    threeStarCount: read('3'),
    fourStarCount: read('4'),
    fiveStarCount: read('5'),
  };

  const total =
    breakdown.oneStarCount +
    breakdown.twoStarCount +
    breakdown.threeStarCount +
    breakdown.fourStarCount +
    breakdown.fiveStarCount;

  // An all-zero distribution carries no information; reporting it as absent
  // keeps the UI honest instead of showing a fabricated 0% bad-review rate.
  return total > 0 ? breakdown : null;
}

// --- response shape ----------------------------------------------------------

const addressInfoSchema = z
  .object({
    address: z.string().nullish(),
    city: z.string().nullish(),
    zip: z.string().nullish(),
    region: z.string().nullish(),
    country_code: z.string().nullish(),
  })
  .partial()
  .passthrough();

const listingSchema = z
  .object({
    title: z.string().nullish(),
    category: z.string().nullish(),
    additional_categories: z.array(z.string()).nullish(),
    address: z.string().nullish(),
    address_info: addressInfoSchema.nullish(),
    place_id: z.string().nullish(),
    cid: z.string().nullish(),
    phone: z.string().nullish(),
    url: z.string().nullish(),
    domain: z.string().nullish(),
    latitude: z.number().nullish(),
    longitude: z.number().nullish(),
    is_claimed: z.boolean().nullish(),
    check_url: z.string().nullish(),
    rating: z
      .object({ value: z.number().nullish(), votes_count: z.number().nullish() })
      .partial()
      .passthrough()
      .nullish(),
    rating_distribution: z.record(z.number()).nullish(),
  })
  .passthrough();

const responseSchema = z
  .object({
    status_code: z.number(),
    status_message: z.string().nullish(),
    cost: z.number().nullish(),
    tasks: z
      .array(
        z
          .object({
            status_code: z.number(),
            status_message: z.string().nullish(),
            result: z
              .array(
                z
                  .object({
                    total_count: z.number().nullish(),
                    count: z.number().nullish(),
                    items: z.array(listingSchema).nullish(),
                  })
                  .passthrough(),
              )
              .nullish(),
          })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();

type DataForSeoResponse = z.infer<typeof responseSchema>;
type ListingItem = z.infer<typeof listingSchema>;
