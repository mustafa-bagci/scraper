'use client';

import { useState } from 'react';
import { Download, FileJson, FileSpreadsheet, FileText } from 'lucide-react';
import { toast } from 'sonner';
import type { LeadFilters } from '@/types/filters';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatNumber } from '@/lib/utils';

type Format = 'CSV' | 'XLSX' | 'JSON';
type Scope = 'selected' | 'filtered' | 'all';

const FORMAT_ICON = { CSV: FileText, XLSX: FileSpreadsheet, JSON: FileJson } as const;

/**
 * Export dialog. The download is fetched with the CSRF header and handed to
 * the browser as a blob, so the file name and content type come from the API.
 */
export function ExportDialog({
  open,
  onOpenChange,
  selectedIds,
  filters,
  filteredCount,
  totalCount,
  defaultFormat = 'CSV',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  filters: LeadFilters;
  filteredCount: number;
  totalCount: number;
  defaultFormat?: Format;
}) {
  const [format, setFormat] = useState<Format>(defaultFormat);
  const [scope, setScope] = useState<Scope>(selectedIds.length > 0 ? 'selected' : 'filtered');
  const [busy, setBusy] = useState(false);

  const rowCount = scope === 'selected' ? selectedIds.length : scope === 'filtered' ? filteredCount : totalCount;
  const Icon = FORMAT_ICON[format];

  const runExport = async () => {
    if (rowCount === 0) {
      toast.error('There is nothing to export for this selection.');
      return;
    }

    setBusy(true);
    try {
      const token = document.cookie.match(/(?:^|;\s*)murgay_csrf=([^;]+)/)?.[1];
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-csrf-token': decodeURIComponent(token) } : {}),
        },
        body: JSON.stringify({
          format,
          scope,
          leadIds: scope === 'selected' ? selectedIds : undefined,
          filters: scope === 'filtered' ? filters : undefined,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Export failed (HTTP ${response.status}).`);
      }

      const disposition = response.headers.get('content-disposition') ?? '';
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `murgay-leads.${format.toLowerCase()}`;
      const blob = await response.blob();

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      toast.success('Export ready', { description: `${fileName} · ${formatNumber(rowCount)} rows` });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The export could not be generated.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export leads</DialogTitle>
          <DialogDescription>Download the current selection for your outbound tooling.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="export-scope">Scope</Label>
            <Select value={scope} onValueChange={(value) => setScope(value as Scope)}>
              <SelectTrigger id="export-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="selected" disabled={selectedIds.length === 0}>
                  Selected ({formatNumber(selectedIds.length)})
                </SelectItem>
                <SelectItem value="filtered">Current filters ({formatNumber(filteredCount)})</SelectItem>
                <SelectItem value="all">All leads ({formatNumber(totalCount)})</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="export-format">Format</Label>
            <Select value={format} onValueChange={(value) => setFormat(value as Format)}>
              <SelectTrigger id="export-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CSV">CSV</SelectItem>
                <SelectItem value="XLSX">XLSX (Excel)</SelectItem>
                <SelectItem value="JSON">JSON</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-2xs text-muted-foreground">
          <Icon className="mr-1.5 inline size-3.5 align-text-bottom" aria-hidden />
          {formatNumber(rowCount)} rows · 23 columns including review statistics, email status, source URL and provenance.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={runExport} loading={busy}>
            <Download />
            Export {format}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
