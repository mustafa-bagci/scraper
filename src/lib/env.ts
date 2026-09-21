import { z } from 'zod';

/**
 * Server-only environment configuration.
 *
 * Importing this module from a client component is a build error by design —
 * API keys must never reach the browser.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 characters. Generate with: openssl rand -base64 48'),

  ADMIN_EMAIL: z.string().email().default('admin@murgay.com'),
  ADMIN_PASSWORD: z.string().min(8).default('ChangeMe!2026'),

  BUSINESS_DATA_PROVIDER: z.enum(['mock', 'google-places', 'dataforseo']).default('mock'),
  BUSINESS_DATA_API_KEY: z.string().optional(),

  EMAIL_FINDER_PROVIDER: z.enum(['mock', 'website-crawler']).default('website-crawler'),
  EMAIL_FINDER_API_KEY: z.string().optional(),

  EMAIL_VERIFICATION_PROVIDER: z.enum(['none', 'mock', 'syntax']).default('none'),
  EMAIL_VERIFICATION_API_KEY: z.string().optional(),

  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * A variable that exists but is blank means the same as one that was never
 * set — which is what a hosting dashboard produces the moment someone saves a
 * field without a value, or imports a `.env` with `KEY=""` in it. Zod applies
 * a default only for `undefined`, so blanks are stripped before parsing;
 * otherwise an empty box in a UI becomes a hard boot failure.
 */
function withoutBlanks(
  source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    result[key] = typeof value === 'string' && value.trim() === '' ? undefined : value;
  }
  return result;
}

/**
 * Validates an environment. Pure and uncached, so it can be exercised
 * directly — the blank-variable handling above is worth testing.
 */
export function parseEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(withoutBlanks(source));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => {
        const key = issue.path.join('.');
        const raw = source[key];
        const blank = typeof raw === 'string' && raw.trim() === '';
        return `  - ${key}: ${issue.message}${blank ? ' (the variable is set but empty — remove it or give it a value)' : ''}`;
      })
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }

  return parsed.data;
}

export function getEnv(): Env {
  if (cached) return cached;
  cached = parseEnv(process.env);
  return cached;
}

/** True when no paid provider credentials are configured anywhere. */
export function isDemoMode(): boolean {
  const env = getEnv();
  return env.BUSINESS_DATA_PROVIDER === 'mock';
}
