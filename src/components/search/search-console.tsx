'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bookmark, CircleAlert, Play, RotateCw, Search, Sparkles, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import { describeFilters, type LeadFilters } from '@/types/filters';
import { filtersToSearchParams } from '@/lib/filters/url';
import {
  CATEGORY_SUGGESTIONS,
  COUNTRY_SUGGESTIONS,
  Field,
  PresenceFilter,
  RangeFilter,
  TextFilter,
  setFilter,
} from './filter-fields';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { formatNumber } from '@/lib/utils';

type SearchRunState = {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  statusMessage: string | null;
  error: string | null;
  discovered: number;
  unique: number;
  duplicates: number;
  matched: number;
  created: number;
  updated: number;
  providerCalls: number;
  providerCost: number;
};

export function SearchConsole({
  initialFilters,
  defaults,
  costPerBusiness,
  currency,
  maxResults,
  providerLabel,
  providerConfigured,
  providerHasReviewBreakdown,
}: {
  initialFilters: LeadFilters;
  defaults: { country: string; resultLimit: number };
  costPerBusiness: number;
  currency: string;
  maxResults: number;
  providerLabel: string;
  providerConfigured: boolean;
  providerHasReviewBreakdown: boolean;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<LeadFilters>(() => ({
    country: defaults.country,
    limit: defaults.resultLimit,
    ...initialFilters,
  }));
  const [run, setRun] = useState<SearchRunState | null>(null);
  const [starting, setStarting] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const update = useCallback(<K extends keyof LeadFilters>(key: K, value: LeadFilters[K]) => {
    setFilters((current) => setFilter(current, key, value));
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollRun = useCallback(
    (searchRunId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          // Polling advances the job: each tick processes a bounded slice and
          // returns the live counters, so progress continues even where a
          // background promise would have been killed.
          const state = await apiFetch<SearchRunState>(`/api/search/${searchRunId}/advance`, { method: 'POST' });
          setRun(state);

          if (state.status === 'COMPLETED' || state.status === 'FAILED') {
            stopPolling();
            if (state.status === 'COMPLETED') {
              toast.success('Search complete', {
                description: `${formatNumber(state.created)} new leads · ${formatNumber(state.updated)} refreshed`,
              });
              router.refresh();
            } else {
              toast.error('Search failed', { description: state.error ?? undefined });
            }
          }
        } catch (error) {
          stopPolling();
          const message = error instanceof ApiClientError ? error.message : 'Lost contact with the search job.';
          toast.error(message);
        }
      }, 900);
    },
    [router, stopPolling],
  );

  const runSearch = async () => {
    setStarting(true);
    setRun(null);
    try {
      const { searchRunId } = await apiFetch<{ searchRunId: string }>('/api/search', {
        method: 'POST',
        body: { filters },
      });
      setRun({
        id: searchRunId,
        status: 'PENDING',
        progress: 0,
        statusMessage: 'Queued',
        error: null,
        discovered: 0,
        unique: 0,
        duplicates: 0,
        matched: 0,
        created: 0,
        updated: 0,
        providerCalls: 0,
        providerCost: 0,
      });
      pollRun(searchRunId);
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : 'The search could not be started.';
      toast.error(message);
    } finally {
      setStarting(false);
    }
  };

  // A provider that cannot supply a star distribution reports every business as
  // having zero bad reviews, so a bad-review filter silently excludes all of
  // them. Say so before the search runs rather than after it returns nothing.
  const usesBadReviewFilter =
    filters.badReviewCount?.min !== undefined ||
    filters.badReviewCount?.max !== undefined ||
    filters.badReviewPercentage?.min !== undefined ||
    filters.badReviewPercentage?.max !== undefined;
  const badReviewFilterUnsupported = usesBadReviewFilter && !providerHasReviewBreakdown;

  const limit = Math.min(filters.limit ?? defaults.resultLimit, maxResults);
  const estimatedRequests = Math.max(1, Math.ceil(limit / 20));
  const estimatedCost = limit * costPerBusiness;
  const resultsHref = `/leads?${filtersToSearchParams(filters).toString()}`;
  const busy = starting || run?.status === 'PENDING' || run?.status === 'RUNNING';

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Where</CardTitle>
            <CardDescription>Narrow the geography and the trade you want to prospect.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextFilter
              id="country"
              label="Country"
              placeholder="France"
              value={filters.country}
              onChange={(value) => update('country', value)}
              list={COUNTRY_SUGGESTIONS}
            />
            <TextFilter
              id="region"
              label="Region"
              placeholder="Auvergne-Rhône-Alpes"
              value={filters.region}
              onChange={(value) => update('region', value)}
            />
            <TextFilter
              id="city"
              label="City"
              placeholder="Lyon"
              value={filters.city}
              onChange={(value) => update('city', value)}
            />
            <TextFilter
              id="postalCode"
              label="Postal code"
              placeholder="690"
              value={filters.postalCode}
              onChange={(value) => update('postalCode', value)}
            />
            <TextFilter
              id="category"
              label="Category"
              placeholder="dentist, dental clinic"
              value={filters.category}
              onChange={(value) => update('category', value)}
              list={CATEGORY_SUGGESTIONS}
            />
            <TextFilter
              id="keyword"
              label="Keyword"
              placeholder="cabinet, urgence…"
              value={filters.keyword}
              onChange={(value) => update('keyword', value)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Review profile</CardTitle>
            <CardDescription>
              The signal that makes a business worth approaching. Bad reviews use the definition set in Settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <RangeFilter
              id="rating"
              label="Rating"
              min={0}
              max={5}
              step={0.1}
              placeholderMin="0"
              placeholderMax="4.2"
              value={filters.rating}
              onChange={(value) => update('rating', value)}
            />
            <RangeFilter
              id="reviewCount"
              label="Reviews"
              min={0}
              placeholderMin="30"
              placeholderMax="1000"
              value={filters.reviewCount}
              onChange={(value) => update('reviewCount', value)}
            />
            <RangeFilter
              id="badReviewCount"
              label="Bad reviews"
              min={0}
              placeholderMin="Minimum 10"
              singleBound
              value={filters.badReviewCount}
              onChange={(value) => update('badReviewCount', value)}
            />
            <RangeFilter
              id="badReviewPercentage"
              label="Bad review %"
              min={0}
              max={100}
              step={0.5}
              placeholderMin="10"
              placeholderMax="100"
              value={filters.badReviewPercentage}
              onChange={(value) => update('badReviewPercentage', value)}
            />
            <RangeFilter
              id="leadScore"
              label="Lead score"
              min={0}
              max={100}
              placeholderMin="60"
              placeholderMax="100"
              value={filters.leadScore}
              onChange={(value) => update('leadScore', value)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contactability</CardTitle>
            <CardDescription>Require the channels you actually intend to use.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <PresenceFilter id="website" label="Website" value={filters.website} onChange={(value) => update('website', value)} />
            <PresenceFilter id="email" label="Email" value={filters.email} onChange={(value) => update('email', value)} />
            <PresenceFilter id="phone" label="Phone" value={filters.phone} onChange={(value) => update('phone', value)} />
            <Field label="Results" htmlFor="limit" hint={`Provider ceiling: ${formatNumber(maxResults)}`}>
              <Input
                id="limit"
                type="number"
                min={1}
                max={maxResults}
                value={filters.limit ?? defaults.resultLimit}
                onChange={(event) => update('limit', Number(event.target.value) || undefined)}
              />
            </Field>
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-[88px] xl:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Run search</CardTitle>
            <CardDescription className="line-clamp-2">{describeFilters(filters)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!providerConfigured ? (
              <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-2xs text-warning">
                <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                {providerLabel} has no API key. Add one in Settings → Data Providers.
              </p>
            ) : null}

            {badReviewFilterUnsupported ? (
              <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-2xs text-warning">
                <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>
                  {providerLabel} does not publish a 1★–5★ breakdown, so every business counts as having zero bad
                  reviews and this filter would exclude all of them. Clear the bad-review filters, or connect a provider
                  that supplies the distribution.
                </span>
              </p>
            ) : null}

            <div className="space-y-1.5 rounded-lg border border-border bg-secondary/50 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Wallet className="size-3.5" aria-hidden />
                Estimated provider usage
              </p>
              <dl className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Provider</dt>
                  <dd className="font-medium">{providerLabel}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Businesses</dt>
                  <dd className="tabular font-medium">{formatNumber(limit)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Requests</dt>
                  <dd className="tabular font-medium">≈ {formatNumber(estimatedRequests)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Cost</dt>
                  <dd className="tabular font-medium">
                    {estimatedCost > 0 ? `≈ ${estimatedCost.toFixed(2)} ${currency}` : 'No provider cost'}
                  </dd>
                </div>
              </dl>
            </div>

            <Button
              className="w-full"
              onClick={runSearch}
              loading={busy}
              disabled={busy || badReviewFilterUnsupported}
            >
              {!busy && <Search />}
              {busy ? 'Searching…' : 'Search businesses'}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setSaveOpen(true)} disabled={busy}>
              <Bookmark />
              Save search
            </Button>
          </CardContent>
        </Card>

        {run ? <RunProgress run={run} resultsHref={resultsHref} onRetry={runSearch} currency={currency} /> : null}
      </aside>

      <SaveSearchDialog open={saveOpen} onOpenChange={setSaveOpen} filters={filters} />
    </div>
  );
}

function RunProgress({
  run,
  resultsHref,
  onRetry,
  currency,
}: {
  run: SearchRunState;
  resultsHref: string;
  onRetry: () => void;
  currency: string;
}) {
  const running = run.status === 'PENDING' || run.status === 'RUNNING';

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{running ? 'Search running…' : run.status === 'FAILED' ? 'Search failed' : 'Search complete'}</CardTitle>
        {running ? (
          <Badge variant="info">{run.progress}%</Badge>
        ) : run.status === 'FAILED' ? (
          <Badge variant="destructive">Failed</Badge>
        ) : (
          <Badge variant="success">Done</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {running ? <Progress value={run.progress} /> : null}

        {run.status === 'FAILED' ? (
          <>
            <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {run.error ?? 'Business data provider temporarily unavailable.'}
            </p>
            <Button variant="outline" size="sm" className="w-full" onClick={onRetry}>
              <RotateCw />
              Retry
            </Button>
          </>
        ) : (
          <>
            <dl className="space-y-1.5 text-xs">
              <Stat label="Businesses discovered" value={run.discovered} />
              <Stat label="Unique" value={run.unique} />
              <Stat label="Duplicates" value={run.duplicates} />
              <Stat label="Match your filters" value={run.matched} emphasis />
              <Separator className="my-2" />
              <Stat label="New leads stored" value={run.created} emphasis />
              <Stat label="Existing leads refreshed" value={run.updated} />
              <Stat label="Provider requests" value={run.providerCalls} />
              {run.providerCost > 0 ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Actual provider cost</dt>
                  <dd className="tabular font-semibold">
                    {run.providerCost.toFixed(5)} {currency}
                  </dd>
                </div>
              ) : null}
            </dl>

            {run.status === 'COMPLETED' ? (
              <Button asChild size="sm" className="w-full">
                <Link href={resultsHref}>
                  <Sparkles />
                  View matching leads
                </Link>
              </Button>
            ) : (
              <p className="text-2xs text-muted-foreground">{run.statusMessage}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={emphasis ? 'tabular font-semibold' : 'tabular text-muted-foreground'}>{formatNumber(value)}</dd>
    </div>
  );
}

function SaveSearchDialog({
  open,
  onOpenChange,
  filters,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: LeadFilters;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error('Give the search a name.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/saved-searches', {
        method: 'POST',
        body: { name: name.trim(), description: description.trim() || undefined, filters },
      });
      toast.success('Search saved', { description: name.trim() });
      onOpenChange(false);
      setName('');
      setDescription('');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The search could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this search</DialogTitle>
          <DialogDescription>Re-run it later from the Searches page with one click.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="saved-name">Name</Label>
            <Input
              id="saved-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="French dentists with poor reviews"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="saved-description">Description</Label>
            <Textarea
              id="saved-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional context for this segment"
              rows={3}
            />
          </div>
          <div className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-2xs text-muted-foreground">
            {describeFilters(filters)}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            <Play />
            Save search
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
