import type {
  BusinessDataProvider,
  BusinessSearchPage,
  BusinessSearchParams,
  NormalizedBusiness,
  ProviderCapabilities,
  ProviderReview,
} from './BusinessDataProvider';
import { MOCK_AUTHORS, MOCK_CATEGORIES, MOCK_CITIES, MOCK_REVIEW_TEXTS, MOCK_STREETS } from './mock-data';
import type { RatingBreakdown } from '@/lib/reviews/stats';

const PAGE_SIZE = 20;

/**
 * Fully offline business-data provider.
 *
 * Generates deterministic synthetic records so the whole application — search,
 * scoring, review intelligence, export — is demonstrable without any paid API
 * key. Re-running the same search yields the same businesses, which also makes
 * duplicate detection observable.
 */
export class MockBusinessProvider implements BusinessDataProvider {
  readonly id = 'mock';
  readonly name = 'Mock provider (demo data)';
  readonly capabilities: ProviderCapabilities = {
    reviewBreakdown: true,
    reviewText: true,
    email: false,
    maxResultsPerSearch: 500,
    resultsPerRequest: PAGE_SIZE,
    // Demo data costs nothing.
    pricing: null,
  };

  isConfigured(): boolean {
    return true;
  }

  async searchBusinesses(params: BusinessSearchParams, pageToken?: string | null): Promise<BusinessSearchPage> {
    const offset = pageToken ? Number.parseInt(pageToken, 10) || 0 : 0;
    const total = Math.min(params.limit, this.capabilities.maxResultsPerSearch);
    const take = Math.min(PAGE_SIZE, Math.max(0, total - offset));

    // Simulated provider latency keeps the job UI honest during development.
    await delay(120);

    const businesses: NormalizedBusiness[] = [];
    for (let i = 0; i < take; i += 1) {
      businesses.push(this.generate(params, offset + i));
    }

    const nextOffset = offset + take;
    return {
      businesses,
      nextPageToken: nextOffset < total && take > 0 ? String(nextOffset) : null,
      providerCalls: 1,
    };
  }

  async getBusinessDetails(externalId: string): Promise<NormalizedBusiness | null> {
    const parsed = parseExternalId(externalId);
    if (!parsed) return null;
    return this.generate(parsed.params, parsed.index);
  }

  async getBusinessReviews(externalId: string): Promise<ProviderReview[]> {
    const business = await this.getBusinessDetails(externalId);
    return business?.reviews ?? [];
  }

  private generate(params: BusinessSearchParams, index: number): NormalizedBusiness {
    const seedBase = `${params.country ?? ''}|${params.region ?? ''}|${params.city ?? ''}|${params.category ?? ''}|${params.keyword ?? ''}`;
    const rng = mulberry32(hashString(`${seedBase}#${index}`));

    const city = pickCity(params, rng);
    const category = pickCategory(params, rng);

    const root = pick(category.roots, rng);
    const pattern = pick(category.namePatterns, rng);
    const suffix = index >= category.roots.length * category.namePatterns.length ? ` ${city.name}` : '';
    const name = `${pattern.replace('{root}', root)}${suffix}`;

    const rating = shapeRating(category.ratingCentre, rng);
    const reviewCount = shapeReviewCount(rng);
    const breakdown = shapeBreakdown(rating, reviewCount, rng);

    const slug = slugify(name);
    const hasWebsite = rng() > 0.12;
    const website = hasWebsite ? `https://${slug}.example` : null;
    const hasPhone = rng() > 0.05;

    const streetNumber = 1 + Math.floor(rng() * 180);
    const street = pick(MOCK_STREETS, rng);
    const postalCode = `${city.postalPrefix}${String(1 + Math.floor(rng() * 20)).padStart(2, '0')}`;
    const address = `${streetNumber} ${street}, ${postalCode} ${city.name}`;

    const externalId = buildExternalId(seedBase, index);

    return {
      externalId,
      name,
      primaryCategory: category.label,
      categories: [category.label],
      country: city.country,
      countryCode: city.countryCode,
      region: city.region,
      city: city.name,
      postalCode,
      address,
      latitude: round(city.lat + (rng() - 0.5) * 0.08, 6),
      longitude: round(city.lng + (rng() - 0.5) * 0.08, 6),
      phone: hasPhone ? formatPhone(city.countryCode, rng) : null,
      website,
      email: null,
      rating,
      reviewCount,
      ratingBreakdown: breakdown,
      reviews: buildReviews(breakdown, externalId, rng),
      openNow: rng() > 0.25,
      businessStatus: 'OPERATIONAL',
      sourceUrl: `https://directory.example/business/${slug}`,
    };
  }
}

// --- generation helpers -----------------------------------------------------

function buildExternalId(seedBase: string, index: number): string {
  return `mock_${hashString(seedBase).toString(36)}_${index}`;
}

function parseExternalId(externalId: string): { params: BusinessSearchParams; index: number } | null {
  const match = /^mock_([a-z0-9]+)_(\d+)$/.exec(externalId);
  if (!match) return null;
  // The seed hash is not reversible; details are regenerated from the stored
  // lead in practice. This path keeps the interface honest for direct lookups.
  return { params: { limit: 1 }, index: Number.parseInt(match[2] ?? '0', 10) };
}

function pickCity(params: BusinessSearchParams, rng: () => number) {
  const wanted = params.city?.trim().toLowerCase();
  const country = params.country?.trim().toLowerCase();

  let pool = MOCK_CITIES;
  if (country) {
    const filtered = pool.filter(
      (c) => c.country.toLowerCase() === country || c.countryCode.toLowerCase() === country,
    );
    if (filtered.length) pool = filtered;
  }
  if (wanted) {
    const match = pool.find((c) => c.name.toLowerCase() === wanted);
    if (match) return match;
    const first = pool[0] ?? MOCK_CITIES[0]!;
    // Honour an unknown city name so the operator sees what they searched for.
    return { ...first, name: capitalise(params.city!.trim()) };
  }
  return pick(pool, rng);
}

function pickCategory(params: BusinessSearchParams, rng: () => number) {
  const wanted = (params.category ?? params.keyword ?? '').trim().toLowerCase();
  if (wanted) {
    const match = MOCK_CATEGORIES.find(
      (c) => c.label.toLowerCase() === wanted || c.slug === wanted || c.label.toLowerCase().includes(wanted),
    );
    if (match) return match;
    const base = pick(MOCK_CATEGORIES, rng);
    return { ...base, label: capitalise(wanted) };
  }
  return pick(MOCK_CATEGORIES, rng);
}

function shapeRating(centre: number, rng: () => number): number {
  // Skewed towards the trade's centre with a long tail of poor performers —
  // the tail is what makes the platform useful.
  const spread = (rng() + rng() + rng()) / 3 - 0.5;
  const value = centre + spread * 2.4;
  return round(clamp(value, 2.2, 5), 1);
}

function shapeReviewCount(rng: () => number): number {
  const roll = rng();
  if (roll < 0.25) return 5 + Math.floor(rng() * 40);
  if (roll < 0.7) return 45 + Math.floor(rng() * 180);
  if (roll < 0.93) return 220 + Math.floor(rng() * 400);
  return 620 + Math.floor(rng() * 900);
}

function shapeBreakdown(rating: number, total: number, rng: () => number): RatingBreakdown {
  // Distribute reviews so the weighted mean lands near the published rating.
  const weights = [1, 2, 3, 4, 5].map((star) => {
    const distance = Math.abs(star - rating);
    return Math.exp(-distance * 1.35) + rng() * 0.04;
  });
  const sum = weights.reduce((a, b) => a + b, 0);

  const counts = weights.map((w) => Math.floor((w / sum) * total));
  let assigned = counts.reduce((a, b) => a + b, 0);
  let cursor = 0;
  while (assigned < total) {
    counts[cursor % 5] = (counts[cursor % 5] ?? 0) + 1;
    assigned += 1;
    cursor += 1;
  }

  return {
    oneStarCount: counts[0] ?? 0,
    twoStarCount: counts[1] ?? 0,
    threeStarCount: counts[2] ?? 0,
    fourStarCount: counts[3] ?? 0,
    fiveStarCount: counts[4] ?? 0,
  };
}

function buildReviews(breakdown: RatingBreakdown, externalId: string, rng: () => number): ProviderReview[] {
  const plan: Array<[number, number]> = [
    [1, Math.min(breakdown.oneStarCount, 4)],
    [2, Math.min(breakdown.twoStarCount, 3)],
    [3, Math.min(breakdown.threeStarCount, 2)],
    [4, Math.min(breakdown.fourStarCount, 2)],
    [5, Math.min(breakdown.fiveStarCount, 2)],
  ];

  const reviews: ProviderReview[] = [];
  for (const [star, count] of plan) {
    for (let i = 0; i < count; i += 1) {
      const band = star <= 2 ? 'low' : star === 3 ? 'mid' : 'high';
      const daysAgo = 3 + Math.floor(rng() * 640);
      reviews.push({
        externalId: `${externalId}_r${star}_${i}`,
        rating: star,
        text: pick(MOCK_REVIEW_TEXTS[band], rng),
        authorName: pick(MOCK_AUTHORS, rng),
        publishedAt: new Date(Date.now() - daysAgo * 86_400_000),
        language: 'fr',
        sourceUrl: null,
      });
    }
  }

  return reviews.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
}

function formatPhone(countryCode: string, rng: () => number): string {
  const digits = (n: number) =>
    Array.from({ length: n }, () => Math.floor(rng() * 10))
      .join('')
      .replace(/(\d{2})(?=\d)/g, '$1 ');
  return countryCode === 'BE' ? `+32 ${digits(8)}`.trim() : `+33 ${1 + Math.floor(rng() * 5)} ${digits(8)}`.trim();
}

// --- small deterministic utilities -----------------------------------------

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length) % items.length] as T;
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
