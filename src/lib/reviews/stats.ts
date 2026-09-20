import type { ReviewSettings } from '@/types/settings';

export type RatingBreakdown = {
  oneStarCount: number;
  twoStarCount: number;
  threeStarCount: number;
  fourStarCount: number;
  fiveStarCount: number;
};

export type ReviewStats = RatingBreakdown & {
  reviewCount: number;
  badReviewCount: number;
  badReviewPercentage: number;
  /**
   * False when the data source only gave us a total and an average, in which
   * case the UI must say so rather than invent a distribution.
   */
  breakdownAvailable: boolean;
};

const STAR_KEYS = {
  1: 'oneStarCount',
  2: 'twoStarCount',
  3: 'threeStarCount',
  4: 'fourStarCount',
  5: 'fiveStarCount',
} as const satisfies Record<number, keyof RatingBreakdown>;

export const EMPTY_BREAKDOWN: RatingBreakdown = {
  oneStarCount: 0,
  twoStarCount: 0,
  threeStarCount: 0,
  fourStarCount: 0,
  fiveStarCount: 0,
};

/**
 * Derives review statistics from a rating breakdown.
 *
 * `badReviewCount` is the sum of the star buckets the operator flagged as bad
 * in Settings (1★ and 2★ by default) — never hard-coded.
 */
export function computeReviewStats(
  breakdown: Partial<RatingBreakdown> | null | undefined,
  totalReviewCount: number,
  settings: Pick<ReviewSettings, 'badReviewStars'>,
): ReviewStats {
  const counts: RatingBreakdown = { ...EMPTY_BREAKDOWN, ...(breakdown ?? {}) };
  const breakdownTotal =
    counts.oneStarCount +
    counts.twoStarCount +
    counts.threeStarCount +
    counts.fourStarCount +
    counts.fiveStarCount;

  const breakdownAvailable = breakdownTotal > 0;
  const reviewCount = Math.max(totalReviewCount, 0);

  if (!breakdownAvailable) {
    return {
      ...EMPTY_BREAKDOWN,
      reviewCount,
      badReviewCount: 0,
      badReviewPercentage: 0,
      breakdownAvailable: false,
    };
  }

  const stars = normaliseStars(settings.badReviewStars);
  const badReviewCount = stars.reduce((sum, star) => sum + counts[STAR_KEYS[star]], 0);
  const denominator = reviewCount > 0 ? reviewCount : breakdownTotal;
  const badReviewPercentage = denominator > 0 ? round2((badReviewCount / denominator) * 100) : 0;

  return {
    ...counts,
    reviewCount: reviewCount > 0 ? reviewCount : breakdownTotal,
    badReviewCount,
    badReviewPercentage,
    breakdownAvailable: true,
  };
}

/** Builds a rating breakdown from a list of individual review ratings. */
export function breakdownFromReviews(ratings: number[]): RatingBreakdown {
  const counts: RatingBreakdown = { ...EMPTY_BREAKDOWN };
  for (const rating of ratings) {
    const star = Math.round(rating);
    if (star >= 1 && star <= 5) counts[STAR_KEYS[star as 1 | 2 | 3 | 4 | 5]] += 1;
  }
  return counts;
}

export function badReviewLabel(stars: number[]): string {
  const sorted = normaliseStars(stars);
  if (sorted.length === 0) return 'none';
  return sorted.map((s) => `${s}★`).join(' + ');
}

function normaliseStars(stars: number[]): Array<1 | 2 | 3 | 4 | 5> {
  return Array.from(new Set(stars))
    .filter((s): s is 1 | 2 | 3 | 4 | 5 => s >= 1 && s <= 5 && Number.isInteger(s))
    .sort((a, b) => a - b);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
