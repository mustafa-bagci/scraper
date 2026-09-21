import type { Metadata } from 'next';
import { PageHeader } from '@/components/layout/page-header';
import { SearchConsole } from '@/components/search/search-console';
import { getSettings } from '@/lib/settings/service';
import { getBusinessProvider, getProviderStatuses } from '@/lib/providers/registry';
import { filtersFromSearchParams } from '@/lib/filters/url';

export const metadata: Metadata = { title: 'Find Leads' };
export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const [settings, provider, statuses] = await Promise.all([
    getSettings(),
    getBusinessProvider(),
    getProviderStatuses(),
  ]);

  const businessStatus = statuses.find((status) => status.kind === 'business');

  return (
    <>
      <PageHeader
        title="Find Prospects"
        description="Discover businesses that match your criteria, then qualify them on their public review profile."
      />

      <div className="px-4 py-5 sm:px-6">
        <SearchConsole
          initialFilters={filtersFromSearchParams(raw)}
          defaults={{
            country: settings.general.defaultCountry,
            resultLimit: settings.general.defaultResultLimit,
          }}
          costPerBusiness={settings.limits.estimatedCostPerBusiness}
          currency={settings.limits.currency}
          maxResults={Math.min(settings.limits.maxBusinessesPerSearch, provider.capabilities.maxResultsPerSearch)}
          providerLabel={businessStatus?.activeLabel ?? provider.name}
          providerConfigured={businessStatus?.configured ?? provider.isConfigured()}
          providerHasReviewBreakdown={provider.capabilities.reviewBreakdown}
        />
      </div>
    </>
  );
}
