/**
 * Resumability tests for the sliced job engine.
 *
 * These simulate the serverless failure mode the design exists for: an
 * invocation that is frozen part-way through, leaving the job to be finished by
 * later ticks. Every tick must make progress, accumulate counters exactly once,
 * and converge on the same result as an uninterrupted run.
 *
 * Run with: npm run test:jobs   (requires DATABASE_URL)
 */
import assert from 'node:assert/strict';
import { JobStatus, PrismaClient } from '@prisma/client';
import { advanceSearchRun, startSearchRun } from '../src/server/search/runner';

const prisma = new PrismaClient();

let pass = 0;
const failures: string[] = [];
const t = (name: string, fn: () => Promise<void>) =>
  fn()
    .then(() => { pass += 1; console.log(`PASS  ${name}`); })
    .catch((e) => { failures.push(name); console.log(`FAIL  ${name} — ${e.message}`); });

const LABEL = 'resumability test';

async function freshRun(scenario: string) {
  const started = await startSearchRun(
    { country: 'France', city: 'Lyon', category: 'Dentiste', keyword: scenario, limit: 60 },
    { userId: null, label: LABEL },
  );
  assert.ok(started.ok, 'search run should start');
  return (started as { ok: true; searchRunId: string }).searchRunId;
}

await t('a single generous tick completes the run', async () => {
  const id = await freshRun('single-tick');
  const run = await advanceSearchRun(id, 60_000);
  assert.equal(run?.status, JobStatus.COMPLETED);
  assert.equal(run?.discovered, 60);
  assert.equal(run?.progress, 100);
  assert.equal(run?.lockedAt, null, 'lock must be released');
});

await t('a job interrupted every tick still completes', async () => {
  const id = await freshRun('interrupted');

  // budget 0 → each tick processes exactly one provider page, then returns,
  // exactly as an invocation cut short would.
  let ticks = 0;
  let run = await prisma.searchRun.findUniqueOrThrow({ where: { id } });
  while (run.status !== JobStatus.COMPLETED && ticks < 50) {
    run = (await advanceSearchRun(id, 0))!;
    ticks += 1;
  }

  assert.equal(run.status, JobStatus.COMPLETED, `stalled after ${ticks} ticks`);
  assert.equal(run.discovered, 60, 'must discover the same total as one long tick');
  assert.ok(ticks > 1, 'the run should genuinely have taken several ticks');
  assert.equal(run.lockedAt, null);
});

await t('every tick makes progress — a job can never stall', async () => {
  const id = await freshRun('progress');
  let previous = 0;
  for (let i = 0; i < 3; i += 1) {
    const run = await advanceSearchRun(id, 0);
    assert.ok(run!.discovered > previous, `tick ${i + 1} made no progress (${run!.discovered})`);
    previous = run!.discovered;
    if (run!.status === JobStatus.COMPLETED) break;
  }
});

await t('counters are not double-counted across ticks', async () => {
  const id = await freshRun('counters');
  let run = await prisma.searchRun.findUniqueOrThrow({ where: { id } });
  while (run.status !== JobStatus.COMPLETED) run = (await advanceSearchRun(id, 0))!;

  assert.equal(run.created + run.updated, run.matched, 'created + updated must equal matched');
  assert.equal(run.unique, run.discovered - run.duplicates);
  assert.equal(run.discovered, 60, 'sliced ticks must discover the full limit');

  // Each discovered business is stored exactly once, never duplicated per tick.
  const stored = await prisma.lead.count({ where: { searchRunId: id } });
  assert.equal(stored, run.matched, 'every matched business must be stored exactly once');
});

await t('concurrent ticks do not duplicate work', async () => {
  const id = await freshRun('concurrent');

  // Five callers racing, as five simultaneous client polls would.
  const results = await Promise.all(Array.from({ length: 5 }, () => advanceSearchRun(id, 60_000)));
  assert.ok(results.every((r) => r !== null));

  const run = await prisma.searchRun.findUniqueOrThrow({ where: { id } });
  assert.equal(run.status, JobStatus.COMPLETED);
  assert.equal(run.discovered, 60, 'the lock must stop a second tick re-running pages');
  assert.equal(run.created + run.updated, run.matched);
});

await t('a stale lock from a dead invocation is reclaimed', async () => {
  const id = await freshRun('stale-lock');
  await advanceSearchRun(id, 0);

  // Simulate an invocation that was frozen while holding the lock.
  await prisma.searchRun.update({
    where: { id },
    data: { lockedAt: new Date(Date.now() - 10 * 60_000), status: JobStatus.RUNNING },
  });

  const run = await advanceSearchRun(id, 60_000);
  assert.equal(run?.status, JobStatus.COMPLETED, 'a stale lock must not block the job forever');
});

await t('a finished run is never re-processed', async () => {
  const id = await freshRun('terminal');
  await advanceSearchRun(id, 60_000);
  const before = await prisma.searchRun.findUniqueOrThrow({ where: { id } });

  const after = await advanceSearchRun(id, 60_000);
  assert.equal(after?.discovered, before.discovered);
  assert.equal(after?.created, before.created);
  assert.deepEqual(after?.finishedAt, before.finishedAt);
});

// Clean up the leads and runs these tests created.
const testRuns = await prisma.searchRun.findMany({ where: { label: LABEL }, select: { id: true } });
await prisma.lead.deleteMany({ where: { searchRunId: { in: testRuns.map((r) => r.id) } } });
await prisma.searchRun.deleteMany({ where: { label: LABEL } });
await prisma.$disconnect();

console.log(`\n${pass}/${pass + failures.length} job checks passed`);
if (failures.length) process.exit(1);
