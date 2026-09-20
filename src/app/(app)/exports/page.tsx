import type { Metadata } from 'next';
import Link from 'next/link';
import { Download, Table2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { prisma } from '@/lib/db/prisma';
import { EXPORT_COLUMNS } from '@/server/exports/service';
import { describeFilters, type LeadFilters } from '@/types/filters';
import { formatDateTime, formatNumber } from '@/lib/utils';

export const metadata: Metadata = { title: 'Exports' };
export const dynamic = 'force-dynamic';

export default async function ExportsPage() {
  const exports = await prisma.exportRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });

  return (
    <>
      <PageHeader
        title="Exports"
        description="Every file generated from this workspace, with the scope it covered."
        actions={
          <Button asChild size="sm">
            <Link href="/leads">
              <Table2 />
              Go to leads
            </Link>
          </Button>
        }
      />

      <div className="space-y-5 px-4 py-5 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Export history</CardTitle>
            <CardDescription>
              Files are generated on demand and streamed straight to your browser — nothing is stored on the server.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {exports.length === 0 ? (
              <EmptyState
                icon={Download}
                title="No exports yet"
                description="Select leads on the Leads page and export them as CSV, XLSX or JSON."
                action={
                  <Button asChild size="sm">
                    <Link href="/leads">Open leads</Link>
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead>Filters</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exports.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.fileName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.format}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.scope}</TableCell>
                      <TableCell className="tabular text-right">{formatNumber(item.rowCount)}</TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                        {describeFilters((item.filters ?? {}) as LeadFilters)}
                      </TableCell>
                      <TableCell className="text-right text-2xs text-muted-foreground">
                        {formatDateTime(item.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Export schema</CardTitle>
            <CardDescription>
              Column order is stable across CSV, XLSX and JSON, so downstream tooling can rely on it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {EXPORT_COLUMNS.map((column, index) => (
                <li key={column.key} className="flex gap-2 text-muted-foreground">
                  <span className="tabular w-5 text-right">{index + 1}.</span>
                  <span className="text-foreground">{column.header}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
