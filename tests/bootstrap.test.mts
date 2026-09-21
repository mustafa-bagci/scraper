/**
 * First-run admin bootstrap.
 *
 * The account created here is the only way into a hosted deployment, so the
 * guards matter more than the happy path: it must refuse weak or example
 * credentials, and it must never touch an installation that already has users.
 *
 * The bootstrap only acts on an empty `User` table, so these tests have to
 * empty it. Whatever was there is captured first and put back afterwards —
 * including the rows that reference it, which the schema would otherwise null
 * out — so running this against a development database is not destructive.
 *
 * Run with: npm run test:bootstrap   (requires DATABASE_URL)
 */
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { ensureAdminUser } from '../src/server/auth/bootstrap';
import { verifyPassword } from '../src/lib/security/crypto';

const prisma = new PrismaClient();

let pass = 0;
const failures: string[] = [];
const t = (name: string, fn: () => Promise<void>) =>
  fn()
    .then(() => { pass += 1; console.log(`PASS  ${name}`); })
    .catch((e) => { failures.push(name); console.log(`FAIL  ${name} — ${e.message}`); });

const STRONG = 'K9!vurgan-Deniz-2026';

/** Users plus every column that points at them and would be nulled on delete. */
async function snapshot() {
  const [users, leads, notes, activities] = await Promise.all([
    prisma.user.findMany(),
    prisma.lead.findMany({ where: { ownerId: { not: null } }, select: { id: true, ownerId: true } }),
    prisma.leadNote.findMany({ where: { userId: { not: null } }, select: { id: true, userId: true } }),
    prisma.leadActivity.findMany({ where: { userId: { not: null } }, select: { id: true, userId: true } }),
  ]);
  return { users, leads, notes, activities };
}

async function restore(snap: Awaited<ReturnType<typeof snapshot>>) {
  await prisma.user.deleteMany({});
  if (snap.users.length === 0) return;

  await prisma.user.createMany({ data: snap.users });

  // Re-point the references the cascade cleared.
  await prisma.$transaction([
    ...snap.leads.map((lead) =>
      prisma.lead.update({ where: { id: lead.id }, data: { ownerId: lead.ownerId } }),
    ),
    ...snap.notes.map((note) =>
      prisma.leadNote.update({ where: { id: note.id }, data: { userId: note.userId } }),
    ),
    ...snap.activities.map((activity) =>
      prisma.leadActivity.update({ where: { id: activity.id }, data: { userId: activity.userId } }),
    ),
  ]);
}

const original = await snapshot();

async function wipeUsers() {
  await prisma.user.deleteMany({});
}

function setEnv(email?: string, password?: string) {
  if (email === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = email;
  if (password === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = password;
}

await t('creates the first admin from the environment', async () => {
  await wipeUsers();
  setEnv('Owner@Murgay.com', STRONG);

  const result = await ensureAdminUser();
  assert.equal(result.status, 'created');

  const user = await prisma.user.findFirstOrThrow();
  assert.equal(user.email, 'owner@murgay.com', 'email should be normalised to lowercase');
  assert.equal(user.role, 'ADMIN');
  assert.ok(await verifyPassword(STRONG, user.passwordHash), 'the password must verify');
  assert.notEqual(user.passwordHash, STRONG, 'the password must never be stored in plain text');
});

await t('never runs again once an account exists', async () => {
  // A different environment must not be able to seize an existing install.
  setEnv('someone-else@evil.test', 'AnotherStrongPassword!1');
  const result = await ensureAdminUser();
  assert.notEqual(result.status, 'created', 'a second account must never be created');

  const users = await prisma.user.findMany();
  assert.equal(users.length, 1, 'no second account may be created');
  assert.equal(users[0]?.email, 'owner@murgay.com', 'the existing account must be untouched');
});

await t('keeps prompting until the account is actually signed into', async () => {
  const before = await ensureAdminUser();
  assert.equal(before.status, 'awaiting-first-login', 'a never-used account should still be advertised');

  await prisma.user.updateMany({ data: { lastLoginAt: new Date() } });

  const after = await ensureAdminUser();
  assert.equal(after.status, 'exists', 'the notice must stop once someone has signed in');
});

await t('refuses to run with no credentials configured', async () => {
  await wipeUsers();
  setEnv(undefined, undefined);

  const result = await ensureAdminUser();
  assert.equal(result.status, 'unconfigured');
  assert.equal(await prisma.user.count(), 0);
});

await t('refuses a short password', async () => {
  await wipeUsers();
  setEnv('owner@murgay.com', 'short1!');

  const result = await ensureAdminUser();
  assert.equal(result.status, 'unconfigured');
  assert.match(result.status === 'unconfigured' ? result.reason : '', /12 characters/);
  assert.equal(await prisma.user.count(), 0);
});

await t('refuses the example password from the docs', async () => {
  await wipeUsers();
  setEnv('owner@murgay.com', 'ChangeMe!2026');

  const result = await ensureAdminUser();
  assert.equal(result.status, 'unconfigured');
  assert.match(result.status === 'unconfigured' ? result.reason : '', /example password/);
  assert.equal(await prisma.user.count(), 0);
});

await t('refuses a malformed email', async () => {
  await wipeUsers();
  setEnv('not-an-email', STRONG);

  const result = await ensureAdminUser();
  assert.equal(result.status, 'unconfigured');
  assert.equal(await prisma.user.count(), 0);
});

await t('concurrent first requests create exactly one account', async () => {
  await wipeUsers();
  setEnv('owner@murgay.com', STRONG);

  const results = await Promise.all(Array.from({ length: 5 }, () => ensureAdminUser()));
  assert.equal(await prisma.user.count(), 1, 'the race must not produce duplicates');
  assert.equal(results.filter((r) => r.status === 'created').length, 1, 'exactly one caller should report creating it');
});

await restore(original);

const restored = await prisma.user.count();
if (restored !== original.users.length) {
  failures.push('restore');
  console.log(`FAIL  the database was left as it was found — ${restored} users, expected ${original.users.length}`);
} else if (original.users.length > 0) {
  console.log(`PASS  the database was left as it was found (${restored} users restored)`);
  pass += 1;
}

await prisma.$disconnect();

console.log(`\n${pass}/${pass + failures.length} bootstrap checks passed`);
if (failures.length) process.exit(1);
