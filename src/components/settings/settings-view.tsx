'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, KeyRound, Plug, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import type { AppSettings, ScoringRule } from '@/types/settings';
import { SCORING_METRICS, SCORING_OPERATORS } from '@/types/settings';
import type { ProviderDescriptor, ProviderStatus } from '@/lib/providers/registry';
import type { ProviderTestResult } from '@/types/provider-test';
import { NumberField, SectionForm } from './section-form';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const METRIC_LABELS: Record<(typeof SCORING_METRICS)[number], string> = {
  rating: 'Rating',
  reviewCount: 'Review count',
  badReviewCount: 'Bad review count',
  badReviewPercentage: 'Bad review percentage',
  hasEmail: 'Public email available',
  hasWebsite: 'Website available',
  hasPhone: 'Phone available',
};

const OPERATOR_LABELS: Record<(typeof SCORING_OPERATORS)[number], string> = {
  lte: '≤',
  gte: '≥',
  lt: '<',
  gt: '>',
  isTrue: 'is present',
};

export function SettingsView({
  settings,
  providers,
  statuses,
}: {
  settings: AppSettings;
  providers: ProviderDescriptor[];
  statuses: ProviderStatus[];
}) {
  const [general, setGeneral] = useState(settings.general);
  const [scoring, setScoring] = useState(settings.scoring);
  const [reviews, setReviews] = useState(settings.reviews);
  const [crawler, setCrawler] = useState(settings.crawler);
  const [limits, setLimits] = useState(settings.limits);
  const [exportSettings, setExportSettings] = useState(settings.export);
  const [security, setSecurity] = useState(settings.security);

  return (
    <Tabs defaultValue="general">
      <TabsList className="flex-wrap">
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="providers">Data Providers</TabsTrigger>
        <TabsTrigger value="email">Email Providers</TabsTrigger>
        <TabsTrigger value="crawler">Crawler</TabsTrigger>
        <TabsTrigger value="scoring">Scoring</TabsTrigger>
        <TabsTrigger value="reviews">Review Rules</TabsTrigger>
        <TabsTrigger value="limits">Cost control</TabsTrigger>
        <TabsTrigger value="export">Export</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
      </TabsList>

      {/* ------------------------------------------------------------- */}
      <TabsContent value="general">
        <SectionForm
          section="general"
          title="General"
          description="Workspace defaults used to pre-fill new searches."
          value={general}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="org">Organisation name</Label>
              <Input
                id="org"
                value={general.organisationName}
                onChange={(event) => setGeneral({ ...general, organisationName: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="country">Default country</Label>
              <Input
                id="country"
                value={general.defaultCountry}
                onChange={(event) => setGeneral({ ...general, defaultCountry: event.target.value })}
              />
            </div>
            <NumberField
              id="default-limit"
              label="Default result limit"
              value={general.defaultResultLimit}
              min={1}
              max={1000}
              onChange={(value) => setGeneral({ ...general, defaultResultLimit: value })}
            />
            <div className="space-y-1.5">
              <Label htmlFor="tz">Timezone</Label>
              <Input
                id="tz"
                value={general.timezone}
                onChange={(event) => setGeneral({ ...general, timezone: event.target.value })}
              />
            </div>
          </div>
        </SectionForm>
      </TabsContent>

      {/* ------------------------------------------------------------- */}
      <TabsContent value="providers">
        <ProviderCard
          kind="business"
          title="Business data provider"
          description="Where business records are discovered. Swapping providers requires no other change."
          providers={providers}
          status={statuses.find((status) => status.kind === 'business')}
        />
      </TabsContent>

      <TabsContent value="email" className="space-y-4">
        <ProviderCard
          kind="email-finder"
          title="Email finder"
          description="How public business email addresses are discovered."
          providers={providers}
          status={statuses.find((status) => status.kind === 'email-finder')}
        />
        <ProviderCard
          kind="email-verification"
          title="Email verification"
          description="Without a verifier the app reports “Verification unavailable” instead of guessing."
          providers={providers}
          status={statuses.find((status) => status.kind === 'email-verification')}
        />
      </TabsContent>

      {/* ------------------------------------------------------------- */}
      <TabsContent value="crawler">
        <SectionForm
          section="crawler"
          title="Website crawler"
          description="Limits applied when reading a business's own public pages."
          value={crawler}
          footerNote="The crawler never follows links behind a login and never attempts to bypass bot protection."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumberField
              id="max-pages"
              label="Maximum pages per domain"
              value={crawler.maxPagesPerDomain}
              min={1}
              max={25}
              onChange={(value) => setCrawler({ ...crawler, maxPagesPerDomain: value })}
            />
            <NumberField
              id="timeout"
              label="Request timeout"
              suffix="ms"
              value={crawler.timeoutMs}
              min={1000}
              max={60000}
              step={500}
              onChange={(value) => setCrawler({ ...crawler, timeoutMs: value })}
            />
            <NumberField
              id="max-bytes"
              label="Maximum response size"
              suffix="bytes"
              value={crawler.maxResponseBytes}
              min={10000}
              max={10000000}
              step={100000}
              onChange={(value) => setCrawler({ ...crawler, maxResponseBytes: value })}
            />
            <NumberField
              id="redirects"
              label="Maximum redirects"
              value={crawler.maxRedirects}
              min={0}
              max={10}
              onChange={(value) => setCrawler({ ...crawler, maxRedirects: value })}
            />
            <NumberField
              id="delay"
              label="Delay between requests"
              suffix="ms"
              value={crawler.requestDelayMs}
              min={0}
              max={10000}
              step={100}
              onChange={(value) => setCrawler({ ...crawler, requestDelayMs: value })}
            />
            <div className="space-y-1.5">
              <Label htmlFor="ua">User agent</Label>
              <Input
                id="ua"
                value={crawler.userAgent}
                onChange={(event) => setCrawler({ ...crawler, userAgent: event.target.value })}
              />
            </div>
          </div>

          <Separator className="my-4" />

          <div className="space-y-3">
            <ToggleRow
              id="robots"
              label="Respect robots.txt"
              description="Skip paths the site disallows and honour its crawl-delay."
              checked={crawler.respectRobotsTxt}
              onCheckedChange={(checked) => setCrawler({ ...crawler, respectRobotsTxt: checked })}
            />
            <ToggleRow
              id="generic"
              label="Prefer generic mailboxes"
              description="Rank contact@, info@, bonjour@ above named individual addresses."
              checked={crawler.preferGenericMailboxes}
              onCheckedChange={(checked) => setCrawler({ ...crawler, preferGenericMailboxes: checked })}
            />
          </div>
        </SectionForm>
      </TabsContent>

      {/* ------------------------------------------------------------- */}
      <TabsContent value="scoring">
        <SectionForm
          section="scoring"
          title="Lead scoring"
          description="Transparent rules. Saving re-scores every stored lead."
          value={scoring}
          footerNote="Each rule adds its points when it matches. The total is capped at the maximum score."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="max-score"
              label="Maximum score"
              value={scoring.maxScore}
              min={1}
              max={1000}
              onChange={(value) => setScoring({ ...scoring, maxScore: value })}
            />
            <NumberField
              id="qualified"
              label="Qualified threshold"
              hint="Leads at or above this score count as qualified on the dashboard."
              value={scoring.qualifiedThreshold}
              min={0}
              max={1000}
              onChange={(value) => setScoring({ ...scoring, qualifiedThreshold: value })}
            />
          </div>

          <Separator className="my-4" />

          <ul className="space-y-2">
            {scoring.rules.map((rule, index) => (
              <li key={rule.id} className="rounded-lg border border-border p-3">
                <div className="grid items-end gap-2 sm:grid-cols-[auto_1fr_172px_124px_88px_76px_auto]">
                  <Checkbox
                    checked={rule.enabled}
                    onCheckedChange={(checked) => updateRule(index, { enabled: checked === true })}
                    aria-label={`Enable ${rule.label}`}
                    className="mb-2.5"
                  />

                  <Input
                    value={rule.label}
                    onChange={(event) => updateRule(index, { label: event.target.value })}
                    aria-label="Rule label"
                  />

                  <Select value={rule.metric} onValueChange={(value) => updateRule(index, { metric: value as ScoringRule['metric'] })}>
                    <SelectTrigger aria-label="Metric">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCORING_METRICS.map((metric) => (
                        <SelectItem key={metric} value={metric}>
                          {METRIC_LABELS[metric]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={rule.operator}
                    onValueChange={(value) => updateRule(index, { operator: value as ScoringRule['operator'] })}
                  >
                    <SelectTrigger aria-label="Operator">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCORING_OPERATORS.map((operator) => (
                        <SelectItem key={operator} value={operator}>
                          {OPERATOR_LABELS[operator]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    type="number"
                    step="0.1"
                    value={rule.operator === 'isTrue' ? '' : (rule.value ?? '')}
                    disabled={rule.operator === 'isTrue'}
                    placeholder="Value"
                    aria-label="Threshold"
                    onChange={(event) =>
                      updateRule(index, { value: event.target.value === '' ? undefined : Number(event.target.value) })
                    }
                  />

                  <Input
                    type="number"
                    value={rule.points}
                    aria-label="Points"
                    onChange={(event) => updateRule(index, { points: Number(event.target.value) || 0 })}
                  />

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove rule"
                    className="mb-0.5 text-muted-foreground hover:text-destructive"
                    onClick={() => setScoring({ ...scoring, rules: scoring.rules.filter((_, i) => i !== index) })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() =>
              setScoring({
                ...scoring,
                rules: [
                  ...scoring.rules,
                  {
                    id: `rule-${Date.now()}`,
                    label: 'New rule',
                    metric: 'rating',
                    operator: 'lte',
                    value: 4,
                    points: 10,
                    enabled: true,
                  },
                ],
              })
            }
          >
            <Plus />
            Add rule
          </Button>
        </SectionForm>
      </TabsContent>

      {/* ------------------------------------------------------------- */}
      <TabsContent value="reviews">
        <SectionForm
          section="reviews"
          title="Review rules"
          description="What counts as a bad review. Saving recalculates every lead's statistics and score."
          value={reviews}
          footerNote="Bad review percentage = bad reviews ÷ total reviews."
        >
          <div className="space-y-3">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Bad review definition</p>
            <div className="flex flex-wrap gap-4">
              {[1, 2, 3, 4, 5].map((star) => (
                <label key={star} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={reviews.badReviewStars.includes(star)}
                    onCheckedChange={(checked) =>
                      setReviews({
                        ...reviews,
                        badReviewStars: checked
                          ? [...reviews.badReviewStars, star].sort((a, b) => a - b)
                          : reviews.badReviewStars.filter((value) => value !== star),
                      })
                    }
                  />
                  {star} star{star > 1 ? 's' : ''}
                </label>
              ))}
            </div>

            {reviews.badReviewStars.length === 0 ? (
              <p className="flex items-center gap-2 text-2xs text-destructive">
                <AlertTriangle className="size-3.5" aria-hidden />
                Select at least one star rating.
              </p>
            ) : null}

            <Separator className="my-2" />

            <NumberField
              id="max-reviews"
              label="Maximum reviews stored per lead"
              hint="Caps how much review text is kept. Statistics still use the provider's full counts."
              value={reviews.maxStoredReviewsPerLead}
              min={0}
              max={500}
              onChange={(value) => setReviews({ ...reviews, maxStoredReviewsPerLead: value })}
            />
          </div>
        </SectionForm>
      </TabsContent>

      {/* ------------------------------------------------------------- */}
      <TabsContent value="limits">
        <SectionForm
          section="limits"
          title="Cost control"
          description="Hard ceilings on provider usage, enforced server-side."
          value={limits}
          footerNote="Daily counters reset at midnight UTC."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumberField
              id="max-businesses"
              label="Max businesses per search"
              value={limits.maxBusinessesPerSearch}
              min={1}
              max={1000}
              onChange={(value) => setLimits({ ...limits, maxBusinessesPerSearch: value })}
            />
            <NumberField
              id="max-searches"
              label="Max searches per day"
              value={limits.maxSearchesPerDay}
              min={1}
              max={10000}
              onChange={(value) => setLimits({ ...limits, maxSearchesPerDay: value })}
            />
            <NumberField
              id="max-lookups"
              label="Max email lookups per day"
              value={limits.maxEmailLookupsPerDay}
              min={1}
              max={100000}
              onChange={(value) => setLimits({ ...limits, maxEmailLookupsPerDay: value })}
            />
            <NumberField
              id="max-verifications"
              label="Max verifications per day"
              value={limits.maxVerificationsPerDay}
              min={1}
              max={100000}
              onChange={(value) => setLimits({ ...limits, maxVerificationsPerDay: value })}
            />
            <NumberField
              id="cost-business"
              label="Cost per business"
              step={0.001}
              value={limits.estimatedCostPerBusiness}
              min={0}
              max={10}
              onChange={(value) => setLimits({ ...limits, estimatedCostPerBusiness: value })}
            />
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Input
                id="currency"
                value={limits.currency}
                onChange={(event) => setLimits({ ...limits, currency: event.target.value })}
              />
            </div>
          </div>
        </SectionForm>
      </TabsContent>

      {/* ------------------------------------------------------------- */}
      <TabsContent value="export">
        <SectionForm
          section="export"
          title="Export"
          description="Defaults applied to CSV, XLSX and JSON downloads."
          value={exportSettings}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="format">Default format</Label>
              <Select
                value={exportSettings.defaultFormat}
                onValueChange={(value) =>
                  setExportSettings({ ...exportSettings, defaultFormat: value as 'CSV' | 'XLSX' | 'JSON' })
                }
              >
                <SelectTrigger id="format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CSV">CSV</SelectItem>
                  <SelectItem value="XLSX">XLSX</SelectItem>
                  <SelectItem value="JSON">JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="delimiter">CSV delimiter</Label>
              <Select
                value={exportSettings.csvDelimiter}
                onValueChange={(value) =>
                  setExportSettings({ ...exportSettings, csvDelimiter: value as ',' | ';' | '\t' })
                }
              >
                <SelectTrigger id="delimiter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=",">Comma ( , )</SelectItem>
                  <SelectItem value=";">Semicolon ( ; ) — French Excel</SelectItem>
                  <SelectItem value={'\t'}>Tab</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <NumberField
              id="max-rows"
              label="Maximum rows per export"
              value={exportSettings.maxRowsPerExport}
              min={1}
              max={100000}
              step={1000}
              onChange={(value) => setExportSettings({ ...exportSettings, maxRowsPerExport: value })}
            />
          </div>

          <Separator className="my-4" />

          <ToggleRow
            id="source-urls"
            label="Include source URLs"
            description="Keep the provenance columns (source URL, email source page) in exports."
            checked={exportSettings.includeSourceUrls}
            onCheckedChange={(checked) => setExportSettings({ ...exportSettings, includeSourceUrls: checked })}
          />
        </SectionForm>
      </TabsContent>

      {/* ------------------------------------------------------------- */}
      <TabsContent value="security">
        <SectionForm
          section="security"
          title="Security"
          description="Session lifetime and extra hosts the crawler must never contact."
          value={security}
          footerNote="Private, loopback, link-local and cloud metadata addresses are always blocked, regardless of this list."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="session-ttl"
              label="Session lifetime"
              suffix="hours"
              value={security.sessionTtlHours}
              min={1}
              max={720}
              onChange={(value) => setSecurity({ ...security, sessionTtlHours: value })}
            />
            <div className="space-y-1.5">
              <Label htmlFor="blocked">Additional blocked hosts</Label>
              <Input
                id="blocked"
                placeholder="internal.example.com, staging.example.net"
                value={security.blockedHosts.join(', ')}
                onChange={(event) =>
                  setSecurity({
                    ...security,
                    blockedHosts: event.target.value
                      .split(',')
                      .map((host) => host.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
          </div>
        </SectionForm>
      </TabsContent>
    </Tabs>
  );

  function updateRule(index: number, patch: Partial<ScoringRule>) {
    setScoring({
      ...scoring,
      rules: scoring.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    });
  }
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p className="text-2xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function ProviderCard({
  kind,
  title,
  description,
  providers,
  status,
}: {
  kind: ProviderStatus['kind'];
  title: string;
  description: string;
  providers: ProviderDescriptor[];
  status: ProviderStatus | undefined;
}) {
  const router = useRouter();
  const options = providers.filter((provider) => provider.kind === kind);
  const [selected, setSelected] = useState(status?.activeId ?? options[0]?.id ?? '');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const descriptor = options.find((option) => option.id === selected);

  // Selecting a provider or typing a key changes nothing until it is saved,
  // and testing before saving reports the previous state — which reads as a bug.
  const unsaved = selected !== status?.activeId || apiKey.trim().length > 0;

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch('/api/providers', {
        method: 'PATCH',
        body: { kind, providerId: selected, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) },
      });
      setApiKey('');
      toast.success('Provider updated');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The provider could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<ProviderTestResult>('/api/providers/test', {
        method: 'POST',
        body: { country: 'France', city: 'Lyon', category: 'dentist', raw: true },
      });
      setTestResult(JSON.stringify(result, null, 2));
      if (result.ok) toast.success(`${result.provider.name} answered`, { description: `${result.ms} ms` });
      else toast.error(result.error ?? 'The provider call failed.');
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : 'The provider could not be reached.';
      setTestResult(message);
      toast.error(message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {status ? (
          <Badge variant={status.configured ? 'success' : 'warning'}>
            {status.configured ? 'Ready' : 'Needs API key'}
          </Badge>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`provider-${kind}`}>Provider</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger id={`provider-${kind}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`key-${kind}`}>API key</Label>
            <Input
              id={`key-${kind}`}
              type="password"
              autoComplete="off"
              value={apiKey}
              disabled={!descriptor?.requiresApiKey}
              placeholder={
                descriptor?.requiresApiKey
                  ? (descriptor.credentialHint ?? 'Paste the provider API key')
                  : 'Not required for this provider'
              }
              onChange={(event) => setApiKey(event.target.value)}
            />
            {descriptor?.requiresApiKey ? (
              <p className="text-2xs text-muted-foreground">
                {descriptor.credentialHint ? `${descriptor.credentialHint}. ` : ''}
                {status?.activeId === selected && status?.hasApiKey
                  ? 'A credential is stored — leave this blank to keep it.'
                  : 'No credential stored for this provider yet.'}
              </p>
            ) : null}
          </div>
        </div>

        {descriptor ? (
          <p className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-2xs text-muted-foreground">
            {descriptor.description}
          </p>
        ) : null}

        {status?.lastError ? (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-2xs text-destructive">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            {status.lastError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <KeyRound className="size-3.5" aria-hidden />
            Keys are encrypted at rest and never sent to the browser.
            {status?.source === 'environment' ? ' Currently read from the environment.' : ''}
          </p>
          <div className="flex items-center gap-2">
            {kind === 'business' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={runTest}
                loading={testing}
                disabled={unsaved}
                title={unsaved ? 'Save the provider first — a test runs against what is stored.' : undefined}
              >
                <Plug />
                Test connection
              </Button>
            ) : null}
            <Button size="sm" onClick={save} loading={saving}>
              Save provider
            </Button>
          </div>
        </div>

        {kind === 'business' && unsaved ? (
          <p className="text-2xs text-muted-foreground">
            Save before testing — the test runs against the stored configuration, not what is on screen.
          </p>
        ) : null}

        {testResult ? (
          <div className="space-y-1.5">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Live response — one record, as the app read it
            </p>
            <pre className="scrollbar-thin max-h-80 overflow-auto rounded-lg border border-border bg-secondary/50 px-3 py-2.5 font-mono text-2xs leading-relaxed">
              {testResult}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
