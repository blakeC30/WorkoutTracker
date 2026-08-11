import Link from 'next/link';
import type { CSSProperties } from 'react';
import { getExercise, n, n0, type ExerciseHistory, type ExerciseSession } from '@/lib/backend';
import { Masthead, Section, Rule, Figure, Delta, Sparkline, Empty, Fault } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { patternColor, patternLabel } from '@/lib/patterns';
import { agoLabel, clock, dec, int, shortDay } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * One exercise over its whole history.
 *
 * The screen the app was missing: everywhere else reports a current best, which cannot tell a
 * lift that added 40lb last month from one that has been stalled since June. Estimated 1RM is
 * the headline series because it moves when reps go up at a fixed load, which is most of how
 * progress actually shows up.
 */
export default async function ExercisePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const result = await getExercise(decodeURIComponent(name));

  if (!result.ok) {
    return (
      <main className="screen">
        <Masthead left="Exercise" />
        <BackLink />
        <Fault error={result.error} />
      </main>
    );
  }

  // A name with no catalog entry comes back null rather than as an error — the endpoint worked,
  // the exercise simply isn't there.
  if (!result.row) {
    return (
      <main className="screen">
        <Masthead left="Not found" />
        <BackLink />
        <Empty>No exercise by that name. It may have been renamed since this link was made.</Empty>
      </main>
    );
  }

  const { exercise, sessions } = result.row;
  const tone = patternColor(exercise.pattern);

  return (
    <main className="screen">
      <Masthead left={exercise.name} right={patternLabel(exercise.pattern)} />
      <BackLink />

      {sessions.length === 0 ? (
        <Empty>Catalogued, but never performed. It will appear here after the first session.</Empty>
      ) : (
        <>
          <Reveal>
            <Progress sessions={sessions} tone={tone} />
          </Reveal>
          <Rule />
          <Reveal delay={80}>
            <Meta exercise={exercise} tone={tone} />
          </Reveal>
          <Rule />
          <Reveal delay={140}>
            <Sessions sessions={sessions} tone={tone} />
          </Reveal>
        </>
      )}
    </main>
  );
}

function BackLink() {
  return (
    <Link
      href="/exercises"
      className="cap pressable"
      style={{
        color: 'var(--signal)',
        minHeight: 44,
        display: 'flex',
        alignItems: 'center',
        marginBottom: 8,
        borderBottom: '1px solid var(--rule)',
      }}
    >
      ‹ All exercises
    </Link>
  );
}

function Progress({ sessions, tone }: { sessions: ExerciseSession[]; tone: string }) {
  const loaded = sessions.filter((s) => n(s.e1rm) !== null);
  const endurance = sessions.filter((s) => n(s.distance_mi) !== null || n(s.duration_min) !== null);

  // Bodyweight work: reps at no load. This branch did not exist, and because such a session has
  // no e1RM, no distance and no duration, BOTH other branches came up empty — `endurance[last]`
  // was undefined and reading its date threw, so a push-up's detail page rendered as a blank
  // shell. The record is the best single set, mirroring how the loaded branch reports e1RM.
  const repped = sessions
    .map((s) => ({
      date: s.date,
      best: Math.max(...s.set_detail.filter((d) => n0(d.weight_lbs) === 0).map((d) => d.reps ?? 0), 0),
      total: s.total_reps,
    }))
    .filter((s) => s.best > 0);

  if (loaded.length === 0 && endurance.length === 0 && repped.length > 0) {
    const series = repped.map((s) => s.best);
    const latest = repped[repped.length - 1];
    const best = Math.max(...series);

    return (
      <Section label="Best set" aside={`${sessions.length} session${sessions.length === 1 ? '' : 's'}`}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <Figure value={String(latest.best)} unit="REPS" size="var(--t-3xl)" count={latest.best} tone={tone} />
          <Delta
            value={series.length > 1 ? latest.best - series[0] : null}
            unit="reps"
            over={`${series.length} session${series.length === 1 ? '' : 's'}`}
          />
        </div>
        <div style={{ marginTop: 16 }}>
          <Sparkline points={series} height={58} tone={tone} />
        </div>
        <div className="cap" style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
          <span>Best {best} in a set</span>
          <span style={{ color: 'var(--ink-faint)' }}>{int(latest.total)} reps last session</span>
        </div>
      </Section>
    );
  }

  // Nothing measurable at all. Reachable if a session recorded only notes, and it must render
  // something rather than fall through to code that assumes a series exists.
  if (loaded.length === 0 && endurance.length === 0) {
    return (
      <Section label="Sessions" aside={`${sessions.length}`}>
        <Empty>Recorded, but with no weight, reps, distance or time to chart.</Empty>
      </Section>
    );
  }

  if (loaded.length === 0) {
    // Cardio and timed work have no estimated max; distance is the series that means something.
    const series = endurance.map((s) => n0(s.distance_mi) || n0(s.duration_min));
    const latest = endurance[endurance.length - 1];
    const best = Math.max(...series, 0);
    // Distance when it is recorded, minutes otherwise — and the heading names whichever it is.
    // It previously read "Best effort" above the LATEST session, so a 7.90 mile ride sat under a
    // heading claiming it was the best while the footer said 11.80 two lines below.
    const isDistance = n(latest?.distance_mi) !== null;
    const current = isDistance ? n(latest?.distance_mi) : n(latest?.duration_min);

    return (
      <Section label={isDistance ? 'Distance' : 'Duration'} aside={`${sessions.length} session${sessions.length === 1 ? '' : 's'}`}>
        <Figure
          value={dec(current, 2)}
          unit={isDistance ? 'MI' : 'MIN'}
          size="var(--t-3xl)"
          count={current}
          decimals={2}
          tone={tone}
        />
        <div style={{ marginTop: 16 }}>
          <Sparkline points={series} height={54} tone={tone} />
        </div>
        <div className="cap" style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
          <span>Best {dec(best, 2)}</span>
          <span style={{ color: 'var(--ink-faint)' }}>last {agoLabel(latest.date).toLowerCase()}</span>
        </div>
      </Section>
    );
  }

  const series = loaded.map((s) => n0(s.e1rm));
  const current = series[series.length - 1];
  const best = Math.max(...series);
  const first = series[0];

  // Change since the first session on record, not since the previous one. Session-to-session
  // noise on an estimate is a couple of pounds either way and says nothing; the span is the
  // thing worth reading.
  const change = series.length > 1 ? current - first : null;

  return (
    <Section label="Estimated 1RM" aside={`${sessions.length} session${sessions.length === 1 ? '' : 's'}`}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <Figure value={int(current)} unit="LB" size="var(--t-3xl)" count={current} tone={tone} />
        <Delta value={change} unit="lb" over={`${loaded.length} session${loaded.length === 1 ? '' : 's'}`} />
      </div>

      <div style={{ marginTop: 16 }}>
        <Sparkline points={series} height={58} tone={tone} />
      </div>

      <div className="cap" style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
        <span>
          Best {int(best)}
          {best > current ? <span style={{ color: 'var(--ink-faint)' }}> · {int(best - current)} off</span> : null}
        </span>
        <span style={{ color: 'var(--ink-faint)' }}>
          {shortDay(loaded[0].date)} – {shortDay(loaded[loaded.length - 1].date)}
        </span>
      </div>
    </Section>
  );
}

function Meta({
  exercise,
  tone,
}: {
  exercise: ExerciseHistory['exercise'];
  tone: string;
}) {
  const primary = exercise.muscles.filter((m) => m.role === 'primary');
  const secondary = exercise.muscles.filter((m) => m.role === 'secondary');

  return (
    <Section label="Movement">
      <div className="cap" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', color: 'var(--ink-dim)' }}>
        <span style={{ color: tone, borderBottom: `2px solid ${tone}`, paddingBottom: 3 }}>
          {patternLabel(exercise.pattern)}
        </span>
        {/* Category is suppressed when it just repeats the pattern. A cardio exercise is
            category "cardio" AND pattern "cardio", which rendered as "Cardio cardio bike". */}
        {exercise.category && exercise.category !== exercise.pattern ? (
          <span>{exercise.category}</span>
        ) : null}
        {exercise.equipment ? <span>{exercise.equipment}</span> : null}
      </div>
      {primary.length > 0 ? (
        <p style={{ margin: '12px 0 0', fontSize: 'var(--t-sm)', color: 'var(--ink-dim)', lineHeight: 1.5 }}>
          <span style={{ color: 'var(--ink)' }}>{primary.map((m) => m.name).join(', ')}</span>
          {secondary.length > 0 ? <> · also {secondary.map((m) => m.name).join(', ')}</> : null}
        </p>
      ) : null}
    </Section>
  );
}

function Sessions({ sessions, tone }: { sessions: ExerciseSession[]; tone: string }) {
  // Newest first for reading, though the chart above needed the opposite order.
  const recent = sessions.slice().reverse();
  const maxVolume = Math.max(...sessions.map((s) => n0(s.volume_lbs)), 1);

  return (
    <Section label="Every session" aside={`${sessions.length}`}>
      {recent.map((session, i) => (
        <SessionRow key={session.date} session={session} max={maxVolume} tone={tone} index={i} />
      ))}
    </Section>
  );
}

function SessionRow({
  session,
  max,
  tone,
  index,
}: {
  session: ExerciseSession;
  max: number;
  tone: string;
  index: number;
}) {
  const volume = n0(session.volume_lbs);
  const e1rm = n(session.e1rm);
  const distance = n(session.distance_mi);
  const duration = n(session.duration_min);

  return (
    <Link href={`/calendar/${session.date}`} className="pressable" style={{ display: 'block' }}>
      <div style={{ padding: '11px 0', borderTop: '1px solid var(--rule)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <span className="mono" style={{ fontSize: 'var(--t-sm)' }}>
            {shortDay(session.date)}
            <span style={{ color: 'var(--ink-faint)' }}> · {agoLabel(session.date).toLowerCase()}</span>
          </span>
          <span className="mono" style={{ fontSize: 'var(--t-sm)', color: 'var(--ink)' }}>
            {/* Reps last, but they must be here: a push-up session has no e1RM, no distance and
                no duration, and without this arm every row read "— min". */}
            {e1rm !== null
              ? `${int(e1rm)} e1RM`
              : distance !== null
                ? `${dec(distance, 2)} mi`
                : duration !== null
                  ? `${dec(duration, 0)} min`
                  : `${int(session.total_reps)} reps`}
          </span>
        </div>

        {volume > 0 ? (
          <div style={{ height: 2, background: 'var(--rule)', margin: '7px 0 6px' }}>
            <div
              className="draw-x"
              style={
                { width: `${(volume / max) * 100}%`, height: '100%', background: tone, '--delay': `${index * 35}ms` } as CSSProperties
              }
            />
          </div>
        ) : (
          <div style={{ height: 7 }} />
        )}

        {/* The sets, inline. This is what makes the row worth tapping on — you can see the
            shape of the session (straight sets, a ramp, a back-off) without leaving the page. */}
        <div
          className="mono"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 'var(--t-cap)', color: 'var(--ink-faint)' }}
        >
          {/* A single cardio set IS the session, so listing it repeats the headline verbatim —
              "7.90 mi" above and "7.90mi" directly beneath. Only break out the sets when there
              is more than one and the breakdown says something the total doesn't. */}
          {(session.set_detail.length > 1 ? session.set_detail : []).map((set) => (
            <span key={set.set_number}>
              {n(set.weight_lbs) !== null && set.reps !== null
                ? `${dec(n(set.weight_lbs), 0)}×${set.reps}`
                : n(set.distance_mi) !== null
                  ? `${dec(n(set.distance_mi), 2)}mi`
                  : n(set.duration_min) !== null
                    ? `${dec(n(set.duration_min), 0)}min`
                    : `×${set.reps ?? '—'}`}
            </span>
          ))}
          {duration !== null && distance !== null && distance > 0 ? (
            <span style={{ marginLeft: 'auto' }}>{clock(duration / distance)}/mi</span>
          ) : null}
          {volume > 0 ? <span style={{ marginLeft: 'auto' }}>{int(volume)} lb</span> : null}
        </div>
      </div>
    </Link>
  );
}
