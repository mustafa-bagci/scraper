/**
 * Duplicate detection against the shapes real provider data arrives in.
 *
 * The same business comes back under a slightly different name, with the phone
 * formatted differently, or with fields the previous listing had and this one
 * does not. None of those may create a second row — and a genuinely different
 * branch must still get one.
 *
 * Run with: npm run test:dedupe   (requires DATABASE_URL)
 */
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { upsertBusinessAsLead } from '../src/server/leads/upsert';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import type { NormalizedBusiness } from '../src/lib/providers/business/BusinessDataProvider';

const prisma = new PrismaClient();
const MARK = 'DEDUPE-TEST';

let pass = 0;
const failures: string[] = [];
const t = (name: string, fn: () => Promise<void>) =>
  fn()
    .then(() => { pass += 1; console.log(`PASS  ${name}`); })
    .catch((e) => { failures.push(name); console.log(`FAIL  ${name} — ${e.message}`); });

const listing = (over: Partial<NormalizedBusiness> = {}): NormalizedBusiness => ({
  externalId: 'place-1',
  name: `${MARK} Centre Dentaire Terreaux`,
  primaryCategory: 'Dentist',
  categories: ['Dentist'],
  country: 'France',
  countryCode: 'FR',
  region: 'Auvergne-Rhône-Alpes',
  city: 'Lyon',
  postalCode: '69001',
  address: '12 Rue de la République, 69001 Lyon',
  latitude: 45.764,
  longitude: 4.8357,
  phone: '+33 4 78 00 00 00',
  website: 'https://terreaux.example',
  email: null,
  rating: 3.8,
  reviewCount: 200,
  ratingBreakdown: { oneStarCount: 30, twoStarCount: 10, threeStarCount: 20, fourStarCount: 60, fiveStarCount: 80 },
  reviews: [],
  openNow: null,
  businessStatus: null,
  sourceUrl: null,
  ...over,
});

const ctx = { provider: 'dataforseo', settings: DEFAULT_SETTINGS };
const save = (over?: Partial<NormalizedBusiness>) => upsertBusinessAsLead(listing(over), ctx);
const rows = () => prisma.lead.count({ where: { businessName: { contains: MARK } } });
const clean = () => prisma.lead.deleteMany({ where: { businessName: { contains: MARK } } });

await clean();

await t('the same listing twice is one lead', async () => {
  await clean();
  const first = await save();
  const second = await save();
  assert.equal(first.created, true);
  assert.equal(second.created, false, 'the second sighting must merge');
  assert.equal(await rows(), 1);
});

await t('a different place id for the same business still merges', async () => {
  await clean();
  await save();
  const again = await save({ externalId: 'place-2' });
  assert.equal(again.created, false, 'Google carries duplicate listings for one business');
  assert.equal(await rows(), 1);
});

await t('a branch suffix in the name does not create a second lead', async () => {
  await clean();
  await save();
  const again = await save({ externalId: 'place-3', name: `${MARK} Centre Dentaire Terreaux - Lyon 1` });
  assert.equal(again.created, false, 'same phone, same postcode — same business');
  assert.equal(await rows(), 1);
});

await t('a differently formatted phone number does not create a second lead', async () => {
  await clean();
  await save();
  const again = await save({ externalId: 'place-4', phone: '04 78 00 00 00' });
  assert.equal(again.created, false);
  assert.equal(await rows(), 1);
});

await t('a listing with no phone merges on its website and postcode', async () => {
  await clean();
  await save();
  const again = await save({ externalId: 'place-5', phone: null, address: null });
  assert.equal(again.created, false);
  assert.equal(await rows(), 1);
});

await t('a real second branch is kept apart', async () => {
  await clean();
  await save();
  const branch = await save({
    externalId: 'place-6',
    phone: '+33 4 78 99 99 99',
    address: '5 Avenue Jean Jaurès, 69007 Lyon',
    postalCode: '69007',
  });
  assert.equal(branch.created, true, 'different number and different postcode is a different prospect');
  assert.equal(await rows(), 2);
});

await t('a chain is not collapsed by its shared website', async () => {
  await clean();
  await save({ name: `${MARK} Chain Lyon`, website: 'https://chain.example', phone: '+33 4 11 11 11 11' });
  const other = await save({
    externalId: 'place-7',
    name: `${MARK} Chain Villeurbanne`,
    website: 'https://chain.example',
    phone: '+33 4 22 22 22 22',
    postalCode: '69100',
    city: 'Villeurbanne',
    address: '1 Rue Test, 69100 Villeurbanne',
  });
  assert.equal(other.created, true, 'branches of one chain are separate prospects');
  assert.equal(await rows(), 2);
});

await t('a sparser re-sighting fills gaps but never erases what is known', async () => {
  await clean();
  await save();
  await save({ externalId: 'place-8', phone: null, website: null, address: null });

  const lead = await prisma.lead.findFirstOrThrow({ where: { businessName: { contains: MARK } } });
  assert.equal(lead.phone, '+33 4 78 00 00 00', 'the phone must survive — it is the fallback when no email exists');
  assert.equal(lead.website, 'https://terreaux.example');
  assert.ok(lead.address);
});

await t('review figures are refreshed on a re-sighting', async () => {
  await clean();
  await save();
  await save({
    externalId: 'place-9',
    rating: 3.1,
    reviewCount: 260,
    ratingBreakdown: { oneStarCount: 80, twoStarCount: 20, threeStarCount: 30, fourStarCount: 60, fiveStarCount: 70 },
  });

  const lead = await prisma.lead.findFirstOrThrow({ where: { businessName: { contains: MARK } } });
  assert.equal(lead.rating, 3.1, 'the newer review profile is the point of seeing it again');
  assert.equal(lead.reviewCount, 260);
  assert.equal(lead.badReviewCount, 100);
});

await t('the operator’s own work is never overwritten', async () => {
  await clean();
  const { lead } = await save();
  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: 'CONTACTED', email: 'contact@terreaux.example', emailStatus: 'FOUND' },
  });

  await save({ externalId: 'place-10' });
  const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(after.status, 'CONTACTED');
  assert.equal(after.email, 'contact@terreaux.example');
});

await clean();
await prisma.$disconnect();

console.log(`\n${pass}/${pass + failures.length} dedupe checks passed`);
if (failures.length) process.exit(1);
