import { EmailStatus, LeadStatus } from '@prisma/client';
import { leadQuerySchema, type LeadFilters, type LeadQuery } from '@/types/filters';

/**
 * URL ⇄ filter-object serialisation.
 *
 * Keeping the lead list's state in the URL makes every view shareable,
 * bookmarkable and back-button friendly, and lets server components read the
 * filters without any client round-trip.
 */

const RANGE_KEYS = [
  'rating',
  'reviewCount',
  'badReviewCount',
  'badReviewPercentage',
  'oneStarCount',
  'twoStarCount',
  'leadScore',
] as const;

const TEXT_KEYS = ['country', 'region', 'city', 'postalCode', 'category', 'keyword'] as const;
const PRESENCE_KEYS = ['website', 'email', 'phone'] as const;

export function filtersToSearchParams(filters: LeadFilters): URLSearchParams {
  const params = new URLSearchParams();

  for (const key of TEXT_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }

  for (const key of RANGE_KEYS) {
    const range = filters[key];
    if (range?.min !== undefined) params.set(`${key}Min`, String(range.min));
    if (range?.max !== undefined) params.set(`${key}Max`, String(range.max));
  }

  for (const key of PRESENCE_KEYS) {
    const value = filters[key];
    if (value && value !== 'any') params.set(key, value);
  }

  if (filters.status?.length) params.set('status', filters.status.join(','));
  if (filters.emailStatus?.length) params.set('emailStatus', filters.emailStatus.join(','));
  if (filters.openNow !== undefined) params.set('openNow', String(filters.openNow));
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));

  return params;
}

type RawParams = Record<string, string | string[] | undefined>;

export function filtersFromSearchParams(raw: RawParams): LeadFilters {
  const single = (key: string): string | undefined => {
    const value = raw[key];
    const text = Array.isArray(value) ? value[0] : value;
    return text && text.trim() ? text.trim() : undefined;
  };

  const number = (key: string): number | undefined => {
    const value = single(key);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const filters: LeadFilters = {};

  for (const key of TEXT_KEYS) {
    const value = single(key);
    if (value) filters[key] = value;
  }

  for (const key of RANGE_KEYS) {
    const min = number(`${key}Min`);
    const max = number(`${key}Max`);
    if (min !== undefined || max !== undefined) filters[key] = { min, max };
  }

  for (const key of PRESENCE_KEYS) {
    const value = single(key);
    if (value === 'required' || value === 'missing') filters[key] = value;
  }

  const status = single('status');
  if (status) {
    const values = status
      .split(',')
      .map((item) => item.trim())
      .filter((item): item is LeadStatus => item in LeadStatus);
    if (values.length) filters.status = values;
  }

  const emailStatus = single('emailStatus');
  if (emailStatus) {
    const values = emailStatus
      .split(',')
      .map((item) => item.trim())
      .filter((item): item is EmailStatus => item in EmailStatus);
    if (values.length) filters.emailStatus = values;
  }

  const openNow = single('openNow');
  if (openNow === 'true' || openNow === 'false') filters.openNow = openNow === 'true';

  const limit = number('limit');
  if (limit !== undefined) filters.limit = limit;

  return filters;
}

export function queryFromSearchParams(raw: RawParams): LeadQuery {
  const single = (key: string): string | undefined => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return leadQuerySchema.parse({
    filters: filtersFromSearchParams(raw),
    sortBy: single('sortBy') ?? 'createdAt',
    sortDir: single('sortDir') ?? 'desc',
    page: single('page') ?? 1,
    pageSize: single('pageSize') ?? 25,
  });
}

export function queryToSearchParams(query: LeadQuery): URLSearchParams {
  const params = filtersToSearchParams(query.filters);
  if (query.sortBy !== 'createdAt') params.set('sortBy', query.sortBy);
  if (query.sortDir !== 'desc') params.set('sortDir', query.sortDir);
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.pageSize !== 25) params.set('pageSize', String(query.pageSize));
  return params;
}

/** Number of active constraints — drives the "Filters (3)" chip. */
export function countActiveFilters(filters: LeadFilters): number {
  let count = 0;
  for (const key of TEXT_KEYS) if (filters[key]) count += 1;
  for (const key of RANGE_KEYS) {
    const range = filters[key];
    if (range?.min !== undefined) count += 1;
    if (range?.max !== undefined) count += 1;
  }
  for (const key of PRESENCE_KEYS) if (filters[key] && filters[key] !== 'any') count += 1;
  if (filters.status?.length) count += 1;
  if (filters.emailStatus?.length) count += 1;
  if (filters.openNow !== undefined) count += 1;
  return count;
}
