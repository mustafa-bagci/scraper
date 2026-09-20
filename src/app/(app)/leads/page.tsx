import type { Metadata } from 'next';
import Link from 'next/link';
import { Radar, Upload } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { LeadsTable } from '@/components/leads/leads-table';
import { Button } from '@/components/ui/button';
import { prisma } from '@/lib/db/prisma';
import { queryFromSearchParams } from '@/lib/filters/url';
import { getSettings } from '@/lib/settings/service';
import { listLeads } from '@/server/leads/service';
import { toLeadRow } from '@/types/lead-row';
import { describeFilters } from '@/types/filters';

export const metadata: Metadata = { title: 'Leads' };
export const dynamic = 'force-dynamic';

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const query = queryFromSearchParams(raw);

  const [result, totalLeads, settings] = await Promise.all([
    listLeads(query),
    prisma.lead.count(),
    getSettings(),
  ]);

  return (
    <>
      <PageHeader
        title="Leads"
        description={describeFilters(query.filters)}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/leads/import">
                <Upload />
                Import CSV
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/search">
                <Radar />
                Find leads
              </Link>
            </Button>
          </>
        }
      />

      <div className="px-4 py-5 sm:px-6">
        <LeadsTable
          rows={result.leads.map(toLeadRow)}
          query={query}
          total={result.total}
          pageCount={result.pageCount}
          totalLeads={totalLeads}
          defaultExportFormat={settings.export.defaultFormat}
        />
      </div>
    </>
  );
}
