/**
 * The pre-search cost estimate, against the rates this account was actually
 * billed: one record at $0.01236 and five at $0.01380 — exactly
 * 0.012 per request + 0.00036 per record.
 *
 * Run with: npm run test:pricing
 */
import assert from 'node:assert/strict';
import { estimateSearchCost } from '../src/lib/providers/pricing';
import { DataForSEOProvider } from '../src/lib/providers/business/DataForSEOProvider';
import { MockBusinessProvider } from '../src/lib/providers/business/MockBusinessProvider';

let pass = 0;
const failures: string[] = [];
const t = (name: string, fn: () => void) => {
  try { fn(); pass += 1; console.log(`PASS  ${name}`); }
  catch (e) { failures.push(name); console.log(`FAIL  ${name} — ${(e as Error).message}`); }
};

const dfs = new DataForSEOProvider('user:pass').capabilities;
const cost = (limit: number) => estimateSearchCost(limit, dfs).amount;

t('one record matches what the account was billed', () => {
  // 0.012 + 1 × 0.00036
  assert.equal(cost(1).toFixed(5), '0.01236');
});

t('five records match what the account was billed', () => {
  // 0.012 + 5 × 0.00036
  assert.equal(cost(5).toFixed(5), '0.01380');
});

t('a full page is one request, not one per record', () => {
  const { requests } = estimateSearchCost(dfs.resultsPerRequest, dfs);
  assert.equal(requests, 1);
  // 0.012 + 200 × 0.00036 = 0.084 — not 200 × 0.0124 = 2.48.
  assert.equal(cost(200).toFixed(4), '0.0840');
});

t('the old per-record estimate was out by about twenty-five times', () => {
  const old = 200 * 0.0124;
  assert.ok(old / cost(200) > 20, `expected a large gap, got ${(old / cost(200)).toFixed(1)}×`);
});

t('a search spanning several pages pays the fee once per page', () => {
  const limit = 500;
  const { requests } = estimateSearchCost(limit, dfs);
  assert.equal(requests, Math.ceil(limit / dfs.resultsPerRequest));
  assert.equal(cost(limit).toFixed(4), (requests * 0.012 + limit * 0.00036).toFixed(4));
});

t('a bigger page costs less, which is why the page size was raised', () => {
  const at100 = estimateSearchCost(500, { pricing: dfs.pricing, resultsPerRequest: 100 });
  const at200 = estimateSearchCost(500, dfs);
  assert.ok(at200.amount < at100.amount, 'fewer requests must cost less');
  assert.equal(at100.requests, 5);
  assert.equal(at200.requests, 3);
});

t('the demo provider is free, and says so rather than showing 0.00', () => {
  const mock = new MockBusinessProvider().capabilities;
  assert.equal(estimateSearchCost(100, mock).cost, 'No provider cost');
});

t('what is shown never rounds a real cost away to nothing', () => {
  const small = estimateSearchCost(1, dfs);
  assert.match(small.cost, /^0\.0124 USD$/, `tiny amounts stay visible, got ${small.cost}`);
  assert.match(estimateSearchCost(100000, dfs).cost, /^\d+\.\d{2} USD$/);
  // The rendered figure is a rounding of the exact one, never a replacement.
  assert.equal(small.amount.toFixed(5), '0.01236');
});

console.log(`\n${pass}/${pass + failures.length} pricing checks passed`);
if (failures.length) process.exit(1);
