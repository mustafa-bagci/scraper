'use client';

/**
 * Browser-side API client.
 *
 * Attaches the double-submit CSRF token and unwraps the standard
 * `{ ok, data | error }` envelope so callers deal in plain values.
 */

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)murgay_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = 'GET', body, signal } = options;
  const token = csrfToken();

  const response = await fetch(path, {
    method,
    signal,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { 'x-csrf-token': token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload: Envelope<T> | null = null;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload || payload.ok === false) {
    const message = payload && payload.ok === false ? payload.error : `Request failed (HTTP ${response.status}).`;
    const code = payload && payload.ok === false ? payload.code : undefined;
    throw new ApiClientError(message, response.status, code);
  }

  return payload.data;
}
