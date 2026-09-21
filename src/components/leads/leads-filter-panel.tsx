'use client';

import { useState } from 'react';
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import type { EmailStatus, LeadStatus } from '@prisma/client';
import type { LeadFilters } from '@/types/filters';
import { EMAIL_STATUS_LABELS, LEAD_STATUS_LABELS } from '@/components/leads/display';
import {
  CATEGORY_SUGGESTIONS,
  COUNTRY_SUGGESTIONS,
  ChoiceFilter,
  PresenceFilter,
  RangeFilter,
  TextFilter,
  setFilter,
} from '@/components/search/filter-fields';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { countActiveFilters } from '@/lib/filters/url';

/** Ordered by how an operator reads them, not by how the enum is declared. */
const EMAIL_STATUS_OPTIONS: ReadonlyArray<{ value: EmailStatus; label: string }> = [
  'FOUND',
  'VALID',
  'NOT_FOUND',
  'UNKNOWN',
  'RISKY',
  'INVALID',
  'DISPOSABLE',
].map((value) => ({ value: value as EmailStatus, label: EMAIL_STATUS_LABELS[value as EmailStatus] }));

const LEAD_STATUS_OPTIONS: ReadonlyArray<{ value: LeadStatus; label: string }> = (
  Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]
).map((value) => ({ value, label: LEAD_STATUS_LABELS[value] }));

export function LeadsFilterPanel({
  filters,
  onApply,
}: {
  filters: LeadFilters;
  onApply: (filters: LeadFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LeadFilters>(filters);
  const activeCount = countActiveFilters(filters);

  const update = <K extends keyof LeadFilters>(key: K, value: LeadFilters[K]) => {
    setDraft((current) => setFilter(current, key, value));
  };

  const apply = () => {
    onApply(draft);
    setOpen(false);
  };

  const clear = () => {
    setDraft({});
    onApply({});
    setOpen(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={open ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => {
            setDraft(filters);
            setOpen((value) => !value);
          }}
        >
          <SlidersHorizontal />
          Filters
          {activeCount > 0 ? <Badge variant="info">{activeCount}</Badge> : null}
        </Button>

        {activeCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            <X />
            Clear all
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="surface animate-fade-in space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TextFilter
              id="f-country"
              label="Country"
              value={draft.country}
              onChange={(value) => update('country', value)}
              list={COUNTRY_SUGGESTIONS}
            />
            <TextFilter id="f-region" label="Region" value={draft.region} onChange={(value) => update('region', value)} />
            <TextFilter id="f-city" label="City" value={draft.city} onChange={(value) => update('city', value)} />
            <TextFilter
              id="f-category"
              label="Category"
              value={draft.category}
              onChange={(value) => update('category', value)}
              list={CATEGORY_SUGGESTIONS}
            />
            <RangeFilter
              id="f-rating"
              label="Rating"
              min={0}
              max={5}
              step={0.1}
              value={draft.rating}
              onChange={(value) => update('rating', value)}
            />
            <RangeFilter
              id="f-reviews"
              label="Reviews"
              min={0}
              value={draft.reviewCount}
              onChange={(value) => update('reviewCount', value)}
            />
            <RangeFilter
              id="f-bad"
              label="Bad reviews"
              min={0}
              singleBound
              placeholderMin="Minimum"
              value={draft.badReviewCount}
              onChange={(value) => update('badReviewCount', value)}
            />
            <RangeFilter
              id="f-badpct"
              label="Bad review %"
              min={0}
              max={100}
              step={0.5}
              value={draft.badReviewPercentage}
              onChange={(value) => update('badReviewPercentage', value)}
            />
            <RangeFilter
              id="f-score"
              label="Lead score"
              min={0}
              max={100}
              value={draft.leadScore}
              onChange={(value) => update('leadScore', value)}
            />
            <PresenceFilter id="f-website" label="Website" value={draft.website} onChange={(value) => update('website', value)} />
            <PresenceFilter id="f-email" label="Email" value={draft.email} onChange={(value) => update('email', value)} />
            <PresenceFilter id="f-phone" label="Phone" value={draft.phone} onChange={(value) => update('phone', value)} />
          </div>

          <div className="grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
            <ChoiceFilter
              label="Email lookup"
              hint="What the last public-email check returned. Pick none to include every lead."
              options={EMAIL_STATUS_OPTIONS}
              value={draft.emailStatus}
              onChange={(value) => update('emailStatus', value)}
            />
            <ChoiceFilter
              label="Lead status"
              options={LEAD_STATUS_OPTIONS}
              value={draft.status}
              onChange={(value) => update('status', value)}
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={() => setDraft({})}>
              <RotateCcw />
              Reset
            </Button>
            <Button size="sm" onClick={apply}>
              Apply filters
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
