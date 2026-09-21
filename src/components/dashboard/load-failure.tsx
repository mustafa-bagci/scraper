import Link from 'next/link';
import { AlertTriangle, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Shown when a page's data cannot be loaded.
 *
 * The workspace has exactly one operator, and they are signed in to see this,
 * so the underlying message is worth more to them than a generic apology —
 * especially on a host whose logs they may not be able to reach. It carries
 * the error's message only: no stack, no query, no connection details.
 */
export function LoadFailure({ area, detail }: { area: string; detail: string }) {
  return (
    <div className="px-4 py-5 sm:px-6">
      <div className="surface mx-auto max-w-2xl space-y-4 p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
            <AlertTriangle className="size-4 text-destructive" aria-hidden />
          </span>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">{area} could not be loaded</h2>
            <p className="text-sm text-muted-foreground">
              The rest of the application is unaffected. This is what the server reported:
            </p>
          </div>
        </div>

        <pre className="scrollbar-thin overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-secondary/60 px-3 py-2.5 font-mono text-2xs leading-relaxed">
          {detail}
        </pre>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button asChild size="sm" variant="outline">
            <Link href="/api/diagnostics" target="_blank" rel="noopener">
              <Stethoscope />
              Run diagnostics
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/leads">Go to leads</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
