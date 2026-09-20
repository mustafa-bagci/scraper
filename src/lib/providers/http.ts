import 'server-only';

/**
 * Shared outbound HTTP helper for provider integrations: hard timeouts,
 * bounded retries with exponential backoff, and no leaking of request headers
 * (which carry API keys) into thrown errors.
 */

export type FetchJsonOptions = {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
};

export type FetchOutcome<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; status: number; error: string; retryable: boolean };

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<FetchOutcome<T>> {
  const { method = 'GET', headers = {}, body, timeoutMs = 15000, maxRetries = 2, signal } = options;

  let lastError = 'Request failed';
  let lastStatus = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) await sleep(backoffMs(attempt));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json', ...headers } : headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });

      lastStatus = response.status;

      if (!response.ok) {
        const retryable = RETRYABLE_STATUS.has(response.status);
        lastError = `Provider responded with HTTP ${response.status}`;
        if (retryable && attempt < maxRetries) continue;
        return { ok: false, status: response.status, error: lastError, retryable };
      }

      const data = (await response.json()) as T;
      return { ok: true, data, status: response.status };
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      lastError = aborted ? `Request timed out after ${timeoutMs}ms` : 'Network error contacting provider';
      if (attempt >= maxRetries) {
        return { ok: false, status: lastStatus, error: lastError, retryable: true };
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return { ok: false, status: lastStatus, error: lastError, retryable: true };
}

function backoffMs(attempt: number): number {
  const base = Math.min(500 * 2 ** (attempt - 1), 4000);
  return base + Math.floor(Math.random() * 200);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
