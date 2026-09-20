import { z } from 'zod';
import { EmailStatus, LeadStatus } from '@prisma/client';

/**
 * The single shared filter vocabulary.
 *
 * The same object drives business discovery (provider queries), lead list
 * filtering (SQL), saved searches, dashboard scoping and exports. Filtering
 * logic lives in `src/lib/filters` — never inline in a component.
 */

export const PRESENCE = ['any', 'required', 'missing'] as const;
export type Presence = (typeof PRESENCE)[number];

const presence = z.enum(PRESENCE).default('any');

const numericRange = z
  .object({
    min: z.coerce.number().optional(),
    max: z.coerce.number().optional(),
  })
  .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, {
    message: 'Minimum must be less than or equal to maximum',
  });

export const leadFiltersSchema = z.object({
  // Location & taxonomy
  country: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(24).optional(),
  category: z.string().trim().max(120).optional(),
  keyword: z.string().trim().max(200).optional(),

  // Review intelligence
  rating: numericRange.optional(),
  reviewCount: numericRange.optional(),
  badReviewCount: numericRange.optional(),
  badReviewPercentage: numericRange.optional(),
  oneStarCount: numericRange.optional(),
  twoStarCount: numericRange.optional(),

  // Contactability
  website: presence.optional(),
  email: presence.optional(),
  phone: presence.optional(),

  // Qualification
  leadScore: numericRange.optional(),
  status: z.array(z.nativeEnum(LeadStatus)).optional(),
  emailStatus: z.array(z.nativeEnum(EmailStatus)).optional(),

  // Operational
  openNow: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export type LeadFilters = z.infer<typeof leadFiltersSchema>;

export const EMPTY_FILTERS: LeadFilters = {};

export const SORTABLE_LEAD_FIELDS = [
  'businessName',
  'category',
  'city',
  'rating',
  'reviewCount',
  'badReviewCount',
  'badReviewPercentage',
  'leadScore',
  'status',
  'email',
  'createdAt',
  'updatedAt',
] as const;

export type SortableLeadField = (typeof SORTABLE_LEAD_FIELDS)[number];

export const leadQuerySchema = z.object({
  filters: leadFiltersSchema.default({}),
  sortBy: z.enum(SORTABLE_LEAD_FIELDS).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export type LeadQuery = z.infer<typeof leadQuerySchema>;

/** Human-readable one-line summary of a filter set, used in history & chips. */
export function describeFilters(filters: LeadFilters): string {
  const parts: string[] = [];
  if (filters.category) parts.push(filters.category);
  const place = [filters.city, filters.region, filters.country].filter(Boolean).join(', ');
  if (place) parts.push(place);
  if (filters.keyword) parts.push(`"${filters.keyword}"`);
  if (filters.rating?.max !== undefined) parts.push(`rating ≤ ${filters.rating.max}`);
  if (filters.rating?.min !== undefined) parts.push(`rating ≥ ${filters.rating.min}`);
  if (filters.reviewCount?.min !== undefined) parts.push(`${filters.reviewCount.min}+ reviews`);
  if (filters.badReviewCount?.min !== undefined) parts.push(`${filters.badReviewCount.min}+ bad reviews`);
  if (filters.email === 'required') parts.push('email required');
  if (filters.website === 'required') parts.push('website required');
  return parts.length ? parts.join(' · ') : 'All businesses';
}
