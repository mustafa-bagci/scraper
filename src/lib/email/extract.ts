/**
 * Public email extraction, normalisation and classification.
 *
 * Only addresses that a business publishes on its own website are considered.
 * Nothing here guesses or permutes addresses.
 */

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi;

/** Obfuscations businesses commonly use on public contact pages. */
const DEOBFUSCATIONS: Array<[RegExp, string]> = [
  [/\s*\[\s*at\s*\]\s*/gi, '@'],
  [/\s*\(\s*at\s*\)\s*/gi, '@'],
  [/\s+at\s+/gi, '@'],
  [/\s*\[\s*dot\s*\]\s*/gi, '.'],
  [/\s*\(\s*dot\s*\)\s*/gi, '.'],
  [/\s+dot\s+/gi, '.'],
  [/\s*\[\s*arobase\s*\]\s*/gi, '@'],
  [/\s*\(\s*arobase\s*\)\s*/gi, '@'],
  [/\s*\[\s*point\s*\]\s*/gi, '.'],
  [/\s*\(\s*point\s*\)\s*/gi, '.'],
];

/** Generic business mailboxes, ranked. Higher is preferred. */
export const GENERIC_MAILBOXES: Record<string, number> = {
  contact: 100,
  info: 95,
  bonjour: 90,
  hello: 88,
  office: 85,
  commercial: 82,
  direction: 80,
  accueil: 78,
  secretariat: 76,
  sales: 74,
  enquiries: 72,
  hallo: 70,
  mail: 68,
  administration: 66,
  admin: 64,
  rdv: 60,
  reservation: 58,
  reservations: 56,
  welcome: 54,
  support: 50,
  service: 48,
  client: 46,
  clients: 44,
};

/** Addresses that are never a useful business contact. */
const BLOCKED_LOCAL_PARTS = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'postmaster',
  'abuse',
  'mailer-daemon',
  'bounce',
  'bounces',
  'wordpress',
  'webmaster@example',
  'sentry',
  'example',
  'email',
  'your-email',
  'votre-email',
  'name',
  'username',
]);

const BLOCKED_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'domain.com',
  'yourdomain.com',
  'votredomaine.com',
  'email.com',
  'sentry.io',
  'wixpress.com',
  'wix.com',
  'squarespace.com',
  'godaddy.com',
  'sentry-next.wixpress.com',
]);

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|bmp|ico|css|js|woff2?|ttf)$/i;

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'yopmail.com',
  '10minutemail.com',
  'tempmail.com',
  'trashmail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'sharklasers.com',
  'getnada.com',
  'dispostable.com',
]);

/** Free consumer mailbox providers — valid contacts, but ranked lower. */
const FREEMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.fr',
  'outlook.com',
  'outlook.fr',
  'live.fr',
  'yahoo.com',
  'yahoo.fr',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'sfr.fr',
  'laposte.net',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'telenet.be',
  'skynet.be',
]);

export type ExtractedEmail = {
  email: string;
  localPart: string;
  domain: string;
  isGeneric: boolean;
  isFreemail: boolean;
  isDisposable: boolean;
  /** Higher = better business contact. Used to pick the primary address. */
  score: number;
};

export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/^mailto:/, '').split('?')[0] ?? '';
  const cleaned = trimmed.replace(/^[^a-z0-9]+/, '').replace(/[.,;:'")\]]+$/, '');

  const at = cleaned.lastIndexOf('@');
  if (at <= 0 || at === cleaned.length - 1) return null;

  const localPart = cleaned.slice(0, at);
  const domain = cleaned.slice(at + 1).replace(/\.$/, '');

  if (!/^[a-z0-9._%+-]+$/.test(localPart)) return null;
  if (!/^[a-z0-9.-]+\.[a-z]{2,24}$/.test(domain)) return null;
  if (domain.includes('..') || domain.startsWith('-') || domain.startsWith('.')) return null;
  if (IMAGE_EXTENSIONS.test(cleaned)) return null;

  return `${localPart}@${domain}`;
}

export function isPlausibleBusinessEmail(email: string): boolean {
  const [localPart = '', domain = ''] = email.split('@');
  if (BLOCKED_LOCAL_PARTS.has(localPart)) return false;
  if (BLOCKED_DOMAINS.has(domain)) return false;
  if (/^[0-9a-f]{16,}$/.test(localPart)) return false; // hashed tracking addresses
  if (localPart.length > 64 || domain.length > 253) return false;
  return true;
}

export function classifyEmail(email: string, siteDomain: string | null): ExtractedEmail {
  const [localPart = '', domain = ''] = email.split('@');
  const genericRank = GENERIC_MAILBOXES[localPart.replace(/[0-9._-]+$/, '')] ?? GENERIC_MAILBOXES[localPart];
  const isGeneric = genericRank !== undefined;
  const isFreemail = FREEMAIL_DOMAINS.has(domain);
  const isDisposable = DISPOSABLE_DOMAINS.has(domain);

  let score = genericRank ?? 30;
  if (siteDomain && domainsMatch(domain, siteDomain)) score += 40;
  if (isFreemail) score -= 25;
  if (isDisposable) score -= 80;

  return { email, localPart, domain, isGeneric, isFreemail, isDisposable, score };
}

export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain.toLowerCase());
}

function domainsMatch(a: string, b: string): boolean {
  const left = a.replace(/^www\./, '');
  const right = b.replace(/^www\./, '');
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

/**
 * Pulls candidate addresses out of an HTML document.
 *
 * Scripts and styles are stripped first so tracking-pixel and analytics
 * identifiers do not pollute the results; `mailto:` links are read from the
 * raw markup because they are the strongest signal a page can give.
 */
export function extractEmailsFromHtml(html: string, siteDomain: string | null): ExtractedEmail[] {
  const found = new Map<string, ExtractedEmail>();

  const addCandidate = (raw: string, bonus = 0) => {
    const normalized = normalizeEmail(raw);
    if (!normalized || !isPlausibleBusinessEmail(normalized)) return;
    const classified = classifyEmail(normalized, siteDomain);
    const withBonus = { ...classified, score: classified.score + bonus };
    const existing = found.get(normalized);
    if (!existing || withBonus.score > existing.score) found.set(normalized, withBonus);
  };

  for (const match of html.matchAll(/mailto:([^"'\s>?]+)/gi)) {
    if (match[1]) addCandidate(match[1], 25);
  }

  const text = stripMarkup(html);
  const deobfuscated = applyDeobfuscations(text);

  for (const match of text.matchAll(EMAIL_PATTERN)) addCandidate(match[0]);
  for (const match of deobfuscated.matchAll(EMAIL_PATTERN)) addCandidate(match[0]);

  return [...found.values()].sort((a, b) => b.score - a.score);
}

function stripMarkup(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\s+/g, ' ');
}

function applyDeobfuscations(text: string): string {
  let result = text;
  for (const [pattern, replacement] of DEOBFUSCATIONS) result = result.replace(pattern, replacement);
  return result;
}

/** Extracts internal links, used to find contact / about / legal pages. */
export function extractLinks(html: string, baseUrl: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const href = match[1];
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
    try {
      links.push({ href: new URL(href, baseUrl).toString(), text: stripMarkup(match[2] ?? '').trim() });
    } catch {
      // Ignore unparseable hrefs.
    }
  }
  return links;
}
