import { apiSuccess, withAuth } from '@/lib/api/handler';
import { prisma } from '@/lib/db/prisma';
import { getEnv } from '@/lib/env';
import { getProviderStatuses } from '@/lib/providers/registry';
import { getSettings } from '@/lib/settings/service';
import { getDashboardData } from '@/server/dashboard/service';

/**
 * Self-diagnosis for a deployed instance.
 *
 * When a page fails on a host whose logs you cannot reach, the error digest on
 * screen is not much help. This runs each thing a page depends on separately
 * and reports which one breaks, so the failure can be named without a shell.
 *
 * Authenticated only, and it reports *what* failed rather than dumping state:
 * no connection strings, no API keys, no environment values.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Check = { name: string; ok: boolean; ms: number; detail?: string };

async function check(name: string, run: () => Promise<unknown>): Promise<Check> {
  const started = Date.now();
  try {
    await run();
    return { name, ok: true, ms: Date.now() - started };
  } catch (error) {
    console.error(`[diagnostics] ${name} failed`, error);
    return {
      name,
      ok: false,
      ms: Date.now() - started,
      detail: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : 'Unknown error',
    };
  }
}

export const GET = withAuth(async () => {
  const checks: Check[] = [];

  checks.push(await check('database: connection', () => prisma.$queryRaw`SELECT 1`));
  checks.push(await check('database: count leads', () => prisma.lead.count()));
  checks.push(await check('database: count users', () => prisma.user.count()));

  checks.push(
    await check('dashboard: category grouping', () =>
      prisma.lead.groupBy({
        by: ['category'],
        _count: { _all: true },
        where: { category: { not: null } },
        orderBy: { _count: { category: 'desc' } },
        take: 8,
      }),
    ),
  );

  checks.push(
    await check('dashboard: leads over time (raw SQL)', () => {
      const since = new Date(Date.now() - 30 * 86_400_000);
      return prisma.$queryRaw`
        SELECT date_trunc('day', "createdAt") AS day,
               COUNT(*) AS leads,
               COUNT(*) FILTER (WHERE "email" IS NOT NULL) AS emails
        FROM "Lead"
        WHERE "createdAt" >= ${since}
        GROUP BY 1
        ORDER BY 1 ASC
      `;
    }),
  );

  checks.push(
    await check('dashboard: rating buckets (raw SQL)', () =>
      prisma.$queryRaw`
        SELECT CASE WHEN "rating" IS NULL THEN 'No rating' ELSE 'Rated' END AS bucket, COUNT(*) AS total
        FROM "Lead" GROUP BY 1
      `,
    ),
  );

  checks.push(await check('settings: read all sections', () => getSettings()));
  checks.push(await check('providers: resolve status', () => getProviderStatuses()));
  checks.push(await check('environment: validate', async () => getEnv()));

  // The whole page payload last: if every part passes but this fails, the
  // problem is in assembling them rather than in any single query.
  checks.push(await check('dashboard: full payload', () => getDashboardData(30)));

  const failed = checks.filter((c) => !c.ok);

  return apiSuccess({
    ok: failed.length === 0,
    runtime: {
      node: process.version,
      environment: process.env.NODE_ENV,
      // Presence only — never the values.
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasDirectUrl: Boolean(process.env.DIRECT_URL?.trim()),
      hasAuthSecret: Boolean(process.env.AUTH_SECRET),
    },
    failed: failed.map((c) => c.name),
    checks,
  });
});
