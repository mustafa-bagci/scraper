'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export type SettingSection = 'general' | 'scoring' | 'reviews' | 'crawler' | 'limits' | 'export' | 'security';

/**
 * Shared shell for a settings section: submits the section payload to
 * `/api/settings`, surfaces validation errors from Zod, and reports when a
 * change caused stored leads to be re-scored.
 */
export function SectionForm<T>({
  section,
  title,
  description,
  value,
  children,
  footerNote,
}: {
  section: SettingSection;
  title: string;
  description: string;
  value: T;
  children: React.ReactNode;
  footerNote?: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const result = await apiFetch<{ recomputed: number }>('/api/settings', {
        method: 'PATCH',
        body: { section, value },
      });
      toast.success('Settings saved', {
        description: result.recomputed > 0 ? `${result.recomputed} leads re-scored with the new rules.` : undefined,
      });
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setResetting(true);
    try {
      const result = await apiFetch<{ recomputed: number }>('/api/settings', {
        method: 'PATCH',
        body: { section, reset: true },
      });
      toast.success('Restored to the defaults that ship with this build', {
        description: result.recomputed > 0 ? `${result.recomputed} leads re-scored.` : undefined,
      });
      // The form holds its values in local state, so a refresh alone would keep
      // showing the old ones.
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The settings could not be reset.');
      setResetting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
      <CardFooter className="flex-wrap justify-between gap-2">
        <p className="text-2xs text-muted-foreground">{footerNote}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={reset} loading={resetting}>
            <RotateCcw />
            Reset to defaults
          </Button>
          <Button size="sm" onClick={save} loading={saving}>
            <Save />
            Save changes
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
          className="flex h-9 w-full rounded-lg border border-input bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-2xs text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
      {hint ? <p className="text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
