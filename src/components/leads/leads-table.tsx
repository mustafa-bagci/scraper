'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LeadStatus } from '@prisma/client';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  ExternalLink,
  Globe,
  Mail,
  MoreHorizontal,
  Radar,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { LeadRow } from '@/types/lead-row';
import type { LeadFilters, LeadQuery, SortableLeadField } from '@/types/filters';
import { queryToSearchParams } from '@/lib/filters/url';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import { LeadsFilterPanel } from './leads-filter-panel';
import { ExportDialog } from './export-dialog';
import { EmailStatusBadge, LEAD_STATUS_LABELS, LeadStatusBadge, RatingValue, ScorePill } from './display';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { cn, displayDomain, formatNumber, formatPercent } from '@/lib/utils';

type ColumnId =
  | 'business'
  | 'category'
  | 'location'
  | 'rating'
  | 'reviews'
  | 'badReviews'
  | 'badPercent'
  | 'website'
  | 'email'
  | 'score'
  | 'status';

const COLUMNS: Array<{ id: ColumnId; label: string; sortBy?: SortableLeadField; numeric?: boolean }> = [
  { id: 'business', label: 'Business', sortBy: 'businessName' },
  { id: 'category', label: 'Category', sortBy: 'category' },
  { id: 'location', label: 'Location', sortBy: 'city' },
  { id: 'rating', label: 'Rating', sortBy: 'rating', numeric: true },
  { id: 'reviews', label: 'Reviews', sortBy: 'reviewCount', numeric: true },
  { id: 'badReviews', label: 'Bad', sortBy: 'badReviewCount', numeric: true },
  { id: 'badPercent', label: 'Bad %', sortBy: 'badReviewPercentage', numeric: true },
  { id: 'website', label: 'Website' },
  { id: 'email', label: 'Email', sortBy: 'email' },
  { id: 'score', label: 'Score', sortBy: 'leadScore', numeric: true },
  { id: 'status', label: 'Status', sortBy: 'status' },
];

const DEFAULT_HIDDEN: ColumnId[] = [];
const STORAGE_KEY = 'murgay.leads.columns';

type EmailJobState = { id: string; total: number; processed: number; succeeded: number; failed: number; status: string };

export function LeadsTable({
  rows,
  query,
  total,
  pageCount,
  totalLeads,
  defaultExportFormat,
}: {
  rows: LeadRow[];
  query: LeadQuery;
  total: number;
  pageCount: number;
  totalLeads: number;
  defaultExportFormat: 'CSV' | 'XLSX' | 'JSON';
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<ColumnId[]>(DEFAULT_HIDDEN);
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [emailJob, setEmailJob] = useState<EmailJobState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setHidden(JSON.parse(stored) as ColumnId[]);
    } catch {
      // Column preferences are a convenience; ignore storage failures.
    }
  }, []);

  useEffect(() => () => stopPolling(), []);

  // Selection is per page of results; changing page clears it.
  useEffect(() => setSelected(new Set()), [query.page, query.sortBy, query.sortDir]);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const persistHidden = (next: ColumnId[]) => {
    setHidden(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Non-fatal.
    }
  };

  const visibleColumns = useMemo(() => COLUMNS.filter((column) => !hidden.includes(column.id)), [hidden]);

  const navigate = useCallback(
    (next: Partial<LeadQuery>) => {
      const merged: LeadQuery = { ...query, ...next };
      const params = queryToSearchParams(merged);
      router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
    },
    [pathname, query, router],
  );

  const applyFilters = (filters: LeadFilters) => navigate({ filters, page: 1 });

  const toggleSort = (field: SortableLeadField) => {
    const sortDir = query.sortBy === field && query.sortDir === 'desc' ? 'asc' : 'desc';
    navigate({ sortBy: field, sortDir, page: 1 });
  };

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someSelected = selected.size > 0 && !allSelected;
  const selectedIds = [...selected];

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const changeStatus = async (status: LeadStatus) => {
    setPending(true);
    try {
      const result = await apiFetch<{ updated: number }>('/api/leads/bulk', {
        method: 'POST',
        body: { action: 'status', leadIds: selectedIds, status },
      });
      toast.success(`${formatNumber(result.updated)} leads set to ${LEAD_STATUS_LABELS[status]}`);
      setSelected(new Set());
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The status could not be changed.');
    } finally {
      setPending(false);
    }
  };

  const deleteSelected = async () => {
    setPending(true);
    try {
      const result = await apiFetch<{ deleted: number }>('/api/leads/bulk', {
        method: 'POST',
        body: { action: 'delete', leadIds: selectedIds },
      });
      toast.success(`${formatNumber(result.deleted)} leads permanently deleted`);
      setSelected(new Set());
      setDeleteOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The leads could not be deleted.');
    } finally {
      setPending(false);
    }
  };

  const findEmails = async () => {
    setPending(true);
    try {
      const { jobId, total: jobTotal } = await apiFetch<{ jobId: string; total: number }>('/api/email/find', {
        method: 'POST',
        body: { leadIds: selectedIds, verify: true },
      });

      setEmailJob({ id: jobId, total: jobTotal, processed: 0, succeeded: 0, failed: 0, status: 'RUNNING' });

      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const state = await apiFetch<EmailJobState>(`/api/jobs/${jobId}`);
          setEmailJob(state);
          if (state.status === 'COMPLETED' || state.status === 'FAILED') {
            stopPolling();
            toast.success('Email discovery complete', {
              description: `Found ${formatNumber(state.succeeded)} · not found ${formatNumber(state.failed)}`,
            });
            router.refresh();
            setTimeout(() => setEmailJob(null), 4000);
          }
        } catch {
          stopPolling();
          setEmailJob(null);
          toast.error('Lost contact with the email discovery job.');
        }
      }, 800);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Email discovery could not be started.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <LeadsFilterPanel filters={query.filters} onApply={applyFilters} />

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLUMNS.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={!hidden.includes(column.id)}
                  onCheckedChange={(checked) =>
                    persistHidden(checked ? hidden.filter((id) => id !== column.id) : [...hidden, column.id])
                  }
                  onSelect={(event) => event.preventDefault()}
                >
                  {column.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
            <Download />
            Export
          </Button>
        </div>
      </div>

      {emailJob ? (
        <div className="surface space-y-2 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Finding emails…</span>
            <span className="tabular text-muted-foreground">
              {formatNumber(emailJob.processed)} / {formatNumber(emailJob.total)}
            </span>
          </div>
          <Progress value={emailJob.total > 0 ? (emailJob.processed / emailJob.total) * 100 : 0} />
          <div className="flex gap-3 text-2xs text-muted-foreground">
            <span>Found: {formatNumber(emailJob.succeeded)}</span>
            <span>Not found: {formatNumber(emailJob.failed)}</span>
          </div>
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="surface sticky top-[76px] z-20 flex flex-wrap items-center gap-2 p-2.5 shadow-md">
          <Badge variant="info">{formatNumber(selected.size)} selected</Badge>

          <Button size="sm" variant="outline" onClick={findEmails} loading={pending}>
            <Mail />
            Find emails
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={pending}>
                Change status
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {Object.values(LeadStatus).map((status) => (
                <DropdownMenuItem key={status} onSelect={() => changeStatus(status)}>
                  {LEAD_STATUS_LABELS[status]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button size="sm" variant="outline" onClick={() => setExportOpen(true)}>
            <Download />
            Export selected
          </Button>

          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 />
            Delete
          </Button>

          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      ) : null}

      <div className="surface overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={Radar}
            title="No leads match these filters"
            description="Loosen the filters, or run a new business search to bring in fresh prospects."
            action={
              <Button asChild size="sm">
                <Link href="/search">Find leads</Link>
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-9">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all leads on this page"
                  />
                </TableHead>
                {visibleColumns.map((column) => (
                  <TableHead key={column.id} className={column.numeric ? 'text-right' : undefined}>
                    {column.sortBy ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.sortBy!)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          query.sortBy === column.sortBy && 'text-foreground',
                        )}
                      >
                        {column.label}
                        {query.sortBy === column.sortBy ? (
                          query.sortDir === 'asc' ? (
                            <ArrowUp className="size-3" aria-hidden />
                          ) : (
                            <ArrowDown className="size-3" aria-hidden />
                          )
                        ) : null}
                      </button>
                    ) : (
                      column.label
                    )}
                  </TableHead>
                ))}
                <TableHead className="w-10 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-state={selected.has(row.id) ? 'selected' : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggleOne(row.id)}
                      aria-label={`Select ${row.businessName}`}
                    />
                  </TableCell>

                  {visibleColumns.map((column) => (
                    <TableCell key={column.id} className={column.numeric ? 'text-right' : undefined}>
                      <LeadCell column={column.id} row={row} />
                    </TableCell>
                  ))}

                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.businessName}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/leads/${row.id}`}>Open lead</Link>
                        </DropdownMenuItem>
                        {row.website ? (
                          <DropdownMenuItem asChild>
                            <a href={row.website} target="_blank" rel="noopener noreferrer nofollow">
                              <ExternalLink />
                              Open website
                            </a>
                          </DropdownMenuItem>
                        ) : null}
                        {row.email ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              void navigator.clipboard.writeText(row.email!);
                              toast.success('Email copied');
                            }}
                          >
                            Copy email
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p className="tabular">
          {total === 0
            ? 'No leads'
            : `Showing ${formatNumber((query.page - 1) * query.pageSize + 1)}–${formatNumber(
                Math.min(query.page * query.pageSize, total),
              )} of ${formatNumber(total)}`}
        </p>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={query.page <= 1}
            onClick={() => navigate({ page: query.page - 1 })}
          >
            <ChevronLeft />
            Previous
          </Button>
          <span className="tabular px-1">
            Page {query.page} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={query.page >= pageCount}
            onClick={() => navigate({ page: query.page + 1 })}
          >
            Next
            <ChevronRight />
          </Button>
        </div>
      </div>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        selectedIds={selectedIds}
        filters={query.filters}
        filteredCount={total}
        totalCount={totalLeads}
        defaultFormat={defaultExportFormat}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {formatNumber(selected.size)} leads?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently erases the businesses together with their reviews, discovered emails, notes and activity
              history. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteSelected}>Delete permanently</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LeadCell({ column, row }: { column: ColumnId; row: LeadRow }) {
  switch (column) {
    case 'business':
      return (
        <Link
          href={`/leads/${row.id}`}
          title={row.businessName}
          className="block max-w-[180px] truncate font-medium hover:underline"
        >
          {row.businessName}
        </Link>
      );
    case 'category':
      return (
        <span className="block max-w-[96px] truncate text-muted-foreground">{row.category ?? '—'}</span>
      );
    case 'location':
      return (
        <span className="text-muted-foreground">
          {row.city ?? '—'}
          {row.postalCode ? <span className="ml-1 text-2xs">{row.postalCode}</span> : null}
        </span>
      );
    case 'rating':
      return <RatingValue rating={row.rating} />;
    case 'reviews':
      return <span className="tabular text-muted-foreground">{formatNumber(row.reviewCount)}</span>;
    case 'badReviews':
      return row.reviewBreakdownAvailable ? (
        <span className="tabular">{formatNumber(row.badReviewCount)}</span>
      ) : (
        <span className="text-2xs text-muted-foreground" title="Review breakdown unavailable from the data source">
          n/a
        </span>
      );
    case 'badPercent':
      return row.reviewBreakdownAvailable ? (
        <span className={cn('tabular', row.badReviewPercentage >= 10 && 'font-medium text-destructive')}>
          {formatPercent(row.badReviewPercentage)}
        </span>
      ) : (
        <span className="text-2xs text-muted-foreground">n/a</span>
      );
    case 'website':
      return row.website ? (
        <a
          href={row.website}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={row.website}
          className="inline-flex max-w-[120px] items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
        >
          <Globe className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{displayDomain(row.website)}</span>
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    case 'email':
      return row.email ? (
        <span className="flex max-w-[190px] items-center gap-1.5">
          <span className="truncate text-xs" title={row.email}>
            {row.email}
          </span>
          <EmailStatusBadge status={row.emailStatus} />
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    case 'score':
      return <ScorePill score={row.leadScore} />;
    case 'status':
      return <LeadStatusBadge status={row.status} />;
    default:
      return null;
  }
}
