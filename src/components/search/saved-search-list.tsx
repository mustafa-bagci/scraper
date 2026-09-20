'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, Pencil, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import type { LeadFilters } from '@/types/filters';
import { describeFilters } from '@/types/filters';
import { filtersToSearchParams } from '@/lib/filters/url';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatDateTime, pluralize, relativeTime } from '@/lib/utils';

export type SavedSearchItem = {
  id: string;
  name: string;
  description: string | null;
  filters: LeadFilters;
  runCount: number;
  lastRunAt: string | null;
  updatedAt: string;
};

export function SavedSearchList({ searches }: { searches: SavedSearchItem[] }) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedSearchItem | null>(null);
  const [deleting, setDeleting] = useState<SavedSearchItem | null>(null);
  const [name, setName] = useState('');

  const runAgain = async (item: SavedSearchItem) => {
    setRunning(item.id);
    try {
      await apiFetch('/api/search', {
        method: 'POST',
        body: { filters: item.filters, savedSearchId: item.id, label: item.name },
      });
      toast.success('Search queued', { description: item.name });
      router.push(`/search?${filtersToSearchParams(item.filters).toString()}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The search could not be started.');
    } finally {
      setRunning(null);
    }
  };

  const duplicate = async (item: SavedSearchItem) => {
    try {
      await apiFetch('/api/saved-searches', {
        method: 'POST',
        body: { name: `${item.name} (copy)`, description: item.description ?? undefined, filters: item.filters },
      });
      toast.success('Saved search duplicated');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The search could not be duplicated.');
    }
  };

  const rename = async () => {
    if (!editing || !name.trim()) return;
    try {
      await apiFetch(`/api/saved-searches/${editing.id}`, { method: 'PATCH', body: { name: name.trim() } });
      toast.success('Saved search renamed');
      setEditing(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The search could not be renamed.');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiFetch(`/api/saved-searches/${deleting.id}`, { method: 'DELETE' });
      toast.success('Saved search deleted');
      setDeleting(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The search could not be deleted.');
    }
  };

  if (searches.length === 0) {
    return (
      <EmptyState
        icon={Play}
        title="No saved searches yet"
        description="Save a set of filters from Find Leads to re-run the same segment in one click."
        action={
          <Button asChild size="sm">
            <Link href="/search">Build a search</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {searches.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.name}</p>
              <p className="truncate text-xs text-muted-foreground">{describeFilters(item.filters)}</p>
              {item.description ? (
                <p className="mt-0.5 truncate text-2xs text-muted-foreground">{item.description}</p>
              ) : null}
            </div>

            <div className="flex items-center gap-2 text-2xs text-muted-foreground">
              <Badge variant="outline">
                {item.runCount} {pluralize(item.runCount, 'run')}
              </Badge>
              <span>{item.lastRunAt ? `Last run ${relativeTime(item.lastRunAt)}` : 'Never run'}</span>
            </div>

            <div className="flex items-center gap-1">
              <Button size="sm" onClick={() => runAgain(item)} loading={running === item.id}>
                <Play />
                Run
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Rename"
                onClick={() => {
                  setEditing(item);
                  setName(item.name);
                }}
              >
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Duplicate" onClick={() => duplicate(item)}>
                <Copy />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setDeleting(item)}
              >
                <Trash2 />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename saved search</DialogTitle>
            <DialogDescription>
              {editing ? `Last updated ${formatDateTime(editing.updatedAt)}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="rename">Name</Label>
            <Input id="rename" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={rename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved filter set is removed. Leads already discovered by it are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
