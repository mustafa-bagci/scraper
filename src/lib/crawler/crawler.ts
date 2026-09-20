import 'server-only';
import { fetchPage } from './fetcher';
import { ALLOW_ALL, isPathAllowed, parseRobots, type RobotsRules } from './robots';
import { extractEmailsFromHtml, extractLinks, type ExtractedEmail } from '@/lib/email/extract';
import { assertPublicUrl, toAbsoluteUrl } from '@/lib/security/ssrf';
import { sleep } from '@/lib/providers/http';
import type { CrawlerSettings } from '@/types/settings';

/**
 * Lightweight crawler for a single business website.
 *
 * Walks only publicly reachable pages on the same registrable domain, in the
 * order that most often carries contact details:
 *
 *   homepage → contact → about → legal/imprint → footer-linked pages
 *
 * It never submits forms, never follows links behind authentication, and
 * never attempts to defeat a bot protection. A 403 is recorded as a 403.
 */

const PAGE_PRIORITIES: Array<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /(^|\/)(contact|contacts|contactez[-_]?nous|nous[-_]?contacter|contacteer)(\/|\.|$)/i, weight: 100, label: 'contact' },
  { pattern: /(^|\/)(mentions[-_]?legales|mentions|impressum|imprint|legal|legal[-_]?notice)(\/|\.|$)/i, weight: 90, label: 'legal' },
  { pattern: /(^|\/)(a[-_]?propos|about|about[-_]?us|qui[-_]?sommes[-_]?nous|over[-_]?ons)(\/|\.|$)/i, weight: 80, label: 'about' },
  { pattern: /(^|\/)(equipe|team|notre[-_]?equipe|cabinet|praxis)(\/|\.|$)/i, weight: 60, label: 'team' },
  { pattern: /(^|\/)(rendez[-_]?vous|devis|reservation|booking)(\/|\.|$)/i, weight: 50, label: 'booking' },
  { pattern: /(^|\/)(privacy|confidentialite|politique[-_]?de[-_]?confidentialite|cgv|cgu)(\/|\.|$)/i, weight: 40, label: 'policy' },
];

const LINK_TEXT_PRIORITIES: Array<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /contact|contactez|nous écrire|nous ecrire/i, weight: 95, label: 'contact' },
  { pattern: /mentions légales|mentions legales|impressum|imprint/i, weight: 85, label: 'legal' },
  { pattern: /à propos|a propos|about|qui sommes/i, weight: 75, label: 'about' },
];

const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|svg|webp|zip|rar|mp4|mp3|avi|docx?|xlsx?|pptx?|csv)(\?|$)/i;

export type CrawledPage = {
  url: string;
  status: number | null;
  ok: boolean;
  label: string;
  emails: ExtractedEmail[];
  reason?: string;
};

export type CrawlResult = {
  startUrl: string;
  domain: string | null;
  pagesVisited: CrawledPage[];
  /** Deduplicated addresses with the page each was first seen on. */
  emails: Array<ExtractedEmail & { sourceUrl: string; sourceLabel: string }>;
  robotsRespected: boolean;
  blockedByRobots: string[];
  error: string | null;
};

export async function crawlWebsiteForEmails(
  websiteUrl: string,
  settings: CrawlerSettings,
  blockedHosts: string[] = [],
): Promise<CrawlResult> {
  const absolute = toAbsoluteUrl(websiteUrl);
  const base: CrawlResult = {
    startUrl: websiteUrl,
    domain: null,
    pagesVisited: [],
    emails: [],
    robotsRespected: settings.respectRobotsTxt,
    blockedByRobots: [],
    error: null,
  };

  if (!absolute) return { ...base, error: 'The website address could not be parsed.' };

  const check = await assertPublicUrl(absolute, blockedHosts);
  if (!check.ok) return { ...base, error: `Refused to fetch: ${check.reason}` };

  const origin = check.url.origin;
  const domain = check.url.hostname.replace(/^www\./, '');

  const robots = settings.respectRobotsTxt ? await loadRobots(origin, settings, blockedHosts) : ALLOW_ALL;
  const politeDelay = Math.max(settings.requestDelayMs, robots.crawlDelayMs ?? 0);

  const visited = new Set<string>();
  const blockedByRobots: string[] = [];
  const pages: CrawledPage[] = [];
  const emails = new Map<string, ExtractedEmail & { sourceUrl: string; sourceLabel: string }>();

  type QueueItem = { url: string; weight: number; label: string };
  const queue: QueueItem[] = [{ url: check.url.toString(), weight: 1000, label: 'homepage' }];

  while (queue.length > 0 && pages.length < settings.maxPagesPerDomain) {
    queue.sort((a, b) => b.weight - a.weight);
    const item = queue.shift();
    if (!item) break;

    const key = canonicalise(item.url);
    if (visited.has(key)) continue;
    visited.add(key);

    let pathname = '/';
    try {
      pathname = new URL(item.url).pathname;
    } catch {
      continue;
    }

    if (settings.respectRobotsTxt && !isPathAllowed(pathname, robots)) {
      blockedByRobots.push(item.url);
      continue;
    }

    if (pages.length > 0 && politeDelay > 0) await sleep(politeDelay);

    const response = await fetchPage(item.url, settings, blockedHosts);

    if (!response.ok) {
      pages.push({ url: item.url, status: response.status ?? null, ok: false, label: item.label, emails: [], reason: response.reason });
      continue;
    }

    const pageEmails = extractEmailsFromHtml(response.html, domain);
    pages.push({ url: response.finalUrl, status: response.status, ok: true, label: item.label, emails: pageEmails });

    for (const email of pageEmails) {
      const existing = emails.get(email.email);
      if (!existing || email.score > existing.score) {
        emails.set(email.email, { ...email, sourceUrl: response.finalUrl, sourceLabel: item.label });
      }
    }

    // Queue same-origin candidates worth visiting next.
    for (const link of extractLinks(response.html, response.finalUrl)) {
      if (queue.length > 60) break;
      const candidate = scoreLink(link.href, link.text, origin);
      if (!candidate) continue;
      if (visited.has(canonicalise(candidate.url))) continue;
      queue.push(candidate);
    }
  }

  return {
    startUrl: websiteUrl,
    domain,
    pagesVisited: pages,
    emails: [...emails.values()].sort((a, b) => b.score - a.score),
    robotsRespected: settings.respectRobotsTxt,
    blockedByRobots,
    error: pages.some((p) => p.ok) ? null : (pages[0]?.reason ?? 'The website could not be reached.'),
  };
}

async function loadRobots(origin: string, settings: CrawlerSettings, blockedHosts: string[]): Promise<RobotsRules> {
  const response = await fetchPage(`${origin}/robots.txt`, { ...settings, timeoutMs: Math.min(settings.timeoutMs, 6000) }, blockedHosts);
  if (!response.ok) return ALLOW_ALL;
  return parseRobots(response.html, settings.userAgent);
}

function scoreLink(href: string, text: string, origin: string): { url: string; weight: number; label: string } | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (url.origin !== origin) return null;
  if (SKIP_EXTENSIONS.test(url.pathname)) return null;
  if (url.pathname.split('/').filter(Boolean).length > 3) return null;

  url.hash = '';

  for (const priority of PAGE_PRIORITIES) {
    if (priority.pattern.test(url.pathname)) {
      return { url: url.toString(), weight: priority.weight, label: priority.label };
    }
  }
  for (const priority of LINK_TEXT_PRIORITIES) {
    if (priority.pattern.test(text)) {
      return { url: url.toString(), weight: priority.weight - 10, label: priority.label };
    }
  }
  return null;
}

function canonicalise(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${path}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
