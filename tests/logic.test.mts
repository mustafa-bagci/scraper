/**
 * Logic tests for the security-critical and business-critical pure modules:
 * SSRF policy, public-email extraction, review statistics, lead scoring, the
 * shared filter engine, duplicate detection and robots.txt handling.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { assertPublicUrl, isPrivateIPv4, isPrivateIPv6 } from '../src/lib/security/ssrf';
import { extractEmailsFromHtml, normalizeEmail, classifyEmail } from '../src/lib/email/extract';
import { scoreLead } from '../src/lib/scoring/engine';
import { computeReviewStats } from '../src/lib/reviews/stats';
import { matchesFilters } from '../src/lib/filters/engine';
import { buildDedupeKeys, normalizePhone } from '../src/lib/dedupe/service';
import { isPathAllowed, parseRobots } from '../src/lib/crawler/robots';
import { DEFAULT_SCORING, DEFAULT_REVIEW_SETTINGS } from '../src/types/settings';

let pass = 0;
const fail: string[] = [];
function t(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass += 1; console.log(`PASS  ${name}`); })
    .catch((e) => { fail.push(name); console.log(`FAIL  ${name} — ${e.message}`); });
}

await t('SSRF: private IPv4 ranges blocked', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.5.4', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1'])
    assert.equal(isPrivateIPv4(ip), true, ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '1.1.1.1']) assert.equal(isPrivateIPv4(ip), false, ip);
});

await t('SSRF: private IPv6 + IPv4-mapped blocked', () => {
  for (const ip of ['::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', 'ff02::1'])
    assert.equal(isPrivateIPv6(ip), true, ip);
  assert.equal(isPrivateIPv6('2606:4700:4700::1111'), false);
});

await t('SSRF: literal + hostname refusals', async () => {
  for (const url of [
    'http://127.0.0.1/admin', 'http://localhost:8080/', 'https://169.254.169.254/latest/meta-data/',
    'http://[::1]/', 'file:///etc/passwd', 'gopher://x/', 'http://metadata.google.internal/',
    'http://user:pw@example.com/', 'http://router.local/', 'http://10.0.0.5/',
  ]) {
    const r = await assertPublicUrl(url);
    assert.equal(r.ok, false, `${url} should be refused`);
  }
});

await t('SSRF: operator blocklist honoured', async () => {
  const r = await assertPublicUrl('https://example.com/', ['example.com']);
  assert.equal(r.ok, false);
});

await t('Email: normalisation and rejection', () => {
  assert.equal(normalizeEmail('  Contact@Example.FR '), 'contact@example.fr');
  assert.equal(normalizeEmail('mailto:info@murgay.fr?subject=x'), 'info@murgay.fr');
  assert.equal(normalizeEmail('bad@@x.fr'), null);
  assert.equal(normalizeEmail('logo@2x.png'), null);
  assert.equal(normalizeEmail('nodomain@'), null);
});

await t('Email: extraction from HTML incl. obfuscation', () => {
  const html = `
    <html><head><style>.a{content:"x@y.zz"}</style><script>track("abc123@sentry.io")</script></head>
    <body><a href="mailto:contact@cabinet.fr">Contact</a>
    <p>Ou écrivez à direction [at] cabinet [dot] fr</p>
    <footer>noreply@cabinet.fr</footer></body></html>`;
  const found = extractEmailsFromHtml(html, 'cabinet.fr').map((e) => e.email);
  assert.ok(found.includes('contact@cabinet.fr'), 'mailto missed');
  assert.ok(found.includes('direction@cabinet.fr'), 'obfuscated missed');
  assert.ok(!found.includes('noreply@cabinet.fr'), 'noreply not filtered');
  assert.ok(!found.some((e) => e.includes('sentry')), 'script content leaked');
  assert.equal(found[0], 'contact@cabinet.fr', 'generic on-domain should rank first');
});

await t('Email: classification ranks on-domain generic highest', () => {
  const a = classifyEmail('contact@cabinet.fr', 'cabinet.fr');
  const b = classifyEmail('jean.dupont@gmail.com', 'cabinet.fr');
  assert.ok(a.score > b.score);
  assert.equal(a.isGeneric, true);
  assert.equal(b.isFreemail, true);
});

await t('Reviews: bad-review definition is configurable', () => {
  const breakdown = { oneStarCount: 18, twoStarCount: 13, threeStarCount: 27, fourStarCount: 51, fiveStarCount: 138 };
  const d = computeReviewStats(breakdown, 247, { badReviewStars: [1, 2] });
  assert.equal(d.badReviewCount, 31);
  assert.equal(d.badReviewPercentage, 12.55);
  const wide = computeReviewStats(breakdown, 247, { badReviewStars: [1, 2, 3] });
  assert.equal(wide.badReviewCount, 58);
});

await t('Reviews: missing breakdown is never invented', () => {
  const s = computeReviewStats(null, 247, DEFAULT_REVIEW_SETTINGS);
  assert.equal(s.breakdownAvailable, false);
  assert.equal(s.badReviewCount, 0);
  assert.equal(s.oneStarCount, 0);
  assert.equal(s.reviewCount, 247);
});

await t('Scoring: a clearly hurting business scores high', () => {
  const r = scoreLead(
    { rating: 3.8, reviewCount: 247, badReviewCount: 31, badReviewPercentage: 12.55,
      email: 'contact@x.fr', website: 'https://x.fr', phone: '+33 1' },
    DEFAULT_SCORING,
  );
  // rating≤4.2 (15) + ≤3.9 (15) + 30+ reviews (10) + 150+ (10)
  // + bad%≥10 (15) + email (10) + website (5) + phone (5)
  assert.equal(r.score, 85);
  assert.ok(r.score >= DEFAULT_SCORING.qualifiedThreshold, 'must qualify');
  assert.ok(r.contributions.every((c) => typeof c.detail === 'string' && c.detail.length > 0));
});

await t('Scoring: a well-rated business does not qualify, however many reviews', () => {
  // The operator's own rule: a 4.4 is not a prospect. It is worth something —
  // 13% of its customers are angry — but not enough to work.
  const r = scoreLead(
    { rating: 4.4, reviewCount: 1305, badReviewCount: 172, badReviewPercentage: 13.18,
      email: null, website: 'https://x.fr', phone: '+33 4' },
    DEFAULT_SCORING,
  );
  assert.equal(r.score, 45);
  assert.ok(r.score < DEFAULT_SCORING.qualifiedThreshold, 'must not qualify');
  assert.ok(!r.matched.some((c) => c.ruleId.startsWith('rating-')), 'no rating rule may fire above 4.2');
});

await t('Scoring: rating steps compound as the damage gets worse', () => {
  const at = (rating: number) =>
    scoreLead(
      { rating, reviewCount: 200, badReviewCount: 40, badReviewPercentage: 20,
        email: 'a@b.fr', website: 'https://b.fr', phone: '1' },
      DEFAULT_SCORING,
    ).score;

  assert.ok(at(3.4) > at(3.7), 'a 3.4 must outrank a 3.7');
  assert.ok(at(3.7) > at(4.1), 'a 3.7 must outrank a 4.1');
  assert.ok(at(4.1) > at(4.5), 'a 4.1 must outrank a 4.5');
});

await t('Scoring: caps at maxScore and explains every rule', () => {
  const r = scoreLead(
    { rating: 2.0, reviewCount: 900, badReviewCount: 400, badReviewPercentage: 44,
      email: 'a@b.fr', website: 'https://b.fr', phone: '1' },
    DEFAULT_SCORING,
  );
  assert.equal(r.score, 100);
  assert.equal(r.contributions.length, DEFAULT_SCORING.rules.length);
});

await t('Filters: presence and ranges', () => {
  const base = {
    businessName: 'Cabinet Dupont', category: 'Dentiste', categories: ['Dentiste'],
    country: 'France', region: 'ARA', city: 'Lyon', postalCode: '69001', address: '1 rue',
    rating: 3.8, reviewCount: 247, badReviewCount: 31, badReviewPercentage: 12.55,
    oneStarCount: 18, twoStarCount: 13, leadScore: 85,
    website: 'https://x.fr', email: 'contact@x.fr', phone: '+33', openNow: true,
  };
  assert.equal(matchesFilters(base, { rating: { max: 4.2 }, reviewCount: { min: 30, max: 1000 },
    badReviewCount: { min: 10 }, website: 'required', email: 'required' }), true);
  assert.equal(matchesFilters(base, { rating: { max: 3.5 } }), false);
  assert.equal(matchesFilters(base, { email: 'missing' }), false);
  assert.equal(matchesFilters({ ...base, email: null }, { email: 'missing' }), true);
  assert.equal(matchesFilters({ ...base, rating: null }, { rating: { max: 4 } }), false, 'null rating must not pass a range');
  assert.equal(matchesFilters(base, { city: 'lyon' }), true, 'city match should be case-insensitive');
});

await t('Dedupe: stable keys and phone normalisation', () => {
  assert.equal(normalizePhone('+33 1 23 45 67 89'), '123456789');
  assert.equal(normalizePhone('01 23 45 67 89'), '123456789');
  assert.equal(normalizePhone('123'), null);
  const a = buildDedupeKeys({ provider: 'mock', externalId: null, businessName: 'Cabinet Dupont SARL',
    address: '1 Rue de la République', postalCode: '69001', phone: '+33 1 23 45 67 89', website: 'https://x.fr' });
  const b = buildDedupeKeys({ provider: 'mock', externalId: null, businessName: 'cabinet dupont',
    address: '1 rue de la republique', postalCode: '69001', phone: '01 23 45 67 89', website: 'http://www.x.fr' });
  assert.equal(a.dedupeKey, b.dedupeKey, 'legal form / accents / phone format must not create a duplicate');
  const c = buildDedupeKeys({ provider: 'mock', externalId: 'abc', businessName: 'X' });
  assert.notEqual(a.dedupeKey, c.dedupeKey);
});

await t('robots.txt: disallow, allow precedence and wildcards', () => {
  const rules = parseRobots(
    'User-agent: *\nDisallow: /private\nDisallow: /*.pdf$\nAllow: /private/public\nCrawl-delay: 2',
    'MurgayLeadIntelligence/1.0',
  );
  assert.equal(isPathAllowed('/contact', rules), true);
  assert.equal(isPathAllowed('/private/data', rules), false);
  assert.equal(isPathAllowed('/private/public/page', rules), true);
  assert.equal(isPathAllowed('/brochure.pdf', rules), false);
  assert.equal(rules.crawlDelayMs, 2000);
});

console.log(`\n${pass}/${pass + fail.length} logic checks passed`);
if (fail.length) process.exit(1);
