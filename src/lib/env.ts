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

  BUSINESS_DATA_PROVIDER: z.enum(['mock', 'google-places']).default('mock'),
  BUSINESS_DATA_API_KEY: z.string().optional(),

  EMAIL_FINDER_PROVIDER: z.enum(['mock', 'website-crawler']).default('website-crawler'),
  EMAIL_FINDER_API_KEY: z.string().optional(),

  EMAIL_VERIFICATION_PROVIDER: z.enum(['none', 'mock', 'syntax']).default('none'),
  EMAIL_VERIFICATION_API_KEY: z.string().optional(),

  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }

  cached = parsed.data;
  return cached;
}

/** True when no paid provider credentials are configured anywhere. */
export function isDemoMode(): boolean {
  const env = getEnv();
  return env.BUSINESS_DATA_PROVIDER === 'mock';
}
