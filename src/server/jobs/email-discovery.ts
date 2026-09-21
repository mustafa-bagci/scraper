import 'server-only';
import { ActivityType, EmailStatus, type Job, JobKind, JobStatus, type Prisma, WebsiteStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getEmailFinder, getEmailVerifier } from '@/lib/providers/registry';
import { consumeDailyQuota, releaseDailyQuota } from '@/lib/security/rate-limit';
import { getSettings } from '@/lib/settings/service';
import { recomputeLeadScore } from '@/server/leads/service';
import type { EmailCandidate } from '@/lib/providers/email/EmailFinderProvider';

/**
 * Bulk public-email discovery.
 *
 * Like business discovery, the job is **resumable and processed in bounded
 * slices**: a serverless invocation is frozen once it responds, so the work is
 * driven by successive ticks that each claim a lock, process leads until their
 * time budget is spent, persist the cursor and release the lock.
 */

/** A lock older than this is assumed to belong to a dead invocation. */
const LOCK_TTL_MS = 120_000;

/** Budget for the tick started by the API route via `after()`. */
export const INITIAL_TICK_BUDGET_MS = 50_000;
/** Budget for a tick driven by a client poll — must stay responsive. */
export const POLL_TICK_BUDGET_MS = 20_000;

export type StartEmailJobResult =
  | { ok: true; jobId: string; total: number }
  | { ok: false; error: string; code: 'QUOTA' | 'EMPTY' };

export async function startEmailDiscovery(
  leadIds: string[],
  options: { userId: string | null; verify?: boolean },
): Promise<StartEmailJobResult> {
  const settings = await getSettings();

  const targets = await prisma.lead.findMany({
    where: { id: { in: leadIds }, website: { not: null } },
    select: { id: true },
  });

  if (targets.length === 0) {
    return { ok: false, code: 'EMPTY', error: 'None of the selected leads has a website to check.' };
  }

  const quota = await consumeDailyQuota('email:lookups', settings.limits.maxEmailLookupsPerDay, targets.length);
  if (!quota.allowed) {
    return {
      ok: false,
      code: 'QUOTA',
      error: `Daily email lookup limit reached (${quota.used}/${quota.limit}). Raise it in Settings → Cost control.`,
    };
  }

  const job = await prisma.job.create({
    data: {
      userId: options.userId,
      kind: JobKind.EMAIL_DISCOVERY,
      status: JobStatus.PENDING,
      total: targets.length,
      statusMessage: 'Queued',
      payload: { leadIds: targets.map((t) => t.id), verify: options.verify ?? true } as Prisma.InputJsonValue,
    },
  });

  return { ok: true, jobId: job.id, total: targets.length };
}

/**
 * Processes one slice of an email discovery job.
 *
 * Safe to call concurrently and repeatedly: if another tick holds the lock, or
 * the job has finished, it returns the current state untouched.
 */
export async function advanceEmailDiscovery(
  jobId: string,
  budgetMs: number = POLL_TICK_BUDGET_MS,
): Promise<Job | null> {
  const existing = await prisma.job.findUnique({ where: { id: jobId } });
  if (!existing) return null;
  if (existing.status === JobStatus.COMPLETED || existing.status === JobStatus.FAILED) return existing;

  const claimed = await prisma.job.updateMany({
    where: {
      id: jobId,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
      OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(Date.now() - LOCK_TTL_MS) } }],
    },
    data: {
      status: JobStatus.RUNNING,
      lockedAt: new Date(),
      ...(existing.startedAt ? {} : { startedAt: new Date(), statusMessage: 'Checking public website pages…' }),
    },
  });

  // Another tick is already working on this job; report what we have.
  if (claimed.count === 0) return prisma.job.findUnique({ where: { id: jobId } });

  try {
    return await processEmailSlice(jobId, budgetMs);
  } catch (error) {
    console.error('[email-discovery] tick failed', { jobId, error });
    return prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        error: 'The email discovery job stopped unexpectedly.',
        lockedAt: null,
        finishedAt: new Date(),
      },
    });
  }
}

async function processEmailSlice(jobId: string, budgetMs: number): Promise<Job> {
  let job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });

  const payload = (job.payload ?? {}) as { leadIds?: string[]; verify?: boolean };
  const leadIds = payload.leadIds ?? [];
  const shouldVerify = payload.verify ?? true;

  const settings = await getSettings();
  const finder = await getEmailFinder();
  const verifier = await getEmailVerifier();

  /**
   * How much time to keep in reserve before starting another lead.
   *
   * The absolute worst case — every page timing out — is around six times a
   * typical crawl, and reserving that much would limit a tick to a single
   * lead. This budgets for a site where a couple of pages hang instead. The
   * cost of guessing low is bounded: the invocation ends mid-crawl and that
   * one lead is skipped, which the cursor-first advance above makes safe.
   */
  const { maxPagesPerDomain, timeoutMs, requestDelayMs } = settings.crawler;
  const worstCasePerLead =
    maxPagesPerDomain * timeoutMs +
    Math.min(timeoutMs, 6000) +
    Math.max(0, maxPagesPerDomain - 1) * requestDelayMs;
  const reservePerLead = Math.min(worstCasePerLead, timeoutMs * 2 + 2000);

  // Counters and position accumulate across ticks.
  let cursor = job.cursor;
  let processed = job.processed;
  let succeeded = job.succeeded;
  let failed = job.failed;

  const deadline = Date.now() + budgetMs;
  // Every tick processes at least one lead, so a tick can never return without
  // making progress. After that a lead is only started if its worst case still
  // fits, since a crawl always runs to completion once begun.
  let firstLead = true;

  while (cursor < leadIds.length && (firstLead || Date.now() + reservePerLead <= deadline)) {
    firstLead = false;
    const leadId = leadIds[cursor];
    cursor += 1;

    // The advance is persisted *before* the crawl. Saving it afterwards means
    // a site slow enough to kill the invocation is retried by every later
    // tick, and the job never gets past it.
    await prisma.job.update({
      where: { id: jobId },
      data: { cursor, processed: cursor, lockedAt: new Date() },
    });

    const lead = leadId ? await prisma.lead.findUnique({ where: { id: leadId } }) : null;
    if (!lead || !leadId) {
      processed += 1;
      failed += 1;
      continue;
    }

    try {
      const result = await finder.findEmails({
        website: lead.website,
        businessName: lead.businessName,
        domain: lead.websiteDomain,
        country: lead.country,
      });

      if (result.candidates.length === 0) {
        failed += 1;
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            emailCheckedAt: new Date(),
            websiteStatus: result.pagesChecked.some((p) => p.ok) ? WebsiteStatus.CRAWLED : WebsiteStatus.UNREACHABLE,
            websiteCheckedAt: new Date(),
          },
        });
        await prisma.leadActivity.create({
          data: {
            leadId,
            userId: job.userId,
            type: ActivityType.EMAIL_NOT_FOUND,
            message: result.error ?? 'No public email found on the website.',
            metadata: { pagesChecked: result.pagesChecked } as Prisma.InputJsonValue,
          },
        });
      } else {
        succeeded += 1;
        await persistCandidates(leadId, result.candidates, {
          userId: job.userId,
          verify: shouldVerify,
          verifier,
          pagesChecked: result.pagesChecked,
        });
      }
    } catch (error) {
      console.error('[email-discovery] lead failed', { leadId, error });
      failed += 1;
      await prisma.leadActivity.create({
        data: {
          leadId,
          userId: job.userId,
          type: ActivityType.EMAIL_NOT_FOUND,
          message: 'Email discovery failed for this lead. See server logs for details.',
        },
      });
    }

    // `processed` tracks the cursor, so a lead lost to a killed invocation is
    // counted as seen rather than silently dropping out of the total.
    processed = cursor;
    job = await prisma.job.update({
      where: { id: jobId },
      data: {
        succeeded,
        failed,
        // Refresh the lock so a long slice is not mistaken for a dead one.
        lockedAt: new Date(),
        statusMessage: `${processed} / ${leadIds.length} checked`,
      },
    });
  }

  if (cursor < leadIds.length) {
    // More work remains; the next tick resumes from the cursor.
    return prisma.job.update({ where: { id: jobId }, data: { lockedAt: null } });
  }

  // Unused reservations go back to the daily quota.
  await releaseDailyQuota('email:lookups', Math.max(0, leadIds.length - processed));

  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.COMPLETED,
      lockedAt: null,
      statusMessage: `Found ${succeeded} · not found ${failed}`,
      result: { found: succeeded, notFound: failed } as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
}

type VerifierLike = Awaited<ReturnType<typeof getEmailVerifier>>;

async function persistCandidates(
  leadId: string,
  candidates: EmailCandidate[],
  context: {
    userId: string | null;
    verify: boolean;
    verifier: VerifierLike;
    pagesChecked: Array<{ url: string; ok: boolean; status: number | null; reason?: string }>;
  },
): Promise<void> {
  const primary = candidates[0];
  if (!primary) return;

  for (const [index, candidate] of candidates.entries()) {
    await prisma.leadEmail.upsert({
      where: { leadId_email: { leadId, email: candidate.email } },
      create: {
        leadId,
        email: candidate.email,
        status: EmailStatus.FOUND,
        source: candidate.source,
        sourceUrl: candidate.sourceUrl,
        isPrimary: index === 0,
        isGeneric: candidate.isGeneric,
        score: candidate.score,
      },
      update: {
        source: candidate.source,
        sourceUrl: candidate.sourceUrl,
        isPrimary: index === 0,
        isGeneric: candidate.isGeneric,
        score: candidate.score,
      },
    });
  }

  let status: EmailStatus = EmailStatus.FOUND;
  if (context.verify && context.verifier.isConfigured()) {
    const verification = await context.verifier.verifyEmail(primary.email);
    status = verification.status;
    await prisma.leadEmail.update({
      where: { leadId_email: { leadId, email: primary.email } },
      data: {
        status,
        verifiedAt: verification.verified ? new Date() : null,
        verificationProvider: verification.verified ? verification.provider : null,
      },
    });
    await prisma.leadActivity.create({
      data: {
        leadId,
        userId: context.userId,
        type: ActivityType.EMAIL_VERIFIED,
        message: `${primary.email}: ${verification.detail}`,
        metadata: { status, provider: verification.provider } as Prisma.InputJsonValue,
      },
    });
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      email: primary.email,
      emailStatus: status,
      emailSource: primary.source,
      emailSourceUrl: primary.sourceUrl,
      emailFoundAt: new Date(),
      emailCheckedAt: new Date(),
      websiteStatus: WebsiteStatus.CRAWLED,
      websiteCheckedAt: new Date(),
    },
  });

  await prisma.leadActivity.create({
    data: {
      leadId,
      userId: context.userId,
      type: ActivityType.EMAIL_FOUND,
      message: `Public email found: ${primary.email}${primary.sourceUrl ? ` (on ${primary.sourceUrl})` : ''}`,
      metadata: {
        email: primary.email,
        source: primary.source,
        sourceUrl: primary.sourceUrl,
        pagesChecked: context.pagesChecked,
      } as Prisma.InputJsonValue,
    },
  });

  await recomputeLeadScore(leadId);
}

/** Verifies the primary address of a single lead on demand. */
export async function verifyLeadEmail(leadId: string, userId: string | null) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (!lead.email) return { ok: false as const, error: 'This lead has no email address yet.' };

  const settings = await getSettings();
  const quota = await consumeDailyQuota('email:verifications', settings.limits.maxVerificationsPerDay);
  if (!quota.allowed) {
    return { ok: false as const, error: `Daily verification limit reached (${quota.limit}/day).` };
  }

  const verifier = await getEmailVerifier();
  const verification = await verifier.verifyEmail(lead.email);

  await prisma.lead.update({
    where: { id: leadId },
    data: { emailStatus: verification.status, emailCheckedAt: new Date() },
  });

  await prisma.leadEmail
    .update({
      where: { leadId_email: { leadId, email: lead.email } },
      data: {
        status: verification.status,
        verifiedAt: verification.verified ? new Date() : null,
        verificationProvider: verification.verified ? verification.provider : null,
      },
    })
    .catch(() => undefined);

  await prisma.leadActivity.create({
    data: {
      leadId,
      userId,
      type: ActivityType.EMAIL_VERIFIED,
      message: `${lead.email}: ${verification.detail}`,
    },
  });

  return { ok: true as const, verification };
}
