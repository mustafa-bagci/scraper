'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-6 py-10 text-center', className)}>
      <AlertTriangle className="size-5 text-destructive" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-destructive">{title}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
