import type { SearchRun } from '@prisma/client';

/** The search-run shape the client polls. Internal lock/cursor stay server-side. */
export function serialiseSearchRun(run: SearchRun) {
  return {
    id: run.id,
    label: run.label,
    status: run.status,
    progress: run.progress,
    statusMessage: run.statusMessage,
    error: run.error,
    discovered: run.discovered,
    unique: run.unique,
    duplicates: run.duplicates,
    matched: run.matched,
    created: run.created,
    updated: run.updated,
    providerCalls: run.providerCalls,
    provider: run.provider,
    filters: run.filters,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}
