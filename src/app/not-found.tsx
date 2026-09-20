import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-secondary">
        <Compass className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">The page you were looking for does not exist.</p>
      </div>
      <Button asChild size="sm">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </main>
  );
}
