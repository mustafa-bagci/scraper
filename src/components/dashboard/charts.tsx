'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DistributionPoint, TimeSeriesPoint } from '@/server/dashboard/service';

/**
 * Dashboard charts.
 *
 * Deliberately restrained: one measure per axis, recessive gridlines, no
 * decorative gradients, and a tooltip on every plot. Series colours come from
 * the validated `--chart-*` tokens so light and dark stay legible.
 */

const AXIS_STYLE = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } as const;
const GRID_COLOR = 'hsl(var(--border))';

// Dense operational charts should be readable the instant they paint; the
// entry animation only delays the number the operator came to read.
const NO_ANIMATION = { isAnimationActive: false } as const;

function TooltipBox({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string | number }>;
  label?: string | number;
  formatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
      <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="space-y-0.5">
        {payload.map((entry) => (
          <li key={String(entry.dataKey ?? entry.name)} className="flex items-center gap-2 text-xs">
            <span aria-hidden className="size-2 rounded-[2px]" style={{ background: entry.color }} />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="tabular ml-auto font-semibold">
              {formatter ? formatter(Number(entry.value ?? 0)) : Number(entry.value ?? 0).toLocaleString('en-US')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LeadsOverTimeChart({ data }: { data: TimeSeriesPoint[] }) {
  const formatted = data.map((point) => ({
    ...point,
    label: new Date(point.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={formatted} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} allowDecimals={false} width={38} />
        <Tooltip content={<TooltipBox />} cursor={{ stroke: GRID_COLOR, strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="leads"
          name="Leads discovered"
          stroke="hsl(var(--chart-1))"
          strokeWidth={2}
          fill="hsl(var(--chart-1))"
          fillOpacity={0.12}
          {...NO_ANIMATION}
        />
        <Area
          type="monotone"
          dataKey="emails"
          name="With email"
          stroke="hsl(var(--chart-2))"
          strokeWidth={2}
          fill="hsl(var(--chart-2))"
          fillOpacity={0.1}
          {...NO_ANIMATION}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Single-measure magnitude chart; one hue, no per-bar colour cycling. */
export function DistributionChart({
  data,
  color = 'hsl(var(--chart-1))',
  height = 200,
}: {
  data: DistributionPoint[];
  color?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={false} interval={0} />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} allowDecimals={false} width={38} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: 'hsl(var(--secondary))' }} />
        <Bar dataKey="value" name="Leads" fill={color} radius={[4, 4, 0, 0]} maxBarSize={44} {...NO_ANIMATION} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Ranked categories — horizontal so long labels stay readable. */
export function RankingChart({ data, height = 220 }: { data: DistributionPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="2 4" horizontal={false} />
        <XAxis type="number" tick={AXIS_STYLE} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          width={116}
          interval={0}
        />
        <Tooltip content={<TooltipBox />} cursor={{ fill: 'hsl(var(--secondary))' }} />
        <Bar dataKey="value" name="Leads" radius={[0, 4, 4, 0]} maxBarSize={18} {...NO_ANIMATION}>
          {data.map((entry) => (
            <Cell key={entry.label} fill="hsl(var(--chart-1))" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Rating distribution for a single lead (1★–5★). */
export function RatingBreakdownChart({ data }: { data: Array<{ star: string; count: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={168}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="star" tick={AXIS_STYLE} tickLine={false} axisLine={false} width={34} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: 'hsl(var(--secondary))' }} />
        <Bar dataKey="count" name="Reviews" radius={[0, 4, 4, 0]} maxBarSize={16} {...NO_ANIMATION}>
          {data.map((entry) => (
            <Cell
              key={entry.star}
              fill={
                entry.star === '1★' || entry.star === '2★'
                  ? 'hsl(var(--destructive))'
                  : entry.star === '3★'
                    ? 'hsl(var(--chart-3))'
                    : 'hsl(var(--chart-2))'
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
