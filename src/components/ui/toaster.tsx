'use client';

import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: 'rounded-lg border border-border bg-card text-foreground shadow-lg text-sm',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
        },
      }}
    />
  );
}
