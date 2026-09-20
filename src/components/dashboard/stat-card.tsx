import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: LucideIcon;
  href?: string;
  tone?: 'default' | 'success' | 'warning';
}) {
  const content = (
    <div className="surface flex h-full flex-col justify-between gap-3 p-4 transition-colors hover:border-foreground/15">
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon
          className={cn(
            'size-4 shrink-0',
            tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-muted-foreground',
          )}
          aria-hidden
        />
      </div>
      <div>
        <p className="tabular text-2xl font-semibold tracking-tight">
          {typeof value === 'number' ? formatNumber(value) : value}
        </p>
        {hint ? <p className="mt-0.5 text-2xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {content}
    </Link>
  ) : (
    content
  );
}
