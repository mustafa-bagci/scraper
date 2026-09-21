import type { Metadata } from 'next';
import { CircleAlert, UserPlus } from 'lucide-react';
import { LoginForm } from '@/components/layout/login-form';
import { Logo } from '@/components/layout/logo';
import { ensureAdminUser } from '@/server/auth/bootstrap';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // A hosted deployment has no terminal to seed from, so the first account is
  // created here from the environment. This is a no-op once one exists.
  const bootstrap = await ensureAdminUser();
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Logo className="mb-10" />
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Access the Murgay prospecting workspace.
          </p>
          {bootstrap.status === 'created' || bootstrap.status === 'awaiting-first-login' ? (
            <p className="mt-6 flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-xs text-success">
              <UserPlus className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                Your admin account is ready. Sign in with the <strong>ADMIN_EMAIL</strong> and{' '}
                <strong>ADMIN_PASSWORD</strong> you configured. This notice disappears after the first sign-in.
              </span>
            </p>
          ) : null}

          {bootstrap.status === 'unconfigured' ? (
            <div className="mt-6 space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              <p className="flex items-start gap-2">
                <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>
                  <strong>No account exists yet.</strong> {bootstrap.reason}
                </span>
              </p>
              <p className="pl-5 text-2xs leading-relaxed opacity-90">
                Add <code className="font-mono">ADMIN_EMAIL</code> and <code className="font-mono">ADMIN_PASSWORD</code>{' '}
                to your deployment&rsquo;s environment variables, redeploy, then reload this page. The account is created
                once; after that the variables are ignored.
              </p>
            </div>
          ) : null}

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
