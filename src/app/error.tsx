'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app] render error', error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl border border-destructive/25 bg-destructive/10">
        <AlertTriangle className="size-5 text-destructive" aria-hidden />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The page could not be rendered. The technical details have been logged on the server.
        </p>
        {error.digest ? <p className="font-mono text-2xs text-muted-foreground">Reference: {error.digest}</p> : null}
      </div>
      <Button size="sm" onClick={reset}>
        <RotateCw />
        Try again
      </Button>
    </main>
  );
}
