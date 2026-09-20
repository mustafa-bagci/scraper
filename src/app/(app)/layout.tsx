import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { getCurrentUser } from '@/lib/auth/session';
import { getProviderStatuses } from '@/lib/providers/registry';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const statuses = await getProviderStatuses();
  const businessProvider = statuses.find((status) => status.kind === 'business');

  return (
    <AppShell user={{ name: user.name, email: user.email }} demoMode={businessProvider?.activeId === 'mock'}>
      {children}
    </AppShell>
  );
}
