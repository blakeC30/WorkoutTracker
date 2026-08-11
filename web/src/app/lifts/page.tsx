import Link from 'next/link';
import type { CSSProperties } from 'react';
import { getPrs, n, type PrRow } from '@/lib/backend';
import { Masthead, Section, Rule, Empty, Fault } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { patternColor, patternLabel } from '@/lib/patterns';
import { agoLabel, clock, daysAgo, dec, int, shortDay } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Every exercise with its best set, ordered by how recently it was trained.
 *
 * Recency, not size of record: the useful question standing in a gym is "what did I do last
 * time", and an all-time list sorted by weight buries the thing you are about to repeat under
 * a deadlift you last did in March.
 */
export default async function Lifts() {
  const result = await getPrs(60);

  return (
    <main className="screen">
      <Masthead left="Lifts" right="Best set" />
      <Body result={result} />
    </main>
  );
}

function Body({ result }: { result: Awaited<ReturnType<typeof getPrs>> }) {
  if (!result.ok) return <Fault error={result.error} />;
  if (result.rows.length === 0) {
    return <Empty>No sets recorded yet. Log a session and every exercise in it appears here.</Empty>;
  }

  // Split rather than mixed: a pace and a one-rep max are not comparable, and interleaving them
  // makes both columns meaningless.
  const weighted = result.rows.filter((r) => r.record_type === 'weighted');
  const bodyweight = result.rows.filter((r) => r.record_type === 'bodyweight');
  const endurance = result.rows.filter((r) => r.record_type === 'endurance');

  // The scale for the e1RM bars. Squats dwarf curls, so this is a rough sense of where the
  // heavy work sits, not a claim that the exercises are comparable.
  const maxE1rm = Math.max(...weighted.map((r) => n(r.best_e1rm_lbs) ?? 0), 1);
  const maxReps = Math.max(...bodyweight.map((r) => r.best_reps ?? 0), 1);

  return (
    <>
      {weighted.length > 0 ? (
        <Reveal>
          <Section label="Loaded" aside={`${weighted.length}`}>
            {weighted.map((row, i) => (
              <Weighted key={row.exercise} row={row} max={maxE1rm} index={i} />
            ))}
          </Section>
        </Reveal>
      ) : null}

      {weighted.length > 0 && bodyweight.length > 0 ? <Rule /> : null}

      {/* Push-ups, sit-ups, pull-ups. Their own section because their record is reps at no
          load, which is neither a tonnage PR nor a distance — before this they fell through to
          "Cardio & timed" and rendered as an em-dash. */}
      {bodyweight.length > 0 ? (
        <Reveal>
          <Section label="Bodyweight" aside={`${bodyweight.length}`}>
            {bodyweight.map((row, i) => (
              <Calisthenic key={row.exercise} row={row} max={maxReps} index={i} />
            ))}
          </Section>
        </Reveal>
      ) : null}

      {(weighted.length > 0 || bodyweight.length > 0) && endurance.length > 0 ? <Rule /> : null}

      {endurance.length > 0 ? (
        <Reveal>
          <Section label="Cardio & timed" aside={`${endurance.length}`}>
            {endurance.map((row) => (
              <Endurance key={row.exercise} row={row} />
            ))}
          </Section>
        </Reveal>
      ) : null}

      <p style={{ marginTop: 22, color: 'var(--ink-faint)', fontSize: 'var(--t-sm)', lineHeight: 1.5 }}>
        Tap any lift for its full history. Estimated max is Epley — weight × (1 + reps ÷ 30). It is an estimate from your best set,
        not a single you have actually pulled.
      </p>
    </>
  );
}

function Weighted({ row, max, index }: { row: PrRow; max: number; index: number }) {
  return (
    <Link href={`/lifts/${encodeURIComponent(row.exercise)}`} className="pressable" style={{ display: 'block' }}>
      <WeightedBody row={row} max={max} index={index} />
    </Link>
  );
}

function WeightedBody({ row, max, index }: { row: PrRow; max: number; index: number }) {
  const e1rm = n(row.best_e1rm_lbs);
  const heaviest = n(row.heaviest_lbs);
  const stale = daysAgo(row.last_performed) > 28;
  const pct = e1rm !== null ? (e1rm / max) * 100 : 0;

  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--rule)', opacity: stale ? 0.55 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="selectable" style={{ fontSize: 'var(--t-base)', lineHeight: 1.2 }}>
          {row.exercise}
          <span className="cap" style={{ color: patternColor(row.pattern), marginLeft: 8 }}>
            {patternLabel(row.pattern)}
          </span>
        </span>
        <span className="mono" style={{ fontSize: 'var(--t-xl)', fontWeight: 500, lineHeight: 1 }}>
          {int(e1rm)}
          <span style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-dim)', marginLeft: 4 }}>E1RM</span>
        </span>
      </div>

      {/* Tinted by the same palette the calendar uses, so scanning this list groups your
          pressing and pulling work without any sorting or headers. */}
      <div style={{ height: 3, background: 'var(--rule)', margin: '9px 0 8px' }}>
        <div
          className="draw-x"
          style={
            {
              width: `${pct}%`,
              height: '100%',
              background: patternColor(row.pattern),
              '--delay': `${index * 45}ms`,
            } as CSSProperties
          }
        />
      </div>

      {/* Two dates sit on this line and they mean different things — when the best set happened,
          and when the exercise was last touched. Grouped and separated so they can't be read as
          a range: the record on the left, recency on the right. */}
      <div
        className="mono"
        style={{ display: 'flex', gap: 12, fontSize: 'var(--t-cap)', color: 'var(--ink-faint)' }}
      >
        <span>
          <span style={{ color: 'var(--ink-dim)' }}>
            {dec(heaviest, 0)} × {row.heaviest_reps ?? '—'}
          </span>
          {row.heaviest_on ? ` best, ${shortDay(row.heaviest_on)}` : ''}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          {row.total_sets} sets · last {agoLabel(row.last_performed).toLowerCase()}
        </span>
      </div>
    </div>
  );
}

function Endurance({ row }: { row: PrRow }) {
  return (
    <Link href={`/lifts/${encodeURIComponent(row.exercise)}`} className="pressable" style={{ display: 'block' }}>
      <EnduranceBody row={row} />
    </Link>
  );
}

function EnduranceBody({ row }: { row: PrRow }) {
  const distance = n(row.best_distance_mi);
  const duration = n(row.best_duration_min);
  const pace = n(row.best_pace_min_per_mi);
  const stale = daysAgo(row.last_performed) > 28;

  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--rule)', opacity: stale ? 0.55 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="selectable" style={{ fontSize: 'var(--t-base)', lineHeight: 1.2 }}>
          {row.exercise}
          {/* Read from the row's own pattern rather than assumed from the section. "Cardio &
              timed" also holds planks, which are Core — so hard-coding green here would put a
              cardio label on an ab exercise. */}
          <span className="cap" style={{ color: patternColor(row.pattern), marginLeft: 8 }}>
            {patternLabel(row.pattern)}
          </span>
        </span>
        <span className="mono" style={{ fontSize: 'var(--t-lg)', fontWeight: 500, lineHeight: 1 }}>
          {distance !== null ? (
            <>
              {dec(distance, 2)}
              <span style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-dim)', marginLeft: 4 }}>MI</span>
            </>
          ) : (
            <>
              {dec(duration, 0)}
              <span style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-dim)', marginLeft: 4 }}>MIN</span>
            </>
          )}
        </span>
      </div>

      {/* Two groups, each unbreakable: the record on the left, recency on the right. The words
          "best" and "longest" on every item pushed this past 350px, and with nowrap items the
          overflow lands mid-phrase — "last 6d" on one line and "ago" on the next. Shorter labels
          plus wrapping by GROUP means it degrades to two clean lines instead. */}
      <div
        className="mono"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          marginTop: 7,
          fontSize: 'var(--t-cap)',
          color: 'var(--ink-faint)',
        }}
      >
        <span style={{ whiteSpace: 'nowrap' }}>
          {pace !== null ? <span style={{ color: 'var(--ink-dim)' }}>best {clock(pace)}/mi</span> : null}
          {distance !== null && duration !== null ? ` · ${dec(duration, 0)} min` : ''}
        </span>
        <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          {row.total_sets} sessions · {agoLabel(row.last_performed).toLowerCase()}
        </span>
      </div>
    </div>
  );
}

/**
 * A bodyweight exercise: push-ups, sit-ups, pull-ups.
 *
 * The headline is the best single SET, not the running total — adding a rep to your best set is
 * the calisthenic equivalent of adding weight to the bar, whereas total reps mostly measures how
 * long you spent. The total is still shown, in the meta line where volume sits on a loaded row.
 */
function Calisthenic({ row, max, index }: { row: PrRow; max: number; index: number }) {
  return (
    <Link href={`/lifts/${encodeURIComponent(row.exercise)}`} className="pressable" style={{ display: 'block' }}>
      <CalisthenicBody row={row} max={max} index={index} />
    </Link>
  );
}

function CalisthenicBody({ row, max, index }: { row: PrRow; max: number; index: number }) {
  const best = row.best_reps;
  const stale = daysAgo(row.last_performed) > 28;
  const pct = best !== null ? (best / max) * 100 : 0;

  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--rule)', opacity: stale ? 0.55 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="selectable" style={{ fontSize: 'var(--t-base)', lineHeight: 1.2 }}>
          {row.exercise}
          <span className="cap" style={{ color: patternColor(row.pattern), marginLeft: 8 }}>
            {patternLabel(row.pattern)}
          </span>
        </span>
        <span className="mono" style={{ fontSize: 'var(--t-xl)', fontWeight: 500, lineHeight: 1 }}>
          {best ?? '—'}
          <span style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-dim)', marginLeft: 4 }}>REPS</span>
        </span>
      </div>

      <div style={{ height: 3, background: 'var(--rule)', margin: '9px 0 8px' }}>
        <div
          className="draw-x"
          style={
            {
              width: `${pct}%`,
              height: '100%',
              background: patternColor(row.pattern),
              '--delay': `${index * 45}ms`,
            } as CSSProperties
          }
        />
      </div>

      {/* Same treatment as the endurance rows: two unbreakable groups, short labels. Spelling
          out "best set, 10 AUG" and "last yesterday" ran past 350px and wrapped mid-phrase. */}
      <div
        className="mono"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          fontSize: 'var(--t-cap)',
          color: 'var(--ink-faint)',
        }}
      >
        <span style={{ whiteSpace: 'nowrap', color: 'var(--ink-dim)' }}>
          best {row.best_reps_on ? shortDay(row.best_reps_on) : '—'}
        </span>
        <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          {row.total_bodyweight_reps !== null ? `${int(row.total_bodyweight_reps)} reps · ` : ''}
          {row.total_sets} sets · {agoLabel(row.last_performed).toLowerCase()}
        </span>
      </div>
    </div>
  );
}
