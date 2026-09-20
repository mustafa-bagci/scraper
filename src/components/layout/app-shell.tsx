'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Download,
  LayoutDashboard,
  Menu,
  Radar,
  Settings,
  Table2,
  History,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Logo } from './logo';
import { UserMenu } from './user-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type NavItem = { href: string; label: string; icon: LucideIcon };

const PRIMARY_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/search', label: 'Find Leads', icon: Radar },
  { href: '/leads', label: 'Leads', icon: Table2 },
  { href: '/searches', label: 'Searches', icon: History },
  { href: '/exports', label: 'Exports', icon: Download },
];

const SECONDARY_NAV: NavItem[] = [{ href: '/settings', label: 'Settings', icon: Settings }];

export function AppShell({
  user,
  demoMode,
  children,
}: {
  user: { name: string | null; email: string };
  demoMode: boolean;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[236px_1fr]">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen((open) => !open)} aria-label="Toggle navigation">
          {mobileOpen ? <X /> : <Menu />}
        </Button>
      </header>

      <aside
        className={cn(
          'z-30 flex-col border-r border-border bg-card lg:sticky lg:top-0 lg:flex lg:h-screen',
          mobileOpen ? 'flex' : 'hidden',
        )}
      >
        <div className="hidden h-14 items-center px-5 lg:flex">
          <Logo />
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4 lg:py-2" aria-label="Main">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={() => setMobileOpen(false)} />
          ))}

          <div className="my-3 h-px bg-border" />

          {SECONDARY_NAV.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={() => setMobileOpen(false)} />
          ))}
        </nav>

        <div className="space-y-3 border-t border-border p-3">
          {demoMode ? (
            <div className="rounded-lg border border-border bg-secondary/60 px-3 py-2.5">
              <Badge variant="warning" className="mb-1.5">
                Demo data
              </Badge>
              <p className="text-2xs leading-relaxed text-muted-foreground">
                The mock business provider is active. Connect a provider in Settings to search live data.
              </p>
            </div>
          ) : null}
          <UserMenu user={user} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">{children}</div>
    </div>
  );
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {item.label}
    </Link>
  );
}
