import type { ScoringMetric, ScoringRule, ScoringSettings } from '@/types/settings';

export type ScorableLead = {
  rating: number | null;
  reviewCount: number;
  badReviewCount: number;
  badReviewPercentage: number;
  email: string | null;
  website: string | null;
  phone: string | null;
};

export type ScoreContribution = {
  ruleId: string;
  label: string;
  detail: string;
  points: number;
  matched: boolean;
};

export type ScoreResult = {
  score: number;
  maxScore: number;
  contributions: ScoreContribution[];
  /** Only the rules that fired — what the "Why?" panel shows. */
  matched: ScoreContribution[];
};

/**
 * Deterministic, fully explainable lead scoring.
 *
 * Every point on the board traces back to one operator-defined rule; there is
 * no model, no heuristic blend and no hidden weighting.
 */
export function scoreLead(lead: ScorableLead, settings: ScoringSettings): ScoreResult {
  const contributions: ScoreContribution[] = [];
  let raw = 0;

  for (const rule of settings.rules) {
    if (!rule.enabled) continue;
    const actual = metricValue(lead, rule.metric);
    const matched = evaluate(actual, rule);
    if (matched) raw += rule.points;
    contributions.push({
      ruleId: rule.id,
      label: rule.label,
      detail: describeActual(lead, rule.metric),
      points: rule.points,
      matched,
    });
  }

  const score = clamp(Math.round(raw), 0, settings.maxScore);
  return {
    score,
    maxScore: settings.maxScore,
    contributions,
    matched: contributions.filter((c) => c.matched),
  };
}

/** Human-readable "Why this lead matches" bullets, generated from the rules. */
export function matchReasons(result: ScoreResult): string[] {
  return result.matched.map((c) => `${c.label} — ${c.detail}`);
}

function evaluate(actual: number | boolean | null, rule: ScoringRule): boolean {
  if (rule.operator === 'isTrue') return actual === true;
  if (typeof actual !== 'number' || rule.value === undefined) return false;
  switch (rule.operator) {
    case 'lte':
      return actual <= rule.value;
    case 'gte':
      return actual >= rule.value;
    case 'lt':
      return actual < rule.value;
    case 'gt':
      return actual > rule.value;
    default:
      return false;
  }
}

function metricValue(lead: ScorableLead, metric: ScoringMetric): number | boolean | null {
  switch (metric) {
    case 'rating':
      return lead.rating;
    case 'reviewCount':
      return lead.reviewCount;
    case 'badReviewCount':
      return lead.badReviewCount;
    case 'badReviewPercentage':
      return lead.badReviewPercentage;
    case 'hasEmail':
      return Boolean(lead.email);
    case 'hasWebsite':
      return Boolean(lead.website);
    case 'hasPhone':
      return Boolean(lead.phone);
    default:
      return null;
  }
}

function describeActual(lead: ScorableLead, metric: ScoringMetric): string {
  switch (metric) {
    case 'rating':
      return lead.rating === null ? 'No rating' : `Rating ${lead.rating.toFixed(1)}`;
    case 'reviewCount':
      return `${lead.reviewCount.toLocaleString('en-US')} reviews`;
    case 'badReviewCount':
      return `${lead.badReviewCount.toLocaleString('en-US')} bad reviews`;
    case 'badReviewPercentage':
      return `${lead.badReviewPercentage.toFixed(1)}% bad reviews`;
    // Booleans show the value itself rather than restating the rule label.
    case 'hasEmail':
      return lead.email ?? 'No public email';
    case 'hasWebsite':
      return lead.website ? hostOf(lead.website) : 'No website';
    case 'hasPhone':
      return lead.phone ?? 'No phone';
    default:
      return '';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Serialisable form stored on `Lead.scoreBreakdown`. */
export type StoredScoreBreakdown = {
  score: number;
  maxScore: number;
  contributions: ScoreContribution[];
  computedAt: string;
};

export function toStoredBreakdown(result: ScoreResult): StoredScoreBreakdown {
  return {
    score: result.score,
    maxScore: result.maxScore,
    contributions: result.contributions,
    computedAt: new Date().toISOString(),
  };
}

export function parseStoredBreakdown(value: unknown): StoredScoreBreakdown | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoredScoreBreakdown>;
  if (typeof candidate.score !== 'number' || !Array.isArray(candidate.contributions)) return null;
  return {
    score: candidate.score,
    maxScore: typeof candidate.maxScore === 'number' ? candidate.maxScore : 100,
    contributions: candidate.contributions,
    computedAt: typeof candidate.computedAt === 'string' ? candidate.computedAt : new Date(0).toISOString(),
  };
}
