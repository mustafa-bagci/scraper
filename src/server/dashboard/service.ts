import 'server-only';
import { EmailStatus, LeadStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getSettings } from '@/lib/settings/service';

/**
 * Dashboard aggregations. Everything is computed in SQL; the page is a server
 * component that renders the result.
 */

export type DashboardMetrics = {
  totalLeads: number;
  qualifiedLeads: number;
  emailsFound: number;
  validEmails: number;
  contacted: number;
  interested: number;
  customers: number;
  emailDiscoveryRate: number;
  qualifiedThreshold: number;
  verificationConfigured: boolean;
};

export type TimeSeriesPoint = { date: string; leads: number; emails: number };
export type DistributionPoint = { label: string; value: number };

export type DashboardData = {
  metrics: DashboardMetrics;
  leadsOverTime: TimeSeriesPoint[];
  qualityDistribution: DistributionPoint[];
  ratingDistribution: DistributionPoint[];
  topCategories: DistributionPoint[];
  statusDistribution: DistributionPoint[];
  recentLeads: Array<{
    id: string;
    businessName: string;
    city: string | null;
    rating: number | null;
    reviewCount: number;
    badReviewPercentage: number;
    email: string | null;
    emailStatus: EmailStatus;
    leadScore: number;
    status: LeadStatus;
    createdAt: Date;
  }>;
};

export async function getDashboardData(days = 30): Promise<DashboardData> {
  const settings = await getSettings();
  const threshold = settings.scoring.qualifiedThreshold;
  const since = new Date(Date.now() - days * 86_400_000);
  since.setHours(0, 0, 0, 0);

  const [
    totalLeads,
    qualifiedLeads,
    emailsFound,
    validEmails,
    contacted,
    interested,
    customers,
    statusGroups,
    categoryGroups,
    recentLeads,
    timeSeriesRows,
    ratingBuckets,
    scoreBuckets,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { OR: [{ leadScore: { gte: threshold } }, { status: LeadStatus.QUALIFIED }] } }),
    prisma.lead.count({ where: { email: { not: null } } }),
    prisma.lead.count({ where: { emailStatus: EmailStatus.VALID } }),
    prisma.lead.count({ where: { status: LeadStatus.CONTACTED } }),
    prisma.lead.count({ where: { status: LeadStatus.INTERESTED } }),
    prisma.lead.count({ where: { status: LeadStatus.CUSTOMER } }),
    prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.lead.groupBy({
      by: ['category'],
      _count: { _all: true },
      where: { category: { not: null } },
      orderBy: { _count: { category: 'desc' } },
      take: 8,
    }),
    prisma.lead.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        businessName: true,
        city: true,
        rating: true,
        reviewCount: true,
        badReviewPercentage: true,
        email: true,
        emailStatus: true,
        leadScore: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.$queryRaw<Array<{ day: Date; leads: bigint; emails: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*) AS leads,
             COUNT(*) FILTER (WHERE "email" IS NOT NULL) AS emails
      FROM "Lead"
      WHERE "createdAt" >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    prisma.$queryRaw<Array<{ bucket: string; total: bigint }>>`
      SELECT CASE
               WHEN "rating" IS NULL THEN 'No rating'
               WHEN "rating" < 3 THEN 'Under 3.0'
               WHEN "rating" < 3.5 THEN '3.0 – 3.4'
               WHEN "rating" < 4 THEN '3.5 – 3.9'
               WHEN "rating" < 4.5 THEN '4.0 – 4.4'
               ELSE '4.5 – 5.0'
             END AS bucket,
             COUNT(*) AS total
      FROM "Lead"
      GROUP BY 1
    `,
    prisma.$queryRaw<Array<{ bucket: string; total: bigint }>>`
      SELECT CASE
               WHEN "leadScore" >= 80 THEN '80 – 100'
               WHEN "leadScore" >= 60 THEN '60 – 79'
               WHEN "leadScore" >= 40 THEN '40 – 59'
               WHEN "leadScore" >= 20 THEN '20 – 39'
               ELSE '0 – 19'
             END AS bucket,
             COUNT(*) AS total
      FROM "Lead"
      GROUP BY 1
    `,
  ]);

  const ratingOrder = ['No rating', 'Under 3.0', '3.0 – 3.4', '3.5 – 3.9', '4.0 – 4.4', '4.5 – 5.0'];
  const scoreOrder = ['0 – 19', '20 – 39', '40 – 59', '60 – 79', '80 – 100'];

  return {
    metrics: {
      totalLeads,
      qualifiedLeads,
      emailsFound,
      validEmails,
      contacted,
      interested,
      customers,
      emailDiscoveryRate: totalLeads > 0 ? Math.round((emailsFound / totalLeads) * 1000) / 10 : 0,
      qualifiedThreshold: threshold,
      verificationConfigured: settings.limits.maxVerificationsPerDay > 0,
    },
    leadsOverTime: fillSeries(timeSeriesRows, since, days),
    qualityDistribution: orderBuckets(scoreBuckets, scoreOrder),
    ratingDistribution: orderBuckets(ratingBuckets, ratingOrder),
    topCategories: categoryGroups.map((group) => ({
      label: group.category ?? 'Uncategorised',
      value: group._count._all,
    })),
    statusDistribution: statusGroups.map((group) => ({ label: group.status, value: group._count._all })),
    recentLeads,
  };
}

function orderBuckets(rows: Array<{ bucket: string; total: bigint }>, order: string[]): DistributionPoint[] {
  const byBucket = new Map(rows.map((row) => [row.bucket, Number(row.total)]));
  return order.map((label) => ({ label, value: byBucket.get(label) ?? 0 }));
}

function fillSeries(
  rows: Array<{ day: Date; leads: bigint; emails: bigint }>,
  since: Date,
  days: number,
): TimeSeriesPoint[] {
  const byDay = new Map(
    rows.map((row) => [row.day.toISOString().slice(0, 10), { leads: Number(row.leads), emails: Number(row.emails) }]),
  );

  const series: TimeSeriesPoint[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(since.getTime() + i * 86_400_000);
    const key = date.toISOString().slice(0, 10);
    const entry = byDay.get(key);
    series.push({ date: key, leads: entry?.leads ?? 0, emails: entry?.emails ?? 0 });
  }
  return series;
}
