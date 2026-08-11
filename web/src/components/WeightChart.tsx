'use client';

import { useCallback, useRef, useState } from 'react';
import type { BodyweightRow } from '@/lib/backend';
import { Section, Figure, Delta, Sparkline, Empty } from '@/components/ui';
import { n } from '@/lib/num';
import { agoLabel, dayLabel, dec, parseDay } from '@/lib/format';

/**
 * Bodyweight, readable day by day.
 *
 * Put a finger anywhere on the line and the headline becomes that day's weigh-in. Same scrub
 * the nutrition chart uses: the whole plot is one drag surface and the nearest day wins, because
 * ninety points across 350px is about 4px each — far under what a fingertip can hit.
 *
 * The line plots the 7-day ROLLING AVERAGE, but the readout reports the RAW weigh-in for that
 * day. Those are different numbers on purpose: the smoothed line is what you read for a trend,
 * and daily noise of a pound either way would bury a trend this shallow — but "what did I
 * actually weigh on 12 July" wants the number that was on the scale. Both are labelled.
 */
type Point = { date: string; weight: number | null; avg: number };

export function WeightChart({ rows }: { rows: BodyweightRow[] }) {
  // Rows without a rolling average cannot be plotted, and dropping them separately from the
  // dates would desynchronise the index the scrub resolves to. One filtered array, one index.
  const series: Point[] = rows
    .map((row) => ({ date: row.date, weight: n(row.weight_lbs), avg: n(row.rolling_7d) }))
    .filter((point): point is Point => point.avg !== null);

  const [active, setActive] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);

  const scrub = useCallback(
    (clientX: number) => {
      const box = plot.current?.getBoundingClientRect();
      if (!box || series.length === 0) return;
      const ratio = (clientX - box.left) / (box.width || 1);
      setActive(Math.min(Math.max(Math.round(ratio * (series.length - 1)), 0), series.length - 1));
    },
    [series.length],
  );

  if (series.length === 0) {
    return (
      <Section label="Bodyweight">
        <Empty>No weigh-ins in the last 90 days. Tell Claude your weight and it lands here.</Empty>
      </Section>
    );
  }

  const latest = series[series.length - 1];
  const shown = active === null ? latest : series[active];

  // Against the smoothed line 30 days back, not the raw reading — one heavy dinner four weeks
  // ago should not be the baseline a month of progress is measured from.
  const monthAgo = series.find((p) => daysBetween(p.date, latest.date) <= 30) ?? series[0];
  const change = latest.avg - monthAgo.avg;

  const scrubbing = active !== null;

  return (
    <Section
      label="Bodyweight"
      aside={scrubbing ? dayLabel(shown.date) : agoLabel(latest.date)}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        {/* No count-up while scrubbing: the number is changing under your finger, and animating
            each step would lag behind the thing you are pointing at. */}
        <Figure
          value={dec(shown.weight ?? shown.avg)}
          unit="LB"
          size="var(--t-3xl)"
          count={scrubbing ? undefined : latest.weight}
          decimals={1}
        />
        {scrubbing ? null : <Delta value={change} unit="lb" over="30d" />}
      </div>

      <div
        ref={plot}
        // pan-y so a vertical flick still scrolls the page; only horizontal drags are captured.
        style={{ marginTop: 16, touchAction: 'pan-y', cursor: 'crosshair' }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          scrub(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) scrub(event.clientX);
        }}
        // Lifting off returns to the latest reading. Bodyweight's resting state is "what do I
        // weigh now", and leaving a month-old number as the headline invites misreading it.
        onPointerUp={() => setActive(null)}
        onPointerCancel={() => setActive(null)}
      >
        <Sparkline points={series.map((p) => p.avg)} height={54} activeIndex={active} />
      </div>

      <div className="cap" style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
        <span>7-day avg {dec(shown.avg)}</span>
        <span style={{ color: 'var(--ink-faint)' }}>
          {scrubbing ? 'Release to return' : `${series.length} weigh-ins / 90d`}
        </span>
      </div>
    </Section>
  );
}

function daysBetween(a: string, b: string): number {
  return Math.abs(parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000;
}
