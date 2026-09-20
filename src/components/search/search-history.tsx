'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { History, RotateCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import type { LeadFilters } from '@/types/filters';
import { describeFilters } from '@/types/filters';
import { filtersToSearchParams } from '@/lib/filters/url';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatNumber, relativeTime } from '@/lib/utils';

export type SearchRunItem = {
  id: string;
  label: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  filters: LeadFilters;
  provider: string;
  discovered: number;
  duplicates: number;
  matched: number;
  created: number;
  error: string | null;
  createdAt: string;
};

export function SearchHistory({ runs }: { runs: SearchRunItem[] }) {
  const router = useRouter();

  const runAgain = async (item: SearchRunItem) => {
    try {
      await apiFetch('/api/search', { method: 'POST', body: { filters: item.filters, label: item.label } });
      toast.success('Search queued', { description: item.label });
      router.push(`/search?${filtersToSearchParams(item.filters).toString()}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The search could not be started.');
    }
  };

  const remove = async (item: SearchRunItem) => {
    try {
      await apiFetch(`/api/search/${item.id}`, { method: 'DELETE' });
      toast.success('Search run deleted');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The run could not be deleted.');
    }
  };

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No searches run yet"
        description="Every business discovery run is recorded here with its counters and filters."
        action={
          <Button asChild size="sm">
            <Link href="/search">Run a search</Link>
          </Button>
        }
      />
    );
  }

  return (
    <ul className="divide-y divide-border">
      {runs.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-sm font-medium">
              {item.label}
              {item.status === 'FAILED' ? (
                <Badge variant="destructive">Failed</Badge>
              ) : item.status === 'COMPLETED' ? (
                <Badge variant="success">Completed</Badge>
              ) : (
                <Badge variant="info">{item.status.toLowerCase()}</Badge>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">{describeFilters(item.filters)}</p>
            {item.error ? <p className="mt-0.5 truncate text-2xs text-destructive">{item.error}</p> : null}
          </div>

          <dl className="flex items-center gap-4 text-2xs text-muted-foreground">
            <Metric label="Discovered" value={item.discovered} />
            <Metric label="Duplicates" value={item.duplicates} />
            <Metric label="Matched" value={item.matched} />
            <Metric label="New" value={item.created} />
            <span>{relativeTime(item.createdAt)}</span>
          </dl>

          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => runAgain(item)}>
              <RotateCw />
              Run again
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/leads?${filtersToSearchParams(item.filters).toString()}`}>View leads</Link>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete run"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => remove(item)}
            >
              <Trash2 />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="hidden text-center sm:block">
      <dt className="text-2xs uppercase tracking-wide">{label}</dt>
      <dd className="tabular font-semibold text-foreground">{formatNumber(value)}</dd>
    </div>
  );
}
