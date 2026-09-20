import { extractDomain } from '@/lib/dedupe/service';
import type { EmailCandidate, EmailFinderProvider, FindEmailsInput, FindEmailsResult } from './EmailFinderProvider';

const GENERIC_PREFIXES = ['contact', 'info', 'bonjour', 'hello', 'office', 'commercial', 'direction'];

/**
 * Offline email finder for development and demos.
 *
 * Produces a deterministic result per domain — including a realistic share of
 * businesses with no published address — so bulk discovery, progress reporting
 * and "not found" states can all be exercised without network access.
 */
export class MockEmailFinder implements EmailFinderProvider {
  readonly id = 'mock';
  readonly name = 'Mock email finder (demo data)';

  isConfigured(): boolean {
    return true;
  }

  async findEmails(input: FindEmailsInput): Promise<FindEmailsResult> {
    await new Promise((resolve) => setTimeout(resolve, 80));

    const domain = input.domain ?? extractDomain(input.website);
    if (!input.website || !domain) {
      return { candidates: [], pagesChecked: [], providerCalls: 0, error: 'No website on record for this business.' };
    }

    const seed = hash(domain);
    const pagesChecked = [
      { url: `https://${domain}/`, ok: true, status: 200 },
      { url: `https://${domain}/contact`, ok: true, status: 200 },
    ];

    // Roughly one business in five publishes no address at all.
    if (seed % 5 === 0) {
      return {
        candidates: [],
        pagesChecked,
        providerCalls: pagesChecked.length,
        error: `No public email published on ${domain}.`,
      };
    }

    const prefix = GENERIC_PREFIXES[seed % GENERIC_PREFIXES.length] ?? 'contact';
    const candidates: EmailCandidate[] = [
      {
        email: `${prefix}@${domain}`,
        source: `${this.id}:contact`,
        sourceUrl: `https://${domain}/contact`,
        isGeneric: true,
        score: 140,
      },
    ];

    if (seed % 3 === 0) {
      candidates.push({
        email: `direction@${domain}`,
        source: `${this.id}:legal`,
        sourceUrl: `https://${domain}/mentions-legales`,
        isGeneric: true,
        score: 110,
      });
    }

    return { candidates, pagesChecked, providerCalls: pagesChecked.length, error: null };
  }
}

function hash(value: string): number {
  let result = 5381;
  for (let i = 0; i < value.length; i += 1) result = ((result << 5) + result + value.charCodeAt(i)) >>> 0;
  return result;
}
