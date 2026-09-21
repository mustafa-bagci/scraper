import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { getCurrentUser } from '@/lib/auth/session';
import { getProviderStatuses } from '@/lib/providers/registry';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // The shell wraps every authenticated page, so a provider lookup that fails
  // must not be able to black out the whole application.
  let demoMode = false;
  try {
    const statuses = await getProviderStatuses();
    demoMode = statuses.find((status) => status.kind === 'business')?.activeId === 'mock';
  } catch (error) {
    console.error('[layout] could not resolve provider status', error);
  }

  return (
    <AppShell user={{ name: user.name, email: user.email }} demoMode={demoMode}>
      {children}
    </AppShell>
  );
}
