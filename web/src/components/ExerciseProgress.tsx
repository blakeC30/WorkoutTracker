'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { ExerciseSession } from '@/lib/backend';
import { Section, Figure, Delta, Sparkline, Empty } from '@/components/ui';
import { n, n0 } from '@/lib/num';
import { agoLabel, dayLabel, dec, int, shortDay } from '@/lib/format';
import { useScrubGesture } from '@/lib/useScrubGesture';

/**
 * The headline series for one exercise, readable session by session.
 *
 * A Client Component because it scrubs — the same drag the bodyweight and nutrition charts
 * take. It reads `n`/`n0` from lib/num rather than from lib/backend: the two re-export the
 * same functions, but backend.ts opens with `import 'server-only'` and reaching it from here
 * would fail the build. The types come from backend and are erased.
 *
 * WHICH series depends on what the exercise records, and the three cases are genuinely
 * different measurements rather than three styles of the same one:
 *
 *   loaded     estimated 1RM, which moves when reps go up at a fixed load — most of how
 *              progress actually shows up
 *   endurance  distance, or duration when nothing was measured in miles
 *   repped     the best single set, for bodyweight work that has no e1RM at all
 *
 * They differ only in what to plot and how to print it, so each one produces a `Series` and
 * the scrub is wired once below. Written as three returns, the scrub was three copies of the
 * same six lines waiting to drift apart.
 */
type Series = {
  label: string;
  aside: string;
  points: number[];
  dates: string[];
  unit: string;
  /** How the headline prints one point. */
  format: (value: number) => string;
  /** Decimals for the count-up, which has to agree with `format` or the value jumps on land. */
  decimals?: number;
  height: number;
  delta: { value: number | null; unit: string; over: string } | null;
  footerLeft: ReactNode;
  footerRight: ReactNode;
};

function seriesFor(sessions: ExerciseSession[]): Series | null {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

  const loaded = sessions.filter((s) => n(s.e1rm) !== null);
  const endurance = sessions.filter((s) => n(s.distance_mi) !== null || n(s.duration_min) !== null);

  // Bodyweight work: reps at no load. Such a session has no e1RM, no distance and no duration,
  // so without this branch both others come up empty and a push-up's page renders as a shell.
  const repped = sessions
    .map((s) => ({
      date: s.date,
      best: Math.max(...s.set_detail.filter((d) => n0(d.weight_lbs) === 0).map((d) => d.reps ?? 0), 0),
      total: s.total_reps,
    }))
    .filter((s) => s.best > 0);

  if (loaded.length === 0 && endurance.length === 0 && repped.length > 0) {
    const points = repped.map((s) => s.best);
    const latest = repped[repped.length - 1];
    return {
      label: 'Best set',
      aside: plural(sessions.length, 'session'),
      points,
      dates: repped.map((s) => s.date),
      unit: 'REPS',
      format: (v) => String(Math.round(v)),
      height: 58,
      delta:
        points.length > 1
          ? { value: latest.best - points[0], unit: 'reps', over: plural(points.length, 'session') }
          : null,
      footerLeft: <>Best {Math.max(...points)} in a set</>,
      footerRight: <>{int(latest.total)} reps last session</>,
    };
  }

  // Nothing measurable at all — reachable when a session recorded only notes.
  if (loaded.length === 0 && endurance.length === 0) return null;

  if (loaded.length === 0) {
    // Cardio and timed work have no estimated max; distance is the series that means something.
    const points = endurance.map((s) => n0(s.distance_mi) || n0(s.duration_min));
    const latest = endurance[endurance.length - 1];
    // Distance when it is recorded, minutes otherwise — and the heading names whichever it is.
    const isDistance = n(latest?.distance_mi) !== null;
    return {
      label: isDistance ? 'Distance' : 'Duration',
      aside: plural(sessions.length, 'session'),
      points,
      dates: endurance.map((s) => s.date),
      unit: isDistance ? 'MI' : 'MIN',
      format: (v) => dec(v, 2),
      decimals: 2,
      height: 54,
      delta: null,
      footerLeft: <>Best {dec(Math.max(...points, 0), 2)}</>,
      footerRight: <>last {agoLabel(latest.date).toLowerCase()}</>,
    };
  }

  const points = loaded.map((s) => n0(s.e1rm));
  const current = points[points.length - 1];
  const best = Math.max(...points);

  return {
    label: 'Estimated 1RM',
    aside: plural(sessions.length, 'session'),
    points,
    dates: loaded.map((s) => s.date),
    unit: 'LB',
    format: (v) => int(v),
    height: 58,
    // Change since the FIRST session on record, not the previous one. Session-to-session noise
    // on an estimate is a couple of pounds and says nothing; the span is the thing worth
    // reading. It stays anchored there while scrubbing, for the same reason.
    delta:
      points.length > 1
        ? { value: current - points[0], unit: 'lb', over: plural(loaded.length, 'session') }
        : null,
    footerLeft: (
      <>
        Best {int(best)}
        {best > current ? <span style={{ color: 'var(--ink-faint)' }}> · {int(best - current)} off</span> : null}
      </>
    ),
    footerRight: (
      <>
        {shortDay(loaded[0].date)} – {shortDay(loaded[loaded.length - 1].date)}
      </>
    ),
  };
}

export function ExerciseProgress({ sessions, tone }: { sessions: ExerciseSession[]; tone: string }) {
  const [active, setActive] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const series = seriesFor(sessions);

  const count = series?.points.length ?? 0;
  const scrub = useCallback(
    (clientX: number) => {
      const box = plot.current?.getBoundingClientRect();
      if (!box || count === 0) return;
      const ratio = (clientX - box.left) / (box.width || 1);
      setActive(Math.min(Math.max(Math.round(ratio * (count - 1)), 0), count - 1));
    },
    [count],
  );

  // Returns to the latest session on release, as the bodyweight chart does. The resting state
  // of this screen is "where is this lift now", and leaving a session from March as the
  // headline invites reading it as current. No tap-to-select for the same reason: the
  // selection would be discarded on the same lift.
  const gesture = useScrubGesture({ ref: plot, onScrub: scrub, onRelease: () => setActive(null) });

  if (!series) {
    return (
      <Section label="Sessions" aside={`${sessions.length}`}>
        <Empty>Recorded, but with no weight, reps, distance or time to chart.</Empty>
      </Section>
    );
  }

  const scrubbing = active !== null;
  const index = active === null ? series.points.length - 1 : active;
  const shown = series.points[index];

  return (
    <Section label={series.label} aside={scrubbing ? dayLabel(series.dates[index]) : series.aside}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        {/* No count-up while scrubbing: the number is changing under your finger, and animating
            each step would lag behind the thing you are pointing at. */}
        <Figure
          value={series.format(shown)}
          unit={series.unit}
          size="var(--t-3xl)"
          count={scrubbing ? undefined : series.points[series.points.length - 1]}
          decimals={series.decimals}
          tone={tone}
        />
        {/* The delta describes the whole span, so it would be answering a different question
            from everything beside it once a single session is selected. */}
        {scrubbing || !series.delta ? null : (
          <Delta value={series.delta.value} unit={series.delta.unit} over={series.delta.over} />
        )}
      </div>

      <div
        ref={plot}
        // pan-y so a vertical flick scrolls the page immediately; useScrubGesture decides which
        // gesture this is and locks the page only once it is a scrub.
        style={{ marginTop: 16, touchAction: 'pan-y', cursor: 'crosshair' }}
        {...gesture}
      >
        <Sparkline points={series.points} height={series.height} tone={tone} activeIndex={active} />
      </div>

      <div className="cap" style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
        <span>{series.footerLeft}</span>
        <span style={{ color: 'var(--ink-faint)' }}>
          {scrubbing ? 'Release to return' : series.footerRight}
        </span>
      </div>
    </Section>
  );
}
