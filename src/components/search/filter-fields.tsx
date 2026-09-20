'use client';

import type { LeadFilters, Presence } from '@/types/filters';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** Building blocks shared by the discovery form and the lead-list filters. */

export type RangeKey = 'rating' | 'reviewCount' | 'badReviewCount' | 'badReviewPercentage' | 'leadScore';

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function TextFilter({
  id,
  label,
  placeholder,
  value,
  onChange,
  list,
}: {
  id: string;
  label: string;
  placeholder?: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  list?: string[];
}) {
  const listId = list ? `${id}-options` : undefined;

  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        value={value ?? ''}
        placeholder={placeholder}
        list={listId}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
      {list ? (
        <datalist id={listId}>
          {list.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
    </Field>
  );
}

export function RangeFilter({
  id,
  label,
  hint,
  min,
  max,
  step = 1,
  placeholderMin = 'Min',
  placeholderMax = 'Max',
  value,
  onChange,
  singleBound = false,
}: {
  id: string;
  label: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholderMin?: string;
  placeholderMax?: string;
  value: { min?: number; max?: number } | undefined;
  onChange: (value: { min?: number; max?: number } | undefined) => void;
  singleBound?: boolean;
}) {
  const update = (bound: 'min' | 'max', raw: string) => {
    const parsed = raw === '' ? undefined : Number(raw);
    const next = { ...(value ?? {}), [bound]: Number.isFinite(parsed) ? parsed : undefined };
    if (next.min === undefined && next.max === undefined) onChange(undefined);
    else onChange(next);
  };

  return (
    <Field label={label} htmlFor={`${id}-min`} hint={hint}>
      <div className={cn('grid gap-2', singleBound ? 'grid-cols-1' : 'grid-cols-2')}>
        <Input
          id={`${id}-min`}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          placeholder={placeholderMin}
          value={value?.min ?? ''}
          onChange={(event) => update('min', event.target.value)}
          aria-label={`${label} minimum`}
        />
        {!singleBound && (
          <Input
            id={`${id}-max`}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            placeholder={placeholderMax}
            value={value?.max ?? ''}
            onChange={(event) => update('max', event.target.value)}
            aria-label={`${label} maximum`}
          />
        )}
      </div>
    </Field>
  );
}

export function PresenceFilter({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: Presence | undefined;
  onChange: (value: Presence) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Select value={value ?? 'any'} onValueChange={(next) => onChange(next as Presence)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any</SelectItem>
          <SelectItem value="required">Required</SelectItem>
          <SelectItem value="missing">Missing</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

export const COUNTRY_SUGGESTIONS = ['France', 'Belgique', 'Suisse', 'Luxembourg', 'Nederland', 'Deutschland'];

export const CATEGORY_SUGGESTIONS = [
  'Dentiste',
  'Restaurant',
  'Plombier',
  'Garage automobile',
  'Coiffeur',
  'Avocat',
  'Hôtel',
  'Boulangerie',
  'Agence immobilière',
  'Salle de sport',
];

export function setFilter<K extends keyof LeadFilters>(
  filters: LeadFilters,
  key: K,
  value: LeadFilters[K],
): LeadFilters {
  const next = { ...filters };
  if (value === undefined || value === '' || value === 'any') delete next[key];
  else next[key] = value;
  return next;
}
