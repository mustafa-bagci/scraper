import type { RatingBreakdown } from '@/lib/reviews/stats';

/**
 * The contract every business-data source must satisfy.
 *
 * Nothing above this layer knows which vendor answered. Adding DataForSEO,
 * SerpApi, Outscraper or Apify later means writing one new class here and
 * registering it — no application or UI changes.
 */

export type ProviderReview = {
  externalId: string | null;
  rating: number;
  text: string | null;
  authorName: string | null;
  publishedAt: Date | null;
  language: string | null;
  sourceUrl: string | null;
};

export type NormalizedBusiness = {
  externalId: string;
  name: string;
  primaryCategory: string | null;
  categories: string[];

  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  postalCode: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;

  phone: string | null;
  website: string | null;
  email: string | null;

  rating: number | null;
  reviewCount: number;
  /** `null` when the source cannot supply a star distribution — never faked. */
  ratingBreakdown: RatingBreakdown | null;
  reviews: ProviderReview[];

  openNow: boolean | null;
  businessStatus: string | null;
  sourceUrl: string | null;
};

export type BusinessSearchParams = {
  country?: string;
  region?: string;
  city?: string;
  postalCode?: string;
  category?: string;
  keyword?: string;
  openNow?: boolean;
  /** Hard ceiling on records to return; the runner also applies cost limits. */
  limit: number;
};

export type BusinessSearchPage = {
  businesses: NormalizedBusiness[];
  nextPageToken: string | null;
  /** Billable provider requests consumed by this page, for cost reporting. */
  providerCalls: number;
};

export type ProviderCapabilities = {
  /** Can supply a full 1★–5★ distribution. */
  reviewBreakdown: boolean;
  /** Can supply individual review text. */
  reviewText: boolean;
  /** Can supply a business email directly. */
  email: boolean;
  /** Approximate maximum records per search. */
  maxResultsPerSearch: number;
};

export interface BusinessDataProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  /** True when the provider has everything it needs to make live calls. */
  isConfigured(): boolean;

  searchBusinesses(params: BusinessSearchParams, pageToken?: string | null): Promise<BusinessSearchPage>;

  getBusinessDetails(externalId: string): Promise<NormalizedBusiness | null>;

  getBusinessReviews(externalId: string): Promise<ProviderReview[]>;
}

/** Errors surfaced to the operator without leaking keys or stack traces. */
export class ProviderError extends Error {
  readonly providerId: string;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(
    providerId: string,
    message: string,
    options: { retryable?: boolean; statusCode?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
    this.providerId = providerId;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode;
  }
}

export class ProviderNotConfiguredError extends ProviderError {
  constructor(providerId: string, detail: string) {
    super(providerId, detail, { retryable: false });
    this.name = 'ProviderNotConfiguredError';
  }
}
