import 'server-only';
import { assertPublicUrl } from '@/lib/security/ssrf';
import type { CrawlerSettings } from '@/types/settings';

/**
 * SSRF-safe page fetcher.
 *
 * Redirects are followed manually so that *every* hop is re-validated against
 * the SSRF policy — a public URL that 302s to http://169.254.169.254 must not
 * be followed. Responses are size-capped while streaming so a hostile server
 * cannot exhaust memory.
 */

export type FetchPageResult =
  | { ok: true; url: string; finalUrl: string; status: number; html: string; contentType: string; bytes: number }
  | { ok: false; url: string; reason: string; status?: number };

const TEXT_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain'];

export async function fetchPage(
  rawUrl: string,
  settings: CrawlerSettings,
  blockedHosts: string[] = [],
): Promise<FetchPageResult> {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= settings.maxRedirects; hop += 1) {
    const check = await assertPublicUrl(currentUrl, blockedHosts);
    if (!check.ok) return { ok: false, url: rawUrl, reason: check.reason };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);

    try {
      const response = await fetch(check.url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': settings.userAgent,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'accept-language': 'fr,en;q=0.8',
        },
        cache: 'no-store',
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return { ok: false, url: rawUrl, reason: 'Redirect without a location header', status: response.status };
        currentUrl = new URL(location, check.url).toString();
        continue;
      }

      if (!response.ok) {
        return { ok: false, url: rawUrl, reason: `HTTP ${response.status}`, status: response.status };
      }

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (contentType && !TEXT_CONTENT_TYPES.some((type) => contentType.includes(type))) {
        return { ok: false, url: rawUrl, reason: `Unsupported content type "${contentType.split(';')[0]}"` };
      }

      const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
      if (Number.isFinite(declaredLength) && declaredLength > settings.maxResponseBytes) {
        return { ok: false, url: rawUrl, reason: 'Response exceeds the configured size limit' };
      }

      const { text, bytes } = await readCapped(response, settings.maxResponseBytes);

      return {
        ok: true,
        url: rawUrl,
        finalUrl: check.url.toString(),
        status: response.status,
        html: text,
        contentType,
        bytes,
      };
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      return {
        ok: false,
        url: rawUrl,
        reason: aborted ? `Timed out after ${settings.timeoutMs}ms` : 'Network error',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, url: rawUrl, reason: 'Too many redirects' };
}

async function readCapped(response: Response, maxBytes: number): Promise<{ text: string; bytes: number }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: '', bytes: 0 };

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const chunks: string[] = [];
  let bytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    bytes += value.byteLength;
    if (bytes > maxBytes) {
      chunks.push(decoder.decode(value.slice(0, Math.max(0, value.byteLength - (bytes - maxBytes)))));
      await reader.cancel().catch(() => undefined);
      bytes = maxBytes;
      break;
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }

  return { text: chunks.join(''), bytes };
}
