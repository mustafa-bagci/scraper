/**
 * Email discovery job, against the failure that matters on serverless: a site
 * slow enough that the platform kills the invocation mid-crawl.
 *
 * The job must not retry that lead forever, and it must still finish.
 *
 * Run with: npm run test:email-job   (requires DATABASE_URL)
 */
import assert from 'node:assert/strict';
import { JobKind, JobStatus, PrismaClient } from '@prisma/client';
import { advanceEmailDiscovery } from '../src/server/jobs/email-discovery';

const prisma = new PrismaClient();

let pass = 0;
const failures: string[] = [];
const t = (name: string, fn: () => Promise<void>) =>
  fn()
    .then(() => { pass += 1; console.log(`PASS  ${name}`); })
    .catch((e) => { failures.push(name); console.log(`FAIL  ${name} — ${e.message}`); });

const LABEL = 'email-job test';

async function makeLeads(count: number) {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const lead = await prisma.lead.create({
      data: {
        businessName: `${LABEL} ${i}`,
        website: `https://lead-${i}.example`,
        websiteDomain: `lead-${i}.example`,
        dedupeKey: `${LABEL}-${i}-${Date.now()}`,
      },
    });
    ids.push(lead.id);
  }
  return ids;
}

async function makeJob(leadIds: string[]) {
  return prisma.job.create({
    data: {
      kind: JobKind.EMAIL_DISCOVERY,
      status: JobStatus.PENDING,
      total: leadIds.length,
      payload: { leadIds, verify: false },
    },
  });
}

async function cleanup() {
  await prisma.lead.deleteMany({ where: { businessName: { startsWith: LABEL } } });
  await prisma.job.deleteMany({ where: { kind: JobKind.EMAIL_DISCOVERY, total: { lte: 4 } } });
}

await cleanup();

await t('the cursor advances before the crawl, so a killed lead is not retried', async () => {
  const leadIds = await makeLeads(3);
  const job = await makeJob(leadIds);

  // A tick that dies mid-crawl leaves the cursor already moved on.
  await advanceEmailDiscovery(job.id, 0);
  const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });

  assert.ok(after.cursor >= 1, 'the first lead must be consumed');
  assert.equal(after.processed, after.cursor, 'processed tracks the cursor');
});

await t('a job completes even when every tick is cut short', async () => {
  const leadIds = await makeLeads(3);
  const job = await makeJob(leadIds);

  let state = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  let ticks = 0;
  while (state.status !== JobStatus.COMPLETED && ticks < 20) {
    state = (await advanceEmailDiscovery(job.id, 0))!;
    ticks += 1;
  }

  assert.equal(state.status, JobStatus.COMPLETED, `stalled after ${ticks} ticks`);
  assert.equal(state.cursor, 3, 'every lead was consumed exactly once');
  assert.equal(state.processed, 3);
  assert.equal(state.lockedAt, null, 'the lock is released');
  assert.ok(ticks >= 3, 'a zero budget should take one tick per lead');
});

await t('a lead is never processed twice', async () => {
  const leadIds = await makeLeads(2);
  const job = await makeJob(leadIds);

  // Five callers racing, as five browser polls would. How many leads one tick
  // gets through depends on the time reserve; what must hold is that none is
  // crawled twice.
  await Promise.all(Array.from({ length: 5 }, () => advanceEmailDiscovery(job.id, 30_000)));
  let state = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });

  assert.ok(state.cursor <= 2, `no lead may be consumed twice (cursor=${state.cursor})`);
  assert.ok(state.succeeded + state.failed <= 2, 'counters cannot exceed the work');

  while (state.status !== JobStatus.COMPLETED) state = (await advanceEmailDiscovery(job.id, 30_000))!;
  assert.equal(state.cursor, 2, 'and every lead is consumed exactly once by the end');
  assert.equal(state.succeeded + state.failed, 2);
});

await t('a finished job is left alone', async () => {
  const leadIds = await makeLeads(1);
  const job = await makeJob(leadIds);
  while ((await advanceEmailDiscovery(job.id, 30_000))!.status !== JobStatus.COMPLETED) { /* drain */ }

  const before = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  const after = await advanceEmailDiscovery(job.id, 30_000);
  assert.equal(after?.cursor, before.cursor);
  assert.deepEqual(after?.finishedAt, before.finishedAt);
});

await cleanup();
await prisma.$disconnect();

console.log(`\n${pass}/${pass + failures.length} email job checks passed`);
if (failures.length) process.exit(1);
