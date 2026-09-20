import 'server-only';
import { crawlWebsiteForEmails } from '@/lib/crawler/crawler';
import { extractDomain } from '@/lib/dedupe/service';
import type { CrawlerSettings } from '@/types/settings';
import type { EmailCandidate, EmailFinderProvider, FindEmailsInput, FindEmailsResult } from './EmailFinderProvider';

/**
 * Finds public business emails by crawling the business's own website.
 *
 * This is the default finder: it needs no third-party API key, and every
 * address it returns carries the exact public page it was read from, which is
 * what the provenance (`emailSource`) field records.
 */
export class WebsiteEmailFinder implements EmailFinderProvider {
  readonly id = 'website-crawler';
  readonly name = 'Website crawler (public pages)';

  constructor(
    private readonly settings: CrawlerSettings,
    private readonly blockedHosts: string[] = [],
  ) {}

  isConfigured(): boolean {
    return true;
  }

  async findEmails(input: FindEmailsInput): Promise<FindEmailsResult> {
    if (!input.website) {
      return {
        candidates: [],
        pagesChecked: [],
        providerCalls: 0,
        error: 'No website on record for this business.',
      };
    }

    const result = await crawlWebsiteForEmails(input.website, this.settings, this.blockedHosts);
    const siteDomain = result.domain ?? extractDomain(input.website);

    const candidates: EmailCandidate[] = result.emails.map((email) => ({
      email: email.email,
      source: `${this.id}:${email.sourceLabel}`,
      sourceUrl: email.sourceUrl,
      isGeneric: email.isGeneric,
      score: adjustScore(email.score, email.isGeneric, this.settings.preferGenericMailboxes),
    }));

    candidates.sort((a, b) => b.score - a.score);

    return {
      candidates,
      pagesChecked: result.pagesVisited.map((page) => ({
        url: page.url,
        ok: page.ok,
        status: page.status,
        reason: page.reason,
      })),
      providerCalls: result.pagesVisited.length,
      error: candidates.length > 0 ? null : (result.error ?? `No public email published on ${siteDomain ?? 'the website'}.`),
    };
  }
}

function adjustScore(score: number, isGeneric: boolean, preferGeneric: boolean): number {
  if (!preferGeneric) return score;
  return isGeneric ? score + 30 : score;
}
