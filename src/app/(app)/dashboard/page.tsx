import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BadgeCheck,
  Handshake,
  Mail,
  MailCheck,
  Radar,
  Send,
  Target,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { DistributionChart, LeadsOverTimeChart, RankingChart } from '@/components/dashboard/charts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmailStatusBadge, LeadStatusBadge, RatingValue, ScorePill } from '@/components/leads/display';
import { getDashboardData, type DashboardData } from '@/server/dashboard/service';
import { LoadFailure } from '@/components/dashboard/load-failure';
import { formatNumber, formatPercent, relativeTime, truncate } from '@/lib/utils';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  let data: DashboardData;
  try {
    data = await getDashboardData(30);
  } catch (error) {
    console.error('[dashboard] could not load metrics', error);
    return (
      <>
        <PageHeader title="Dashboard" description="Pipeline health across discovery, qualification and contact data." />
        <LoadFailure
          area="The dashboard"
          detail={error instanceof Error ? `${error.name}: ${error.message}` : String(error)}
        />
      </>
    );
  }

  const { metrics } = data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Pipeline health across discovery, qualification and contact data."
        actions={
          <Button asChild size="sm">
            <Link href="/search">
              <Radar />
              Find leads
            </Link>
          </Button>
        }
      />

      <div className="space-y-5 px-4 py-5 sm:px-6">
        <section aria-label="Key metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total leads" value={metrics.totalLeads} icon={Users} href="/leads" hint="All businesses stored" />
          <StatCard
            label="Qualified leads"
            value={metrics.qualifiedLeads}
            icon={Target}
            href="/leads?minScore=60"
            hint={`Score ≥ ${metrics.qualifiedThreshold} or marked qualified`}
            tone="success"
          />
          <StatCard
            label="Emails found"
            value={metrics.emailsFound}
            icon={Mail}
            hint={`${formatPercent(metrics.emailDiscoveryRate)} discovery rate`}
          />
          <StatCard
            label="Valid emails"
            value={metrics.validEmails}
            icon={MailCheck}
            hint={metrics.validEmails === 0 ? 'Connect a verification provider' : 'Confirmed by a verifier'}
          />
        </section>

        <section aria-label="Funnel" className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Contacted" value={metrics.contacted} icon={Send} />
          <StatCard label="Interested" value={metrics.interested} icon={BadgeCheck} tone="success" />
          <StatCard label="Customers" value={metrics.customers} icon={Handshake} tone="success" />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle>Leads discovered over time</CardTitle>
                <CardDescription>Last 30 days, by day of collection.</CardDescription>
              </div>
              <ul className="flex shrink-0 items-center gap-3 text-2xs text-muted-foreground">
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className="size-2 rounded-[2px] bg-[hsl(var(--chart-1))]" />
                  Leads
                </li>
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className="size-2 rounded-[2px] bg-[hsl(var(--chart-2))]" />
                  With email
                </li>
              </ul>
            </CardHeader>
            <CardContent>
              <LeadsOverTimeChart data={data.leadsOverTime} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lead quality distribution</CardTitle>
              <CardDescription>Leads by score band.</CardDescription>
            </CardHeader>
            <CardContent>
              <DistributionChart data={data.qualityDistribution} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rating distribution</CardTitle>
              <CardDescription>Public rating of every stored business.</CardDescription>
            </CardHeader>
            <CardContent>
              <DistributionChart data={data.ratingDistribution} />
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Business categories</CardTitle>
              <CardDescription>Top categories by lead count.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.topCategories.length > 0 ? (
                <RankingChart data={data.topCategories} />
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">No categorised leads yet.</p>
              )}
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent leads</CardTitle>
              <CardDescription>The most recently discovered businesses.</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/leads">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {data.recentLeads.length === 0 ? (
              <EmptyState
                icon={Radar}
                title="No leads yet"
                description="Run your first business search to start building the pipeline."
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
                    <TableHead>Business</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Reviews</TableHead>
                    <TableHead>Bad %</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Added</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentLeads.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell>
                        <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                          {truncate(lead.businessName, 40)}
                        </Link>
                        {lead.city ? <p className="text-2xs text-muted-foreground">{lead.city}</p> : null}
                      </TableCell>
                      <TableCell>
                        <RatingValue rating={lead.rating} />
                      </TableCell>
                      <TableCell className="tabular text-muted-foreground">{formatNumber(lead.reviewCount)}</TableCell>
                      <TableCell className="tabular text-muted-foreground">
                        {formatPercent(lead.badReviewPercentage)}
                      </TableCell>
                      <TableCell>
                        {lead.email ? (
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-xs">{truncate(lead.email, 26)}</span>
                            <EmailStatusBadge status={lead.emailStatus} />
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <ScorePill score={lead.leadScore} />
                      </TableCell>
                      <TableCell>
                        <LeadStatusBadge status={lead.status} />
                      </TableCell>
                      <TableCell className="text-right text-2xs text-muted-foreground">
                        {relativeTime(lead.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
