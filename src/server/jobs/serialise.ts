import type { Job } from '@prisma/client';

/** The job shape the client polls. Internal lock/cursor stay server-side. */
export function serialiseJob(job: Job) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    statusMessage: job.statusMessage,
    error: job.error,
    finishedAt: job.finishedAt,
  };
}
