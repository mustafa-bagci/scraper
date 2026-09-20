import { EmailStatus, LeadStatus, WebsiteStatus } from '@prisma/client';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Shared vocabulary for lead / email status presentation. */

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'New',
  QUALIFIED: 'Qualified',
  CONTACTED: 'Contacted',
  REPLIED: 'Replied',
  INTERESTED: 'Interested',
  NOT_INTERESTED: 'Not interested',
  CUSTOMER: 'Customer',
  ARCHIVED: 'Archived',
};

const LEAD_STATUS_VARIANT: Record<LeadStatus, BadgeProps['variant']> = {
  NEW: 'outline',
  QUALIFIED: 'info',
  CONTACTED: 'default',
  REPLIED: 'default',
  INTERESTED: 'success',
  NOT_INTERESTED: 'destructive',
  CUSTOMER: 'success',
  ARCHIVED: 'outline',
};

export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  UNKNOWN: 'Unknown',
  FOUND: 'Found',
  VALID: 'Valid',
  INVALID: 'Invalid',
  RISKY: 'Risky',
  DISPOSABLE: 'Disposable',
};

const EMAIL_STATUS_VARIANT: Record<EmailStatus, BadgeProps['variant']> = {
  UNKNOWN: 'outline',
  FOUND: 'info',
  VALID: 'success',
  INVALID: 'destructive',
  RISKY: 'warning',
  DISPOSABLE: 'destructive',
};

export const WEBSITE_STATUS_LABELS: Record<WebsiteStatus, string> = {
  UNKNOWN: 'Not checked',
  REACHABLE: 'Reachable',
  UNREACHABLE: 'Unreachable',
  BLOCKED: 'Blocked',
  CRAWLED: 'Crawled',
  NO_WEBSITE: 'No website',
};

export function LeadStatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  return (
    <Badge variant={LEAD_STATUS_VARIANT[status]} className={className}>
      {LEAD_STATUS_LABELS[status]}
    </Badge>
  );
}

export function EmailStatusBadge({ status, className }: { status: EmailStatus; className?: string }) {
  return (
    <Badge variant={EMAIL_STATUS_VARIANT[status]} className={className}>
      {EMAIL_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Score pill; colour tracks the qualification bands used on the dashboard. */
export function ScorePill({ score, max = 100, className }: { score: number; max?: number; className?: string }) {
  const ratio = max > 0 ? score / max : 0;
  const tone =
    ratio >= 0.8
      ? 'bg-success/12 text-success'
      : ratio >= 0.6
        ? 'bg-accent text-accent-foreground'
        : ratio >= 0.4
          ? 'bg-warning/15 text-warning'
          : 'bg-secondary text-muted-foreground';

  return (
    <span
      className={cn('tabular inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold', tone, className)}
      title={`Lead score ${score} of ${max}`}
    >
      {score}
    </span>
  );
}

export function RatingValue({ rating, className }: { rating: number | null; className?: string }) {
  if (rating === null) return <span className="text-muted-foreground">—</span>;

  const tone = rating < 3.5 ? 'text-destructive' : rating < 4.2 ? 'text-warning' : 'text-foreground';
  return (
    <span className={cn('tabular inline-flex items-center gap-1 font-medium', tone, className)}>
      {rating.toFixed(1)}
      <span aria-hidden className="text-2xs">
        ★
      </span>
    </span>
  );
}
