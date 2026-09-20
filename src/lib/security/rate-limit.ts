import 'server-only';
import { prisma } from '@/lib/db/prisma';

/**
 * Two complementary limiters:
 *
 *  - `checkRateLimit`  — in-process sliding window, protects the app from
 *    burst traffic (login attempts, search submissions, crawl requests).
 *  - `consumeDailyQuota` — durable per-day counters in Postgres, backing the
 *    operator's cost-control limits for paid provider calls.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limit: number;
};

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0, limit };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      limit,
    };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0, limit };
}

/** Periodically drop expired buckets so the map cannot grow unbounded. */
export function pruneRateLimits(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getDailyUsage(scope: string): Promise<number> {
  const row = await prisma.usageCounter.findUnique({ where: { scope_day: { scope, day: today() } } });
  return row?.count ?? 0;
}

export type QuotaResult = { allowed: boolean; used: number; limit: number; remaining: number };

/**
 * Atomically reserves `amount` units of a daily quota. Returns `allowed:false`
 * without consuming anything when the limit would be exceeded.
 */
export async function consumeDailyQuota(scope: string, limit: number, amount = 1): Promise<QuotaResult> {
  const day = today();
  const current = await prisma.usageCounter.upsert({
    where: { scope_day: { scope, day } },
    create: { scope, day, count: 0 },
    update: {},
  });

  if (current.count + amount > limit) {
    return { allowed: false, used: current.count, limit, remaining: Math.max(0, limit - current.count) };
  }

  const updated = await prisma.usageCounter.update({
    where: { scope_day: { scope, day } },
    data: { count: { increment: amount } },
  });

  return { allowed: true, used: updated.count, limit, remaining: Math.max(0, limit - updated.count) };
}

export async function releaseDailyQuota(scope: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await prisma.usageCounter
    .update({ where: { scope_day: { scope, day: today() } }, data: { count: { decrement: amount } } })
    .catch(() => undefined);
}
