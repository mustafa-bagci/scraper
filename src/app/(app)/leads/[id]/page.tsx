import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  Building2,
  CheckCircle2,
  ExternalLink,
  Globe,
  Info,
  Mail,
  MapPin,
  Phone,
  ShieldQuestion,
  Star,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { RatingBreakdownChart } from '@/components/dashboard/charts';
import { LeadActions } from '@/components/leads/lead-actions';
import { CopyButton } from '@/components/leads/copy-button';
import { NotesPanel } from '@/components/leads/notes-panel';
import {
  EMAIL_STATUS_LABELS,
  EmailStatusBadge,
  RatingValue,
  ScorePill,
  WEBSITE_STATUS_LABELS,
} from '@/components/leads/display';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getLeadDetail } from '@/server/leads/service';
import { getSettings } from '@/lib/settings/service';
import { getProviderStatuses } from '@/lib/providers/registry';
import { parseStoredBreakdown } from '@/lib/scoring/engine';
import { badReviewLabel } from '@/lib/reviews/stats';
import { displayDomain, formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/utils';

type Params = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const lead = await getLeadDetail(id);
  return { title: lead?.businessName ?? 'Lead' };
}

export default async function LeadDetailPage({ params }: Params) {
  const { id } = await params;
  const [lead, settings, providerStatuses] = await Promise.all([
    getLeadDetail(id),
    getSettings(),
    getProviderStatuses(),
  ]);

  if (!lead) notFound();

  const breakdown = parseStoredBreakdown(lead.scoreBreakdown);
  const matched = breakdown?.contributions.filter((item) => item.matched) ?? [];
  const unmatched = breakdown?.contributions.filter((item) => !item.matched) ?? [];
  const maxScore = breakdown?.maxScore ?? settings.scoring.maxScore;

  const verifierStatus = providerStatuses.find((status) => status.kind === 'email-verification');
  const verificationConfigured = verifierStatus ? verifierStatus.activeId !== 'none' : false;

  const lowRatingReviews = lead.reviews.filter((review) =>
    settings.reviews.badReviewStars.includes(review.rating),
  );

  const ratingChartData = [
    { star: '5★', count: lead.fiveStarCount },
    { star: '4★', count: lead.fourStarCount },
    { star: '3★', count: lead.threeStarCount },
    { star: '2★', count: lead.twoStarCount },
    { star: '1★', count: lead.oneStarCount },
  ];

  return (
    <>
      <PageHeader
        title={lead.businessName}
        description={[lead.category, lead.city, lead.country].filter(Boolean).join(' · ')}
        actions={
          <LeadActions
            leadId={lead.id}
            status={lead.status}
            hasWebsite={Boolean(lead.website)}
            hasEmail={Boolean(lead.email)}
          />
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Button asChild variant="ghost" size="xs" className="-ml-2 text-muted-foreground">
            <Link href="/leads">
              <ArrowLeft />
              All leads
            </Link>
          </Button>
          <span className="flex items-center gap-1.5">
            <RatingValue rating={lead.rating} />
            <span className="text-muted-foreground">·</span>
            <span className="tabular text-muted-foreground">{formatNumber(lead.reviewCount)} reviews</span>
          </span>
          {lead.reviewBreakdownAvailable ? (
            <span className="tabular text-muted-foreground">
              {formatNumber(lead.badReviewCount)} bad ({formatPercent(lead.badReviewPercentage)})
            </span>
          ) : null}
          <span className="flex items-center gap-1.5">
            <ScorePill score={lead.leadScore} max={maxScore} />
            <span className="text-2xs text-muted-foreground">/ {maxScore} lead score</span>
          </span>
        </div>
      </PageHeader>

      <div className="px-4 py-5 sm:px-6">
        <Tabs defaultValue="overview">
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="reviews">Reviews</TabsTrigger>
            <TabsTrigger value="contact">Contact</TabsTrigger>
            <TabsTrigger value="qualification">Qualification</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>

          {/* ---------------------------------------------------------- */}
          <TabsContent value="overview" className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Business</CardTitle>
                <CardDescription>What the data source published about this business.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <DetailRow icon={Building2} label="Category" value={lead.category ?? '—'} />
                  <DetailRow icon={MapPin} label="Address" value={lead.address ?? '—'} />
                  <DetailRow icon={Phone} label="Phone" value={lead.phone ?? '—'} copy={lead.phone ?? undefined} />
                  <DetailRow
                    icon={Globe}
                    label="Website"
                    value={lead.website ? displayDomain(lead.website) : '—'}
                    href={lead.website ?? undefined}
                  />
                  <DetailRow icon={Mail} label="Email" value={lead.email ?? 'Not discovered yet'} copy={lead.email ?? undefined} />
                  <DetailRow
                    icon={ExternalLink}
                    label="Source"
                    value={lead.sourceUrl ? displayDomain(lead.sourceUrl) : lead.provider}
                    href={lead.sourceUrl ?? undefined}
                  />
                </dl>

                <Separator className="my-4" />

                <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                  <ProvenanceRow label="Data source" value={lead.provider} />
                  <ProvenanceRow label="Collected" value={formatDateTime(lead.collectedAt)} />
                  <ProvenanceRow label="Purpose" value={lead.collectionPurpose} />
                  <ProvenanceRow label="Last updated" value={formatDateTime(lead.updatedAt)} />
                  {lead.searchRun ? (
                    <ProvenanceRow label="Discovered by search" value={lead.searchRun.label} />
                  ) : null}
                  <ProvenanceRow label="Website status" value={WEBSITE_STATUS_LABELS[lead.websiteStatus]} />
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Why this lead matches</CardTitle>
                <CardDescription>Generated from your scoring rules — not an AI opinion.</CardDescription>
              </CardHeader>
              <CardContent>
                {matched.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No scoring rule currently fires for this business. Adjust the rules in Settings → Scoring.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {matched.map((item) => (
                      <li key={item.ruleId} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                        <span>
                          <span className="font-medium">{item.label}</span>
                          <span className="block text-2xs text-muted-foreground">{item.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------------------------------------------------- */}
          <TabsContent value="reviews" className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Rating distribution</CardTitle>
                <CardDescription>
                  Bad reviews are defined as {badReviewLabel(settings.reviews.badReviewStars)} in Settings.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {lead.reviewBreakdownAvailable ? (
                  <>
                    <RatingBreakdownChart data={ratingChartData} />
                    <Separator className="my-3" />
                    <dl className="space-y-1.5 text-xs">
                      <SummaryRow label="Total reviews" value={formatNumber(lead.reviewCount)} />
                      <SummaryRow label="Bad reviews" value={formatNumber(lead.badReviewCount)} emphasis />
                      <SummaryRow label="Bad review percentage" value={formatPercent(lead.badReviewPercentage, 2)} emphasis />
                    </dl>
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="flex items-start gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-xs text-muted-foreground">
                      <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                      Review details unavailable from current data source. The provider supplies an average rating and a
                      total count, but no star distribution — no counts have been inferred.
                    </p>
                    <dl className="space-y-1.5 text-xs">
                      <SummaryRow label="Average rating" value={lead.rating === null ? '—' : lead.rating.toFixed(1)} />
                      <SummaryRow label="Total reviews" value={formatNumber(lead.reviewCount)} />
                    </dl>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Low-rating reviews</CardTitle>
                <CardDescription>
                  {lowRatingReviews.length > 0
                    ? `${formatNumber(lowRatingReviews.length)} of ${formatNumber(lead.reviews.length)} stored reviews.`
                    : 'Individual review text supplied by the data source.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {lead.reviews.length === 0 ? (
                  <EmptyState
                    icon={Star}
                    title="No review text stored"
                    description="Review details unavailable from current data source."
                  />
                ) : (
                  (lowRatingReviews.length > 0 ? lowRatingReviews : lead.reviews).slice(0, 25).map((review) => (
                    <article key={review.id} className="rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
                      <header className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                        <Badge variant={review.rating <= 2 ? 'destructive' : review.rating === 3 ? 'warning' : 'success'}>
                          {review.rating}★
                        </Badge>
                        {review.authorName ? <span className="font-medium text-foreground">{review.authorName}</span> : null}
                        <span>{formatDate(review.publishedAt)}</span>
                        {review.sourceUrl ? (
                          <a
                            href={review.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="ml-auto inline-flex items-center gap-1 hover:text-foreground hover:underline"
                          >
                            Source
                            <ExternalLink className="size-3" aria-hidden />
                          </a>
                        ) : null}
                      </header>
                      {review.text ? <p className="mt-2 text-sm leading-relaxed">{review.text}</p> : null}
                    </article>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------------------------------------------------- */}
          <TabsContent value="contact" className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Primary email</CardTitle>
                <CardDescription>Public business contact address and where it was read from.</CardDescription>
              </CardHeader>
              <CardContent>
                {lead.email ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{lead.email}</span>
                      <CopyButton value={lead.email} label="Copy email" />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <EmailStatusBadge status={lead.emailStatus} />
                      {!verificationConfigured ? (
                        <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                          <ShieldQuestion className="size-3" aria-hidden />
                          Verification unavailable — no verification provider configured
                        </span>
                      ) : null}
                    </div>

                    <dl className="space-y-1.5 text-xs">
                      <SummaryRow label="Status" value={EMAIL_STATUS_LABELS[lead.emailStatus]} />
                      <SummaryRow label="Source" value={lead.emailSource ?? 'Unknown'} />
                      <SummaryRow label="Found" value={formatDateTime(lead.emailFoundAt)} />
                      <SummaryRow label="Last checked" value={formatDateTime(lead.emailCheckedAt)} />
                    </dl>

                    {lead.emailSourceUrl ? (
                      <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
                        <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Found on</p>
                        <a
                          href={lead.emailSourceUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="mt-1 inline-flex items-center gap-1 break-all text-xs hover:underline"
                        >
                          {lead.emailSourceUrl}
                          <ExternalLink className="size-3 shrink-0" aria-hidden />
                        </a>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState
                    icon={Mail}
                    title="No public email discovered"
                    description={
                      lead.website
                        ? 'Run “Find email” to check the public pages of this business’s own website.'
                        : 'This business has no website on record, so there is no public page to read an address from.'
                    }
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>All discovered addresses</CardTitle>
                <CardDescription>Every public address found, with its provenance.</CardDescription>
              </CardHeader>
              <CardContent>
                {lead.emails.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No addresses discovered yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {lead.emails.map((item) => (
                      <li key={item.id} className="rounded-lg border border-border px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs">{item.email}</span>
                          {item.isPrimary ? <Badge variant="info">Primary</Badge> : null}
                          {item.isGeneric ? <Badge variant="outline">Generic</Badge> : null}
                          <EmailStatusBadge status={item.status} className="ml-auto" />
                          <CopyButton value={item.email} label="Copy email" />
                        </div>
                        {item.sourceUrl ? (
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="mt-1 block break-all text-2xs text-muted-foreground hover:underline"
                          >
                            {item.sourceUrl}
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}

                <Separator className="my-4" />

                <dl className="space-y-1.5 text-xs">
                  <SummaryRow label="Phone" value={lead.phone ?? '—'} />
                  <SummaryRow label="Website" value={lead.website ? displayDomain(lead.website) : '—'} />
                  <SummaryRow label="Address" value={lead.address ?? '—'} />
                </dl>

                {lead.website ? (
                  <div className="mt-3 flex gap-2">
                    <Button asChild variant="outline" size="sm">
                      <a href={lead.website} target="_blank" rel="noopener noreferrer nofollow">
                        <Globe />
                        Open website
                      </a>
                    </Button>
                    {lead.emailSourceUrl ? (
                      <Button asChild variant="outline" size="sm">
                        <a href={lead.emailSourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                          <ExternalLink />
                          Open source page
                        </a>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------------------------------------------------- */}
          <TabsContent value="qualification">
            <Card>
              <CardHeader>
                <CardTitle>
                  Lead Score: {lead.leadScore}/{maxScore}
                </CardTitle>
                <CardDescription>Every point traces back to one rule you control.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={maxScore > 0 ? (lead.leadScore / maxScore) * 100 : 0} />

                <div>
                  <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Why?</p>
                  {matched.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No rule fires for this business.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {matched.map((item) => (
                        <li key={item.ruleId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span>
                            <span className="font-medium">{item.label}</span>
                            <span className="block text-2xs text-muted-foreground">{item.detail}</span>
                          </span>
                          <span className="tabular shrink-0 font-semibold text-success">+{item.points}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {unmatched.length > 0 ? (
                  <div>
                    <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Rules that did not apply
                    </p>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {unmatched.map((item) => (
                        <li
                          key={item.ruleId}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-muted-foreground"
                        >
                          <span>
                            {item.label}
                            <span className="block text-2xs">{item.detail}</span>
                          </span>
                          <span className="tabular shrink-0">+{item.points}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {breakdown ? (
                  <p className="text-2xs text-muted-foreground">
                    Computed {formatDateTime(breakdown.computedAt)} using the scoring rules in effect at that moment.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------------------------------------------------- */}
          <TabsContent value="activity">
            <Card>
              <CardHeader>
                <CardTitle>Activity</CardTitle>
                <CardDescription>Everything the platform did with this record.</CardDescription>
              </CardHeader>
              <CardContent>
                {lead.activities.length === 0 ? (
                  <EmptyState icon={Activity} title="No activity yet" description="Actions on this lead appear here." />
                ) : (
                  <ol className="space-y-3">
                    {lead.activities.map((item) => (
                      <li key={item.id} className="flex gap-3">
                        <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border" />
                        <div className="min-w-0">
                          <p className="break-words text-sm">{item.message}</p>
                          <p className="text-2xs text-muted-foreground">
                            {item.type.replaceAll('_', ' ').toLowerCase()} · {formatDateTime(item.createdAt)}
                            {item.user?.name ? ` · ${item.user.name}` : ''}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------------------------------------------------- */}
          <TabsContent value="notes">
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
                <CardDescription>Private context for your outreach.</CardDescription>
              </CardHeader>
              <CardContent>
                <NotesPanel
                  leadId={lead.id}
                  notes={lead.notes.map((note) => ({
                    id: note.id,
                    body: note.body,
                    createdAt: note.createdAt.toISOString(),
                    authorName: note.user?.name ?? note.user?.email ?? null,
                  }))}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  href,
  copy,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  href?: string;
  copy?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <dt className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd className="flex items-center gap-1">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="truncate text-sm hover:underline"
            >
              {value}
            </a>
          ) : (
            <span className="truncate text-sm">{value}</span>
          )}
          {copy ? <CopyButton value={copy} label={`Copy ${label.toLowerCase()}`} /> : null}
        </dd>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={emphasis ? 'tabular font-semibold' : 'tabular'}>{value}</dd>
    </div>
  );
}

function ProvenanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium">{value}</dd>
    </div>
  );
}
