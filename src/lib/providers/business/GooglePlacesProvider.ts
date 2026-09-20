import 'server-only';
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

const BASE_URL = 'https://places.googleapis.com/v1';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.currentOpeningHours.openNow',
  'places.googleMapsUri',
  'places.reviews',
  'nextPageToken',
].join(',');

const DETAILS_FIELD_MASK = FIELD_MASK.split(',')
  .filter((f) => f.startsWith('places.'))
  .map((f) => f.replace(/^places\./, ''))
  .join(',');

type PlacesTextSearchResponse = {
  places?: PlaceResource[];
  nextPageToken?: string;
};

type PlaceResource = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  location?: { latitude?: number; longitude?: number };
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  currentOpeningHours?: { openNow?: boolean };
  googleMapsUri?: string;
  reviews?: Array<{
    name?: string;
    rating?: number;
    text?: { text?: string };
    originalText?: { text?: string };
    authorAttribution?: { displayName?: string };
    publishTime?: string;
    languageCode?: string;
  }>;
};

/**
 * Business data from the Google Places API (New), used strictly through the
 * documented, billable endpoints with an API key.
 *
 * Deliberate honesty about limits: the API returns an average rating, a total
 * rating count and at most a handful of reviews. It does NOT expose a 1★–5★
 * distribution, so `ratingBreakdown` is `null` and the UI reports the
 * breakdown as unavailable rather than inventing one.
 */
export class GooglePlacesProvider implements BusinessDataProvider {
  readonly id = 'google-places';
  readonly name = 'Google Places API';
  readonly capabilities: ProviderCapabilities = {
    reviewBreakdown: false,
    reviewText: true,
    email: false,
    maxResultsPerSearch: 60,
  };

  constructor(private readonly apiKey: string | null) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private requireKey(): string {
    if (!this.apiKey) {
      throw new ProviderNotConfiguredError(
        this.id,
        'No API key configured for the Google Places provider. Add one in Settings → Data Providers.',
      );
    }
    return this.apiKey;
  }

  async searchBusinesses(params: BusinessSearchParams, pageToken?: string | null): Promise<BusinessSearchPage> {
    const key = this.requireKey();

    const response = await fetchJson<PlacesTextSearchResponse>(`${BASE_URL}/places:searchText`, {
      method: 'POST',
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
      body: {
        textQuery: buildTextQuery(params),
        pageSize: Math.min(20, params.limit),
        ...(pageToken ? { pageToken } : {}),
        ...(params.openNow ? { openNow: true } : {}),
      },
      timeoutMs: 20000,
    });

    if (!response.ok) {
      throw new ProviderError(this.id, response.error, {
        retryable: response.retryable,
        statusCode: response.status,
      });
    }

    return {
      businesses: (response.data.places ?? []).map((place) => this.normalize(place)),
      nextPageToken: response.data.nextPageToken ?? null,
      providerCalls: 1,
    };
  }

  async getBusinessDetails(externalId: string): Promise<NormalizedBusiness | null> {
    const key = this.requireKey();
    const response = await fetchJson<PlaceResource>(`${BASE_URL}/places/${encodeURIComponent(externalId)}`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': DETAILS_FIELD_MASK },
      timeoutMs: 15000,
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new ProviderError(this.id, response.error, {
        retryable: response.retryable,
        statusCode: response.status,
      });
    }

    return this.normalize(response.data);
  }

  async getBusinessReviews(externalId: string): Promise<ProviderReview[]> {
    const details = await this.getBusinessDetails(externalId);
    return details?.reviews ?? [];
  }

  private normalize(place: PlaceResource): NormalizedBusiness {
    const components = place.addressComponents ?? [];
    const component = (type: string) => components.find((c) => c.types?.includes(type));

    return {
      externalId: place.id,
      name: place.displayName?.text ?? 'Unknown business',
      primaryCategory: place.primaryTypeDisplayName?.text ?? place.types?.[0] ?? null,
      categories: place.types ?? [],
      country: component('country')?.longText ?? null,
      countryCode: component('country')?.shortText ?? null,
      region: component('administrative_area_level_1')?.longText ?? null,
      city: component('locality')?.longText ?? component('postal_town')?.longText ?? null,
      postalCode: component('postal_code')?.longText ?? null,
      address: place.formattedAddress ?? null,
      latitude: place.location?.latitude ?? null,
      longitude: place.location?.longitude ?? null,
      phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
      website: place.websiteUri ?? null,
      email: null,
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount ?? 0,
      // Not exposed by the API — never fabricated.
      ratingBreakdown: null,
      reviews: (place.reviews ?? []).map((review) => ({
        externalId: review.name ?? null,
        rating: review.rating ?? 0,
        text: review.originalText?.text ?? review.text?.text ?? null,
        authorName: review.authorAttribution?.displayName ?? null,
        publishedAt: review.publishTime ? new Date(review.publishTime) : null,
        language: review.languageCode ?? null,
        sourceUrl: place.googleMapsUri ?? null,
      })),
      openNow: place.currentOpeningHours?.openNow ?? null,
      businessStatus: place.businessStatus ?? null,
      sourceUrl: place.googleMapsUri ?? null,
    };
  }
}

function buildTextQuery(params: BusinessSearchParams): string {
  return [params.category, params.keyword, params.postalCode, params.city, params.region, params.country]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ')
    .trim();
}
