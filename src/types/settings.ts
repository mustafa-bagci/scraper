import { z } from 'zod';

/**
 * Application settings. Every value here is operator-configurable from
 * /settings — nothing in the scoring or review logic is hard-coded.
 */

// --- Scoring ----------------------------------------------------------------

export const SCORING_METRICS = [
  'rating',
  'reviewCount',
  'badReviewCount',
  'badReviewPercentage',
  'hasEmail',
  'hasWebsite',
  'hasPhone',
] as const;
export type ScoringMetric = (typeof SCORING_METRICS)[number];

export const SCORING_OPERATORS = ['lte', 'gte', 'lt', 'gt', 'isTrue'] as const;
export type ScoringOperator = (typeof SCORING_OPERATORS)[number];

export const scoringRuleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(120),
  metric: z.enum(SCORING_METRICS),
  operator: z.enum(SCORING_OPERATORS),
  value: z.number().optional(),
  points: z.number().int().min(-100).max(100),
  enabled: z.boolean().default(true),
});
export type ScoringRule = z.infer<typeof scoringRuleSchema>;

export const scoringSettingsSchema = z.object({
  maxScore: z.number().int().min(1).max(1000).default(100),
  qualifiedThreshold: z.number().int().min(0).max(1000).default(60),
  rules: z.array(scoringRuleSchema).max(50),
});
export type ScoringSettings = z.infer<typeof scoringSettingsSchema>;

export const DEFAULT_SCORING: ScoringSettings = {
  maxScore: 100,
  qualifiedThreshold: 60,
  rules: [
    { id: 'rating-40', label: 'Rating ≤ 4.0', metric: 'rating', operator: 'lte', value: 4.0, points: 25, enabled: true },
    { id: 'rating-37', label: 'Rating ≤ 3.7', metric: 'rating', operator: 'lte', value: 3.7, points: 15, enabled: true },
    { id: 'reviews-100', label: 'Review count ≥ 100', metric: 'reviewCount', operator: 'gte', value: 100, points: 20, enabled: true },
    { id: 'reviews-300', label: 'Review count ≥ 300', metric: 'reviewCount', operator: 'gte', value: 300, points: 10, enabled: true },
    { id: 'bad-pct-10', label: 'Bad review percentage ≥ 10%', metric: 'badReviewPercentage', operator: 'gte', value: 10, points: 20, enabled: true },
    { id: 'has-email', label: 'Public email available', metric: 'hasEmail', operator: 'isTrue', points: 10, enabled: true },
    { id: 'has-website', label: 'Website available', metric: 'hasWebsite', operator: 'isTrue', points: 5, enabled: true },
    { id: 'has-phone', label: 'Phone available', metric: 'hasPhone', operator: 'isTrue', points: 5, enabled: true },
  ],
};

// --- Review rules -----------------------------------------------------------

export const reviewSettingsSchema = z.object({
  /** Which star ratings count as a "bad review". */
  badReviewStars: z.array(z.number().int().min(1).max(5)).min(1).max(5).default([1, 2]),
  /** Max reviews stored per lead. */
  maxStoredReviewsPerLead: z.number().int().min(0).max(500).default(50),
});
export type ReviewSettings = z.infer<typeof reviewSettingsSchema>;

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  badReviewStars: [1, 2],
  maxStoredReviewsPerLead: 50,
};

// --- Crawler ----------------------------------------------------------------

export const crawlerSettingsSchema = z.object({
  maxPagesPerDomain: z.number().int().min(1).max(25).default(5),
  timeoutMs: z.number().int().min(1000).max(60000).default(10000),
  maxResponseBytes: z.number().int().min(10_000).max(10_000_000).default(2_000_000),
  maxRedirects: z.number().int().min(0).max(10).default(3),
  respectRobotsTxt: z.boolean().default(true),
  requestDelayMs: z.number().int().min(0).max(10000).default(500),
  userAgent: z.string().min(5).max(200).default('MurgayLeadIntelligence/1.0 (+https://murgay.com/bot)'),
  preferGenericMailboxes: z.boolean().default(true),
});
export type CrawlerSettings = z.infer<typeof crawlerSettingsSchema>;

export const DEFAULT_CRAWLER_SETTINGS: CrawlerSettings = crawlerSettingsSchema.parse({});

// --- Cost control -----------------------------------------------------------

export const limitSettingsSchema = z.object({
  maxBusinessesPerSearch: z.number().int().min(1).max(1000).default(500),
  maxEmailLookupsPerDay: z.number().int().min(1).max(100000).default(500),
  maxVerificationsPerDay: z.number().int().min(1).max(100000).default(500),
  maxSearchesPerDay: z.number().int().min(1).max(10000).default(100),
  /** Indicative provider cost per 1 business record, operator-supplied. */
  estimatedCostPerBusiness: z.number().min(0).max(10).default(0.004),
  estimatedCostPerEmailLookup: z.number().min(0).max(10).default(0),
  currency: z.string().min(1).max(8).default('EUR'),
});
export type LimitSettings = z.infer<typeof limitSettingsSchema>;

export const DEFAULT_LIMITS: LimitSettings = limitSettingsSchema.parse({});

// --- General / export -------------------------------------------------------

export const generalSettingsSchema = z.object({
  organisationName: z.string().min(1).max(120).default('Murgay'),
  defaultCountry: z.string().max(120).default('France'),
  defaultResultLimit: z.number().int().min(1).max(1000).default(100),
  timezone: z.string().max(64).default('Europe/Paris'),
});
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;
export const DEFAULT_GENERAL: GeneralSettings = generalSettingsSchema.parse({});

export const exportSettingsSchema = z.object({
  defaultFormat: z.enum(['CSV', 'XLSX', 'JSON']).default('CSV'),
  csvDelimiter: z.enum([',', ';', '\t']).default(','),
  includeSourceUrls: z.boolean().default(true),
  maxRowsPerExport: z.number().int().min(1).max(100000).default(20000),
});
export type ExportSettings = z.infer<typeof exportSettingsSchema>;
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = exportSettingsSchema.parse({});

export const securitySettingsSchema = z.object({
  sessionTtlHours: z.number().int().min(1).max(720).default(72),
  /** Extra hostnames the crawler may never contact, on top of the built-in SSRF blocklist. */
  blockedHosts: z.array(z.string().max(255)).max(200).default([]),
});
export type SecuritySettings = z.infer<typeof securitySettingsSchema>;
export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = securitySettingsSchema.parse({});

// --- Registry ---------------------------------------------------------------

export const SETTING_KEYS = {
  general: 'general',
  scoring: 'scoring',
  reviews: 'reviews',
  crawler: 'crawler',
  limits: 'limits',
  export: 'export',
  security: 'security',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export type AppSettings = {
  general: GeneralSettings;
  scoring: ScoringSettings;
  reviews: ReviewSettings;
  crawler: CrawlerSettings;
  limits: LimitSettings;
  export: ExportSettings;
  security: SecuritySettings;
};

export const DEFAULT_SETTINGS: AppSettings = {
  general: DEFAULT_GENERAL,
  scoring: DEFAULT_SCORING,
  reviews: DEFAULT_REVIEW_SETTINGS,
  crawler: DEFAULT_CRAWLER_SETTINGS,
  limits: DEFAULT_LIMITS,
  export: DEFAULT_EXPORT_SETTINGS,
  security: DEFAULT_SECURITY_SETTINGS,
};

export const SETTINGS_SCHEMAS = {
  general: generalSettingsSchema,
  scoring: scoringSettingsSchema,
  reviews: reviewSettingsSchema,
  crawler: crawlerSettingsSchema,
  limits: limitSettingsSchema,
  export: exportSettingsSchema,
  security: securitySettingsSchema,
} as const;
