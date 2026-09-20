import 'server-only';
import { ActivityType, EmailStatus, JobKind, JobStatus, type Prisma, WebsiteStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getEmailFinder, getEmailVerifier } from '@/lib/providers/registry';
import { consumeDailyQuota, releaseDailyQuota } from '@/lib/security/rate-limit';
import { getSettings } from '@/lib/settings/service';
import { recomputeLeadScore } from '@/server/leads/service';
import type { EmailCandidate } from '@/lib/providers/email/EmailFinderProvider';

/**
 * Bulk public-email discovery.
 *
 * Runs as a background job so a 50-lead request never blocks an HTTP
 * response. Progress (`processed / total`, found, not found) is persisted so
 * the UI can poll it.
 */

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

  void runEmailDiscovery(job.id).catch(async (error: unknown) => {
    console.error('[email-discovery] unhandled failure', error);
    await prisma.job
      .update({
        where: { id: job.id },
        data: { status: JobStatus.FAILED, error: 'The email discovery job stopped unexpectedly.', finishedAt: new Date() },
      })
      .catch(() => undefined);
  });

  return { ok: true, jobId: job.id, total: targets.length };
}

export async function runEmailDiscovery(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.status !== JobStatus.PENDING) return;

  const payload = (job.payload ?? {}) as { leadIds?: string[]; verify?: boolean };
  const leadIds = payload.leadIds ?? [];
  const shouldVerify = payload.verify ?? true;

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.RUNNING, startedAt: new Date(), statusMessage: 'Checking public website pages…' },
  });

  const finder = await getEmailFinder();
  const verifier = await getEmailVerifier();

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const leadId of leadIds) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
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

    processed += 1;
    await prisma.job.update({
      where: { id: jobId },
      data: {
        processed,
        succeeded,
        failed,
        statusMessage: `${processed} / ${leadIds.length} checked`,
      },
    });
  }

  // Unused reservations go back to the daily quota.
  await releaseDailyQuota('email:lookups', Math.max(0, leadIds.length - processed));

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.COMPLETED,
      processed,
      succeeded,
      failed,
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
