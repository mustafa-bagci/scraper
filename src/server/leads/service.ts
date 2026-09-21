import 'server-only';
import { ActivityType, EmailStatus, type Lead, type LeadStatus, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { toPrismaWhere } from '@/lib/filters/engine';
import { computeReviewStats } from '@/lib/reviews/stats';
import { scoreLead, toStoredBreakdown } from '@/lib/scoring/engine';
import { getSettings } from '@/lib/settings/service';
import type { LeadQuery } from '@/types/filters';

export type LeadListResult = {
  leads: Lead[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export async function listLeads(query: LeadQuery): Promise<LeadListResult> {
  const where = toPrismaWhere(query.filters);
  const take = query.pageSize;
  const skip = (query.page - 1) * take;

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: buildOrderBy(query),
      take,
      skip,
    }),
    prisma.lead.count({ where }),
  ]);

  return {
    leads,
    total,
    page: query.page,
    pageSize: take,
    pageCount: Math.max(1, Math.ceil(total / take)),
  };
}

function buildOrderBy(query: LeadQuery): Prisma.LeadOrderByWithRelationInput[] {
  const direction = query.sortDir;
  // Nulls last keeps un-rated businesses from dominating an ascending sort.
  const nullable = new Set(['rating', 'category', 'city', 'email']);
  const primary = nullable.has(query.sortBy)
    ? ({ [query.sortBy]: { sort: direction, nulls: 'last' } } as Prisma.LeadOrderByWithRelationInput)
    : ({ [query.sortBy]: direction } as Prisma.LeadOrderByWithRelationInput);
  return [primary, { id: 'asc' }];
}

/** How many leads a filter matches, without fetching any of them. */
export async function countLeads(filters: LeadQuery['filters']): Promise<number> {
  return prisma.lead.count({ where: toPrismaWhere(filters) });
}

/** Ids only — used by "export everything that matches the current filters". */
export async function listLeadIds(query: Pick<LeadQuery, 'filters'>, limit: number): Promise<string[]> {
  const rows = await prisma.lead.findMany({
    where: toPrismaWhere(query.filters),
    select: { id: true },
    // Ordered so a truncated selection is the same set every time it is asked
    // for, rather than whatever the planner happened to return.
    orderBy: { id: 'asc' },
    take: limit,
  });
  return rows.map((row) => row.id);
}

export async function getLeadDetail(id: string) {
  return prisma.lead.findUnique({
    where: { id },
    include: {
      reviews: { orderBy: [{ rating: 'asc' }, { publishedAt: 'desc' }] },
      emails: { orderBy: [{ isPrimary: 'desc' }, { score: 'desc' }] },
      notes: { orderBy: { createdAt: 'desc' }, include: { user: { select: { name: true, email: true } } } },
      activities: { orderBy: { createdAt: 'desc' }, take: 50, include: { user: { select: { name: true, email: true } } } },
      searchRun: { select: { id: true, label: true, createdAt: true } },
    },
  });
}

export type LeadDetail = NonNullable<Awaited<ReturnType<typeof getLeadDetail>>>;

export async function updateLeadStatus(
  ids: string[],
  status: LeadStatus,
  userId: string | null,
): Promise<number> {
  if (ids.length === 0) return 0;

  const existing = await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  const result = await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { status } });

  await prisma.leadActivity.createMany({
    data: existing
      .filter((lead) => lead.status !== status)
      .map((lead) => ({
        leadId: lead.id,
        userId,
        type: ActivityType.STATUS_CHANGED,
        message: `Status changed from ${lead.status} to ${status}`,
        metadata: { from: lead.status, to: status } as Prisma.InputJsonValue,
      })),
  });

  return result.count;
}

export async function addNote(leadId: string, body: string, userId: string | null) {
  const note = await prisma.leadNote.create({ data: { leadId, body, userId } });
  await prisma.leadActivity.create({
    data: { leadId, userId, type: ActivityType.NOTE_ADDED, message: 'Note added' },
  });
  return note;
}

export async function deleteNote(noteId: string): Promise<void> {
  await prisma.leadNote.delete({ where: { id: noteId } });
}

/**
 * Permanent deletion, including reviews, emails, notes and activity.
 *
 * Cascade rules on the schema do the work; this is the operator-facing control
 * for erasure requests.
 */
export async function deleteLeads(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.lead.deleteMany({ where: { id: { in: ids } } });
  return result.count;
}

export async function updateLeadFields(
  id: string,
  data: { businessName?: string; category?: string | null; phone?: string | null; website?: string | null; email?: string | null },
  userId: string | null,
) {
  const lead = await prisma.lead.update({
    where: { id },
    data: {
      ...data,
      ...(data.email !== undefined
        ? {
            emailStatus: data.email ? EmailStatus.FOUND : EmailStatus.UNKNOWN,
            emailSource: data.email ? 'manual' : null,
            emailFoundAt: data.email ? new Date() : null,
          }
        : {}),
    },
  });

  await prisma.leadActivity.create({
    data: { leadId: id, userId, type: ActivityType.UPDATED, message: 'Lead details updated manually' },
  });

  return recomputeLeadScore(lead.id);
}

/**
 * Recomputes review statistics and the lead score with the *current* settings.
 * Called after a settings change so existing leads reflect the new rules.
 */
export async function recomputeLeadScore(leadId: string): Promise<Lead> {
  const settings = await getSettings();
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  const stats = computeReviewStats(
    lead.reviewBreakdownAvailable
      ? {
          oneStarCount: lead.oneStarCount,
          twoStarCount: lead.twoStarCount,
          threeStarCount: lead.threeStarCount,
          fourStarCount: lead.fourStarCount,
          fiveStarCount: lead.fiveStarCount,
        }
      : null,
    lead.reviewCount,
    settings.reviews,
  );

  const score = scoreLead(
    {
      rating: lead.rating,
      reviewCount: stats.reviewCount,
      badReviewCount: stats.badReviewCount,
      badReviewPercentage: stats.badReviewPercentage,
      email: lead.email,
      website: lead.website,
      phone: lead.phone,
    },
    settings.scoring,
  );

  return prisma.lead.update({
    where: { id: leadId },
    data: {
      badReviewCount: stats.badReviewCount,
      badReviewPercentage: stats.badReviewPercentage,
      leadScore: score.score,
      scoreBreakdown: toStoredBreakdown(score) as unknown as Prisma.InputJsonValue,
    },
  });
}

/** Bulk recompute, run after scoring or review-definition settings change. */
export async function recomputeAllLeads(): Promise<number> {
  const settings = await getSettings();
  const batchSize = 500;
  let processed = 0;
  let cursor: string | undefined;

  for (;;) {
    const leads = await prisma.lead.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });
    if (leads.length === 0) break;

    await prisma.$transaction(
      leads.map((lead) => {
        const stats = computeReviewStats(
          lead.reviewBreakdownAvailable
            ? {
                oneStarCount: lead.oneStarCount,
                twoStarCount: lead.twoStarCount,
                threeStarCount: lead.threeStarCount,
                fourStarCount: lead.fourStarCount,
                fiveStarCount: lead.fiveStarCount,
              }
            : null,
          lead.reviewCount,
          settings.reviews,
        );
        const score = scoreLead(
          {
            rating: lead.rating,
            reviewCount: stats.reviewCount,
            badReviewCount: stats.badReviewCount,
            badReviewPercentage: stats.badReviewPercentage,
            email: lead.email,
            website: lead.website,
            phone: lead.phone,
          },
          settings.scoring,
        );
        return prisma.lead.update({
          where: { id: lead.id },
          data: {
            badReviewCount: stats.badReviewCount,
            badReviewPercentage: stats.badReviewPercentage,
            leadScore: score.score,
            scoreBreakdown: toStoredBreakdown(score) as unknown as Prisma.InputJsonValue,
          },
        });
      }),
    );

    processed += leads.length;
    cursor = leads[leads.length - 1]?.id;
    if (leads.length < batchSize) break;
  }

  return processed;
}
