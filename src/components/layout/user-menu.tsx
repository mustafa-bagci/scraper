'use client';

import { LogOut, User as UserIcon } from 'lucide-react';
import { logoutAction } from '@/lib/auth/actions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function UserMenu({ user }: { user: { name: string | null; email: string } }) {
  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-2xs font-semibold">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{user.name ?? 'Administrator'}</span>
          <span className="block truncate text-2xs text-muted-foreground">{user.email}</span>
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel>Signed in</DropdownMenuLabel>
        <DropdownMenuItem disabled>
          <UserIcon />
          {user.email}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={logoutAction}>
          <button type="submit" className="w-full">
            <DropdownMenuItem destructive onSelect={(event) => event.preventDefault()} asChild>
              <span className="flex w-full cursor-pointer items-center gap-2">
                <LogOut />
                Sign out
              </span>
            </DropdownMenuItem>
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
