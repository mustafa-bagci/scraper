/**
 * Environment parsing.
 *
 * A variable that is present but blank is the failure mode this suite exists
 * for: hosting dashboards produce it whenever a field is saved empty, or a
 * `.env` with `KEY=""` is imported, and it twice took a deployment down here.
 * Blank must mean absent.
 *
 * Run with: npm test:env
 */
import assert from 'node:assert/strict';
import { parseEnv } from '../src/lib/env';

let pass = 0;
const failures: string[] = [];
const t = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    pass += 1;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`FAIL  ${name} — ${(e as Error).message}`);
  }
};

const BASE = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  AUTH_SECRET: 'x'.repeat(48),
};

/** A complete environment with the given fields overridden. */
function build(overrides: Record<string, string | undefined>) {
  return { ...BASE, ...overrides } as Record<string, string | undefined>;
}

await t('blank provider variables fall back to their defaults', async () => {
  // Exactly the shape that broke a live deployment.
  const env = parseEnv(build({
    BUSINESS_DATA_PROVIDER: '',
    EMAIL_FINDER_PROVIDER: '',
    EMAIL_VERIFICATION_PROVIDER: '',
  }));
  assert.equal(env.BUSINESS_DATA_PROVIDER, 'mock');
  assert.equal(env.EMAIL_FINDER_PROVIDER, 'website-crawler');
  assert.equal(env.EMAIL_VERIFICATION_PROVIDER, 'none');
});

await t('whitespace counts as blank', async () => {
  assert.equal(parseEnv(build({ BUSINESS_DATA_PROVIDER: '   ' })).BUSINESS_DATA_PROVIDER, 'mock');
});

await t('blank optional values do not become empty strings', async () => {
  const env = parseEnv(build({ BUSINESS_DATA_API_KEY: '', NEXT_PUBLIC_APP_URL: '' }));
  assert.equal(env.BUSINESS_DATA_API_KEY, undefined);
  assert.equal(env.NEXT_PUBLIC_APP_URL, undefined);
});

await t('real values are still honoured', async () => {
  const env = parseEnv(build({
    BUSINESS_DATA_PROVIDER: 'google-places',
    BUSINESS_DATA_API_KEY: 'a-real-key',
    EMAIL_VERIFICATION_PROVIDER: 'syntax',
  }));
  assert.equal(env.BUSINESS_DATA_PROVIDER, 'google-places');
  assert.equal(env.BUSINESS_DATA_API_KEY, 'a-real-key');
  assert.equal(env.EMAIL_VERIFICATION_PROVIDER, 'syntax');
});

await t('an invalid value is still rejected', async () => {
  assert.throws(() => parseEnv(build({ BUSINESS_DATA_PROVIDER: 'yelp' })), /BUSINESS_DATA_PROVIDER/);
});

await t('a blank required variable says it is set but empty', async () => {
  assert.throws(() => parseEnv(build({ AUTH_SECRET: '' })), /set but empty/);
});

await t('a missing required variable is reported plainly', async () => {
  assert.throws(() => parseEnv(build({ AUTH_SECRET: undefined })), /AUTH_SECRET/);
});

await t('a short AUTH_SECRET is rejected', async () => {
  assert.throws(() => parseEnv(build({ AUTH_SECRET: 'too-short' })), /at least 32 characters/);
});

await t('a blank provider variable resolves to the demo provider', async () => {
  assert.equal(parseEnv(build({ BUSINESS_DATA_PROVIDER: '' })).BUSINESS_DATA_PROVIDER, 'mock');
  assert.equal(parseEnv(build({ BUSINESS_DATA_PROVIDER: 'google-places' })).BUSINESS_DATA_PROVIDER, 'google-places');
});

console.log(`\n${pass}/${pass + failures.length} environment checks passed`);
if (failures.length) process.exit(1);
