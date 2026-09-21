import type { ProviderCapabilities } from '@/lib/providers/business/BusinessDataProvider';

/** What `POST /api/providers/test` returns. */
export type ProviderTestResult = {
  ok: boolean;
  provider: { id: string; name: string; capabilities?: ProviderCapabilities };
  ms?: number;
  returned?: number;
  sample?: Record<string, unknown> | null;
  raw?: unknown;
  error?: string;
};
