import type { Metadata } from 'next';
import { LoginForm } from '@/components/layout/login-form';
import { Logo } from '@/components/layout/logo';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Logo className="mb-10" />
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Access the Murgay prospecting workspace.
          </p>
          <LoginForm className="mt-8" />
        </div>
      </div>

      <aside className="relative hidden flex-col justify-between border-l border-border bg-primary px-12 py-14 text-primary-foreground lg:flex">
        <div className="max-w-md">
          <p className="text-2xs font-semibold uppercase tracking-[0.2em] text-primary-foreground/60">
            Lead Intelligence
          </p>
          <p className="mt-5 text-2xl font-medium leading-snug tracking-tight">
            Find businesses that match your exact criteria, understand their public review profile, and turn them into
            qualified prospects.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-6 border-t border-primary-foreground/15 pt-8">
          {[
            { label: 'Discovery', value: 'Provider-agnostic business search' },
            { label: 'Intelligence', value: 'Transparent review & score rules' },
            { label: 'Contact', value: 'Public business email discovery' },
          ].map((item) => (
            <div key={item.label}>
              <dt className="text-2xs font-semibold uppercase tracking-wider text-primary-foreground/50">
                {item.label}
              </dt>
              <dd className="mt-1.5 text-xs leading-relaxed text-primary-foreground/80">{item.value}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </main>
  );
}
