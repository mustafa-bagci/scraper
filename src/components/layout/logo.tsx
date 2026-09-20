import { cn } from '@/lib/utils';

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
      >
        M
      </span>
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-tight">Murgay</span>
          <span className="mt-0.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
            Lead Intelligence
          </span>
        </span>
      )}
    </div>
  );
}
