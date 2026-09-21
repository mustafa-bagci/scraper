/**
 * DataForSEO provider.
 *
 * The network is not reachable from here, so the live API is stubbed and what
 * is tested is everything this app is actually responsible for: the request it
 * builds, and what it makes of the response — above all that a published
 * rating distribution turns into correct bad-review counts, which is the whole
 * reason for choosing this provider.
 *
 * Run with: npm run test:dataforseo
 */
import assert from 'node:assert/strict';
import { DataForSEOProvider, buildTask, toBreakdown, toCountryCode } from '../src/lib/providers/business/DataForSEOProvider';
import { computeReviewStats } from '../src/lib/reviews/stats';
import { scoreLead } from '../src/lib/scoring/engine';
import { DEFAULT_REVIEW_SETTINGS, DEFAULT_SCORING } from '../src/types/settings';

let pass = 0;
const failures: string[] = [];
const t = async (name: string, fn: () => Promise<void> | void) => {
  try {
    await fn();
    pass += 1;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`FAIL  ${name} — ${(e as Error).message}`);
  }
};

/** A listing shaped the way DataForSEO documents it. */
const LISTING = {
  title: 'Cabinet Dentaire Dupont',
  category: 'Dentist',
  additional_categories: ['Dental clinic'],
  address: '12 Rue de la République, 69001 Lyon, France',
  address_info: { address: '12 Rue de la République', city: 'Lyon', zip: '69001', region: 'Auvergne-Rhône-Alpes', country_code: 'FR' },
  place_id: 'ChIJxxxxxxxxxxxx',
  phone: '+33 4 78 00 00 00',
  url: 'https://cabinet-dupont.fr',
  domain: 'cabinet-dupont.fr',
  latitude: 45.764,
  longitude: 4.8357,
  is_claimed: true,
  check_url: 'https://www.google.com/maps/place/?q=place_id:ChIJxxxxxxxxxxxx',
  rating: { rating_type: 'Max5', value: 3.8, votes_count: 247 },
  rating_distribution: { '1': 18, '2': 13, '3': 27, '4': 51, '5': 138 },
};

function stubFetch(payload: unknown, status = 200) {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return calls;
}

const okResponse = (items: unknown[], total = items.length) => ({
  status_code: 20000,
  status_message: 'Ok.',
  cost: 0.002,
  tasks: [{ status_code: 20000, status_message: 'Ok.', result: [{ total_count: total, count: items.length, items }] }],
});

// --- request ----------------------------------------------------------------

await t('country names map to ISO codes, codes pass through', () => {
  assert.equal(toCountryCode('France'), 'FR');
  assert.equal(toCountryCode('Belgique'), 'BE');
  assert.equal(toCountryCode('belgië'), 'BE');
  assert.equal(toCountryCode('be'), 'BE');
  assert.equal(toCountryCode('Atlantis'), undefined);
  assert.equal(toCountryCode(undefined), undefined);
});

await t('location constraints are pushed to the API, separated by "and"', () => {
  const task = buildTask({ country: 'France', city: 'Lyon', category: 'Dentiste', limit: 100 }, 0, 100);
  const filters = task.filters as unknown[];

  assert.deepEqual(filters[0], ['address_info.country_code', '=', 'FR']);
  assert.equal(filters[1], 'and', 'DataForSEO interleaves filters with literal separators');
  assert.deepEqual(filters[2], ['address_info.city', '=', 'Lyon']);
  assert.deepEqual(task.categories, ['dentiste'], 'accents are stripped and spaces become underscores');
  assert.equal(task.limit, 100);
  assert.equal(task.offset, 0);
});

await t('review constraints are pushed down so discards are never billed', () => {
  const task = buildTask(
    { country: 'France', city: 'Lyon', category: 'dentist', ratingMax: 4.2, reviewCountMin: 30, limit: 50 },
    0,
    50,
  );
  const encoded = JSON.stringify(task.filters);

  assert.ok(encoded.includes('["rating.value","<=",4.2]'), 'the rating ceiling must reach the API');
  assert.ok(encoded.includes('["rating.votes_count",">=",30]'), 'the review floor must reach the API');
});

await t('no more than eight conditions are sent', () => {
  const task = buildTask(
    {
      country: 'France', city: 'Lyon', region: 'ARA', postalCode: '690',
      ratingMin: 1, ratingMax: 4.2, reviewCountMin: 30, reviewCountMax: 5000,
      category: 'dentist', limit: 50,
    },
    0,
    50,
  );
  // Conditions and their "and" separators interleave, so eight conditions is
  // fifteen entries. DataForSEO rejects anything longer.
  assert.ok((task.filters as unknown[]).length <= 15, 'the expression must stay within the provider limit');
});

await t('a free-text keyword searches the title, not the taxonomy', () => {
  const task = buildTask({ keyword: 'cabinet urgence', limit: 50 }, 0, 50);
  assert.equal(task.title, 'cabinet urgence');
  assert.equal(task.categories, undefined);
});

await t('credentials are sent as HTTP Basic', async () => {
  const calls = stubFetch(okResponse([LISTING]));
  await new DataForSEOProvider('login@example.com:secretpass').searchBusinesses({ limit: 1 });

  const expected = `Basic ${Buffer.from('login@example.com:secretpass').toString('base64')}`;
  assert.equal(calls[0]?.headers.authorization, expected);
  assert.ok(Array.isArray(calls[0]?.body), 'every DataForSEO endpoint takes an array of tasks');
});

// --- response ---------------------------------------------------------------

await t('a listing becomes a normalised business', async () => {
  stubFetch(okResponse([LISTING]));
  const page = await new DataForSEOProvider('u:p').searchBusinesses({ limit: 1 });
  const business = page.businesses[0]!;

  assert.equal(business.externalId, 'ChIJxxxxxxxxxxxx');
  assert.equal(business.name, 'Cabinet Dentaire Dupont');
  assert.equal(business.city, 'Lyon');
  assert.equal(business.postalCode, '69001');
  assert.equal(business.countryCode, 'FR');
  assert.equal(business.phone, '+33 4 78 00 00 00');
  assert.equal(business.website, 'https://cabinet-dupont.fr/');
  assert.equal(business.rating, 3.8);
  assert.equal(business.reviewCount, 247);
  assert.deepEqual(business.categories, ['Dentist', 'Dental clinic']);
});

await t('the rating distribution drives the bad-review numbers', async () => {
  stubFetch(okResponse([LISTING]));
  const page = await new DataForSEOProvider('u:p').searchBusinesses({ limit: 1 });
  const business = page.businesses[0]!;

  assert.deepEqual(business.ratingBreakdown, {
    oneStarCount: 18,
    twoStarCount: 13,
    threeStarCount: 27,
    fourStarCount: 51,
    fiveStarCount: 138,
  });

  // This is the point of the provider: the columns Google cannot fill.
  const stats = computeReviewStats(business.ratingBreakdown, business.reviewCount, DEFAULT_REVIEW_SETTINGS);
  assert.equal(stats.breakdownAvailable, true);
  assert.equal(stats.badReviewCount, 31);
  assert.equal(stats.badReviewPercentage, 12.55);

  const score = scoreLead(
    {
      rating: business.rating,
      reviewCount: stats.reviewCount,
      badReviewCount: stats.badReviewCount,
      badReviewPercentage: stats.badReviewPercentage,
      email: null,
      website: business.website,
      phone: business.phone,
    },
    DEFAULT_SCORING,
  );
  // rating<=4 (25) + reviews>=100 (20) + bad%>=10 (20) + website (5) + phone (5)
  assert.equal(score.score, 75);
});

await t('a missing or empty distribution is reported as unavailable, never as zero', async () => {
  assert.equal(toBreakdown(undefined), null);
  assert.equal(toBreakdown({}), null);
  assert.equal(toBreakdown({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }), null, 'all zeros carry no information');

  stubFetch(okResponse([{ ...LISTING, rating_distribution: undefined }]));
  const page = await new DataForSEOProvider('u:p').searchBusinesses({ limit: 1 });
  assert.equal(page.businesses[0]?.ratingBreakdown, null);

  const stats = computeReviewStats(null, 247, DEFAULT_REVIEW_SETTINGS);
  assert.equal(stats.breakdownAvailable, false);
  assert.equal(stats.badReviewCount, 0);
});

await t('the cost the provider reports is passed on', async () => {
  stubFetch({ ...okResponse([LISTING]), cost: 0.01236 });
  const page = await new DataForSEOProvider('u:p').searchBusinesses({ limit: 1 });
  assert.equal(page.providerCost, 0.01236, 'spend has to reach the operator, not just the logs');
});

await t('a mapping check costs one request, not two', async () => {
  const calls = stubFetch(okResponse([LISTING]));
  const probed = await new DataForSEOProvider('u:p').probe({ city: 'Lyon', category: 'dentist', limit: 1 });

  assert.equal(calls.length, 1, 'the probe must answer the query rather than adding a second one');
  assert.equal(probed.businesses.length, 1);
  assert.ok(probed.raw, 'the raw payload is what makes a mapping correctable');

  // It answers the caller's query, not an unfiltered one over the whole database.
  const task = (calls[0]!.body as unknown[])[0] as Record<string, unknown>;
  assert.deepEqual(task.categories, ['dentist']);
  assert.ok(JSON.stringify(task.filters).includes('Lyon'));
});

await t('paging continues while the provider has more', async () => {
  stubFetch(okResponse(Array.from({ length: 100 }, () => LISTING), 250));
  const page = await new DataForSEOProvider('u:p').searchBusinesses({ limit: 250 });
  assert.equal(page.businesses.length, 100);
  assert.equal(page.nextPageToken, '100');

  stubFetch(okResponse(Array.from({ length: 50 }, () => LISTING), 250));
  const last = await new DataForSEOProvider('u:p').searchBusinesses({ limit: 150 }, '100');
  assert.equal(last.nextPageToken, null, 'stops at the requested limit, not the provider total');
});

// --- failures ---------------------------------------------------------------

await t('bad credentials produce a message the operator can act on', async () => {
  stubFetch({ status_code: 40100, status_message: 'Unauthorized.' }, 401);
  await assert.rejects(() => new DataForSEOProvider('u:p').searchBusinesses({ limit: 1 }), /credentials/i);
});

await t('an error reported inside a 200 response is still an error', async () => {
  // DataForSEO signals problems in the body, not the HTTP status.
  stubFetch({ status_code: 40201, status_message: 'Insufficient funds.', tasks: [] });
  await assert.rejects(() => new DataForSEOProvider('u:p').searchBusinesses({ limit: 1 }), /Insufficient funds/);
});

await t('a task-level failure is surfaced too', async () => {
  stubFetch({
    status_code: 20000,
    status_message: 'Ok.',
    tasks: [{ status_code: 40501, status_message: 'Invalid Field: filters.' }],
  });
  await assert.rejects(() => new DataForSEOProvider('u:p').searchBusinesses({ limit: 1 }), /Invalid Field/);
});

await t('an unreadable payload fails loudly rather than silently returning nothing', async () => {
  stubFetch({ unexpected: true });
  await assert.rejects(() => new DataForSEOProvider('u:p').searchBusinesses({ limit: 1 }), /could not read/);
});

await t('missing credentials are refused before any call is made', async () => {
  const provider = new DataForSEOProvider(null);
  assert.equal(provider.isConfigured(), false);
  await assert.rejects(() => provider.searchBusinesses({ limit: 1 }), /Settings/);

  const malformed = new DataForSEOProvider('just-a-key-without-a-colon');
  assert.equal(malformed.isConfigured(), false);
  await assert.rejects(() => malformed.searchBusinesses({ limit: 1 }), /login:password/);
});

console.log(`\n${pass}/${pass + failures.length} DataForSEO checks passed`);
if (failures.length) process.exit(1);
