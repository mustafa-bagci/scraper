'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, FileUp, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber, truncate } from '@/lib/utils';

const FIELDS = [
  { key: 'businessName', label: 'Business Name', required: true },
  { key: 'category', label: 'Category', required: false },
  { key: 'website', label: 'Website', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'address', label: 'Address', required: false },
  { key: 'postalCode', label: 'Postal Code', required: false },
  { key: 'city', label: 'City', required: false },
  { key: 'region', label: 'Region', required: false },
  { key: 'country', label: 'Country', required: false },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];
type Mapping = Partial<Record<FieldKey, string>>;

type Preview = {
  headers: string[];
  rowCount: number;
  sampleRows: Array<Record<string, string>>;
  suggestedMapping: Mapping;
  errors: string[];
};

type Result = { totalRows: number; imported: number; duplicates: number; skipped: number };

const NONE = '__none__';
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export function ImportWizard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const onFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast.error('The file is larger than the 8 MB import limit.');
      return;
    }

    setBusy(true);
    setResult(null);
    try {
      const text = await file.text();
      const data = await apiFetch<Preview>('/api/import', { method: 'POST', body: { mode: 'preview', content: text } });

      setContent(text);
      setFileName(file.name);
      setPreview(data);
      setMapping(data.suggestedMapping);

      if (data.rowCount === 0) toast.error('No data rows were detected in this file.');
      else toast.success(`Detected ${formatNumber(data.rowCount)} rows`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!content || !preview) return;
    if (!mapping.businessName) {
      toast.error('Map a column to Business Name before importing.');
      return;
    }

    setBusy(true);
    try {
      const data = await apiFetch<Result>('/api/import', {
        method: 'POST',
        body: { mode: 'commit', content, fileName, mapping },
      });
      setResult(data);
      toast.success('Import complete', {
        description: `${formatNumber(data.imported)} imported · ${formatNumber(data.duplicates)} duplicates`,
      });
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The import failed.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setContent(null);
    setPreview(null);
    setMapping({});
    setResult(null);
    setFileName('');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1 · Upload a CSV</CardTitle>
          <CardDescription>
            The first row must contain column headers. Nothing is written until you confirm the mapping.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label
            htmlFor="csv-input"
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-secondary/30 px-6 py-10 text-center transition-colors hover:border-foreground/25 hover:bg-secondary/50"
          >
            <FileUp className="size-5 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">{fileName || 'Choose a CSV file'}</span>
            <span className="text-2xs text-muted-foreground">Up to 8 MB</span>
            <input
              id="csv-input"
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
          </label>
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>2 · Map the columns</CardTitle>
              <CardDescription>
                Detected {formatNumber(preview.rowCount)} rows and {preview.headers.length} columns.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={reset}>
              Start over
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.errors.length > 0 ? (
              <ul className="space-y-0.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-2xs text-warning">
                {preview.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`map-${field.key}`}>
                    {field.label}
                    {field.required ? <span className="ml-1 text-destructive">*</span> : null}
                  </Label>
                  <Select
                    value={mapping[field.key] ?? NONE}
                    onValueChange={(value) =>
                      setMapping((current) => {
                        const next = { ...current };
                        if (value === NONE) delete next[field.key];
                        else next[field.key] = value;
                        return next;
                      })
                    }
                  >
                    <SelectTrigger id={`map-${field.key}`}>
                      <SelectValue placeholder="Not mapped" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not mapped</SelectItem>
                      {preview.headers.map((header) => (
                        <SelectItem key={header} value={header}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div>
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Preview · first {preview.sampleRows.length} rows
              </p>
              <div className="surface overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {preview.headers.slice(0, 7).map((header) => (
                        <TableHead key={header}>{truncate(header, 18)}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sampleRows.map((row, index) => (
                      <TableRow key={index}>
                        {preview.headers.slice(0, 7).map((header) => (
                          <TableCell key={header} className="text-xs text-muted-foreground">
                            {truncate(String(row[header] ?? ''), 26)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-2xs text-muted-foreground">
                Duplicate detection runs on every row — existing businesses are updated, not duplicated.
              </p>
              <Button onClick={commit} loading={busy} disabled={!mapping.businessName}>
                <Upload />
                Import {formatNumber(preview.rowCount)} rows
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-success" aria-hidden />
              Import complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="success">{formatNumber(result.imported)} imported</Badge>
              <Badge variant="info">{formatNumber(result.duplicates)} duplicates merged</Badge>
              <Badge variant="outline">{formatNumber(result.skipped)} skipped</Badge>
              <Badge variant="outline">{formatNumber(result.totalRows)} rows read</Badge>
            </div>
            <Button size="sm" onClick={() => router.push('/leads')}>
              View leads
              <ArrowRight />
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
