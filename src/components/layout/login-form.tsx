'use client';

import { useActionState } from 'react';
import { AlertCircle } from 'lucide-react';
import { loginAction, type LoginState } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const INITIAL: LoginState = { error: null };

export function LoginForm({ className }: { className?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);

  return (
    <form action={formAction} className={cn('space-y-4', className)}>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="you@murgay.com"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>

      {state.error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {state.error}
        </p>
      ) : null}

      <Button type="submit" className="w-full" loading={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>

      <p className="text-2xs leading-relaxed text-muted-foreground">
        Sessions are stored server-side and carried in an HTTP-only cookie. Passwords are hashed with scrypt.
      </p>
    </form>
  );
}
