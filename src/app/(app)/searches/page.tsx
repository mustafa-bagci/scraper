import type { Metadata } from 'next';
import Link from 'next/link';
import { Radar } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { SavedSearchList, type SavedSearchItem } from '@/components/search/saved-search-list';
import { SearchHistory, type SearchRunItem } from '@/components/search/search-history';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { prisma } from '@/lib/db/prisma';
import type { LeadFilters } from '@/types/filters';

export const metadata: Metadata = { title: 'Searches' };
export const dynamic = 'force-dynamic';

export default async function SearchesPage() {
  const [saved, runs] = await Promise.all([
    prisma.savedSearch.findMany({ orderBy: { updatedAt: 'desc' }, take: 50 }),
    prisma.searchRun.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);

  const savedItems: SavedSearchItem[] = saved.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    filters: item.filters as LeadFilters,
    runCount: item.runCount,
    lastRunAt: item.lastRunAt?.toISOString() ?? null,
    updatedAt: item.updatedAt.toISOString(),
  }));

  const runItems: SearchRunItem[] = runs.map((run) => ({
    id: run.id,
    label: run.label,
    status: run.status,
    filters: run.filters as LeadFilters,
    provider: run.provider,
    discovered: run.discovered,
    duplicates: run.duplicates,
    matched: run.matched,
    created: run.created,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
  }));

  return (
    <>
      <PageHeader
        title="Searches"
        description="Saved segments and the full history of every discovery run."
        actions={
          <Button asChild size="sm">
            <Link href="/search">
              <Radar />
              New search
            </Link>
          </Button>
        }
      />

      <div className="space-y-5 px-4 py-5 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Saved searches</CardTitle>
            <CardDescription>Named filter sets you can re-run at any time.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <SavedSearchList searches={savedItems} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Search history</CardTitle>
            <CardDescription>Discovery runs with their discovery, duplicate and match counters.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <SearchHistory runs={runItems} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
