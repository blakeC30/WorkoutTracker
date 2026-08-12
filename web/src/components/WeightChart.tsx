'use client';

import { useCallback, useRef, useState } from 'react';
import type { BodyweightRow } from '@/lib/backend';
import { Section, Figure, Delta, Sparkline, Empty } from '@/components/ui';
import { n } from '@/lib/num';
import { useScrubGesture } from '@/lib/useScrubGesture';
import { agoLabel, dayLabel, dec, parseDay } from '@/lib/format';

/**
 * Bodyweight, readable day by day.
 *
 * Put a finger anywhere on the line and the headline becomes that day's weigh-in. Same scrub
 * the nutrition chart uses: the whole plot is one drag surface and the nearest day wins, because
 * ninety points across 350px is about 4px each — far under what a fingertip can hit.
 *
 * The line plots the WEIGH-INS — the numbers that were on the scale, nothing smoothed.
 *
 * It used to plot the 7-day rolling average, on the standard reasoning that daily noise buries
 * a shallow trend. That is true and it still cost more than it bought: an average moves against
 * the reading whenever a new weigh-in lands below the running mean, so the line fell on days
 * the scale went up. Explaining that every time is a worse outcome than a slightly noisier
 * line, on a chart whose entire job is answering "what do I weigh". The smoothed figure is
 * still reported, as the caption under the plot.
 */
type Point = { date: string; weight: number; avg: number; days: number };

/**
 * Minimum span of the y-axis, in pounds.
 *
 * Without a minimum the line scales to its own min and max, so ANY spread fills the full
 * height and a 1.4lb wobble is drawn as a cliff — the chart reporting a dramatic cut that did
 * not happen. With too generous a minimum the opposite: a real couple of pounds flattened into
 * a line that looks like nothing moved.
 *
 * Three pounds is about a day's honest noise from water and food. At that span the 1.4lb this
 * chart currently holds occupies a bit under half the panel — plainly readable as a fall,
 * plainly not a collapse. Six was the first attempt and buried it at a quarter.
 */
const MIN_SPAN_LB = 3;

/**
 * Headroom once the series is genuinely wider than the minimum.
 *
 * `Sparkline` maps the lowest point to the very bottom edge and the highest to the very top,
 * so on a wide series the extremes sit exactly on the boundary and the end marker — a round
 * cap with real radius — hangs half outside the plot. Asking for 25% more span than the data
 * needs keeps the line off both edges without changing what it says: everything is still
 * centred on the same midpoint, drawn to the same proportions, just inset.
 */
const HEADROOM = 1.25;

export function WeightChart({ rows }: { rows: BodyweightRow[] }) {
  // A row with no weigh-in has nothing to plot now that the line IS the weigh-ins. Dropping
  // those separately from the dates would desynchronise the index the scrub resolves to, so
  // there is one filtered array and one index into it.
  const series: Point[] = rows
    .map((row) => ({
      date: row.date,
      weight: n(row.weight_lbs),
      avg: n(row.rolling_7d),
      days: row.days_in_window,
    }))
    .filter((point): point is Point => point.weight !== null && point.avg !== null);

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

  // Lifting off returns to the latest reading. Bodyweight's resting state is "what do I weigh
  // now", and leaving a month-old number as the headline invites misreading it. No tap-to-
  // select for the same reason: the selection would be discarded on the same lift.
  const gesture = useScrubGesture({ onScrub: scrub, onRelease: () => setActive(null) });

  if (series.length === 0) {
    return (
      <Section label="Bodyweight">
        <Empty>No weigh-ins in the last 90 days. Tell Claude your weight and it lands here.</Empty>
      </Section>
    );
  }

  const latest = series[series.length - 1];
  const shown = active === null ? latest : series[active];

  // The oldest weigh-in still inside the 30-day window, or simply the oldest there is. Every
  // point carries a reading now, so the headline, the line and this comparison are all the
  // same quantity — there is no longer a way for them to disagree.
  const baseline = series.find((p) => daysBetween(p.date, latest.date) <= 30) ?? series[0];
  const change = latest.weight - baseline.weight;
  // Elapsed days between the two readings compared, not how many readings there were. "30d"
  // everywhere else in the app is a duration, and this has to read the same way.
  const over = `${Math.round(daysBetween(baseline.date, latest.date))}d`;

  const scrubbing = active !== null;

  /*
   * One expression covers both ends of the range problem, because `Sparkline` takes the larger
   * of the data's own spread and the floor it is given.
   *
   * Narrow series — the floor wins, and a pound and a half is drawn as a pound and a half
   * rather than as the full height of the panel. Wide series — the padded spread wins, so the
   * chart scales with the data exactly as before and merely stops short of the edges.
   */
  const line = series.map((p) => p.weight);
  const spread = Math.max(...line) - Math.min(...line);
  const span = Math.max(MIN_SPAN_LB, spread * HEADROOM);

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
        {/* Two readings is the minimum for a change to exist. One weigh-in showing "0.0 lb"
            would be reporting that nothing moved, which is a claim, not an absence. */}
        {scrubbing || series.length < 2 ? null : (
          <Delta value={change} unit="lb" over={over} decimals={1} />
        )}
      </div>

      <div
        ref={plot}
        // pan-y so a vertical flick scrolls the page immediately, rather than waiting to see
        // what the gesture turns out to be. Which gesture it is gets decided in useScrubGesture.
        style={{ marginTop: 16, touchAction: 'pan-y', cursor: 'crosshair' }}
        {...gesture}
      >
        <Sparkline points={line} height={54} activeIndex={active} floor={span} />
      </div>

      <div className="cap" style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
        {/* Says the window it actually averaged. `range between interval '6 days' preceding`
            gives a 7-day average only once seven days of weigh-ins exist; before that it is an
            average of however many there are, and calling a mean of three readings a "7-day
            avg" is the label doing the misleading rather than the number. */}
        <span>
          {shown.days >= 7 ? '7-day avg' : `${shown.days}-day avg`} {dec(shown.avg)}
        </span>
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
