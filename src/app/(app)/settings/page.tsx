import type { Metadata } from 'next';
import { PageHeader } from '@/components/layout/page-header';
import { SettingsView } from '@/components/settings/settings-view';
import { getSettings } from '@/lib/settings/service';
import { AVAILABLE_PROVIDERS, getProviderStatuses } from '@/lib/providers/registry';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [settings, statuses] = await Promise.all([getSettings(), getProviderStatuses()]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Providers, scoring rules, review definitions, crawler limits and cost control."
      />
      <div className="px-4 py-5 sm:px-6">
        <SettingsView settings={settings} providers={AVAILABLE_PROVIDERS} statuses={statuses} />
      </div>
    </>
  );
}
