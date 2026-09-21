import type { ProviderCapabilities } from '@/lib/providers/business/BusinessDataProvider';

/**
 * Indicative provider usage for a search, shown before it is run.
 *
 * Built from the provider's own two-part tariff rather than a hand-entered
 * price per business. Multiplying the record count by a single rate treated
 * the fixed per-request fee as though it were charged for every record, which
 * over-stated a 200-record search by around twenty-five times — enough to make
 * a cheap search look like a decision worth hesitating over.
 */
export function estimateSearchCost(
  limit: number,
  capabilities: Pick<ProviderCapabilities, 'pricing' | 'resultsPerRequest'>,
): { requests: number; amount: number; cost: string } {
  const perPage = Math.max(1, capabilities.resultsPerRequest);
  const requests = Math.max(1, Math.ceil(limit / perPage));
  const pricing = capabilities.pricing;
  if (!pricing) return { requests, amount: 0, cost: 'No provider cost' };

  // The exact figure is kept separate from the rendered one: these amounts run
  // to five decimal places and rounding them for display must not become the
  // number the rest of the app reasons about.
  const amount = requests * pricing.perRequest + limit * pricing.perResult;
  const shown = amount >= 1 ? amount.toFixed(2) : amount.toPrecision(3);
  return { requests, amount, cost: `${shown} ${pricing.currency}` };
}
