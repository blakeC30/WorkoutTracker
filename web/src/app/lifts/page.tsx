import { getPrs, n, type PrRow } from '@/lib/backend';
import { Masthead, Section, Rule, Empty, Fault } from '@/components/ui';
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
  const endurance = result.rows.filter((r) => r.record_type === 'endurance');

  // The scale for the e1RM bars. Squats dwarf curls, so this is a rough sense of where the
  // heavy work sits, not a claim that the exercises are comparable.
  const maxE1rm = Math.max(...weighted.map((r) => n(r.best_e1rm_lbs) ?? 0), 1);

  return (
    <>
      {weighted.length > 0 ? (
        <Section label="Loaded" aside={`${weighted.length}`}>
          {weighted.map((row) => (
            <Weighted key={row.exercise} row={row} max={maxE1rm} />
          ))}
        </Section>
      ) : null}

      {weighted.length > 0 && endurance.length > 0 ? <Rule /> : null}

      {endurance.length > 0 ? (
        <Section label="Cardio & timed" aside={`${endurance.length}`}>
          {endurance.map((row) => (
            <Endurance key={row.exercise} row={row} />
          ))}
        </Section>
      ) : null}

      <p style={{ marginTop: 22, color: 'var(--ink-faint)', fontSize: 'var(--t-sm)', lineHeight: 1.5 }}>
        Estimated max is Epley — weight × (1 + reps ÷ 30). It is an estimate from your best set,
        not a single you have actually pulled.
      </p>
    </>
  );
}

function Weighted({ row, max }: { row: PrRow; max: number }) {
  const e1rm = n(row.best_e1rm_lbs);
  const heaviest = n(row.heaviest_lbs);
  const stale = daysAgo(row.last_performed) > 28;
  const pct = e1rm !== null ? (e1rm / max) * 100 : 0;

  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--rule)', opacity: stale ? 0.55 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="selectable" style={{ fontSize: 'var(--t-base)', lineHeight: 1.2 }}>
          {row.exercise}
        </span>
        <span className="mono" style={{ fontSize: 'var(--t-xl)', fontWeight: 500, lineHeight: 1 }}>
          {int(e1rm)}
          <span style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-dim)', marginLeft: 4 }}>E1RM</span>
        </span>
      </div>

      <div style={{ height: 3, background: 'var(--rule)', margin: '9px 0 8px' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--signal)' }} />
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
  const distance = n(row.best_distance_mi);
  const duration = n(row.best_duration_min);
  const pace = n(row.best_pace_min_per_mi);
  const stale = daysAgo(row.last_performed) > 28;

  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--rule)', opacity: stale ? 0.55 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="selectable" style={{ fontSize: 'var(--t-base)', lineHeight: 1.2 }}>
          {row.exercise}
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

      <div
        className="mono"
        style={{ display: 'flex', gap: 12, marginTop: 7, fontSize: 'var(--t-cap)', color: 'var(--ink-faint)' }}
      >
        {pace !== null ? <span style={{ color: 'var(--ink-dim)' }}>{clock(pace)} /mi best</span> : null}
        {distance !== null && duration !== null ? <span>{dec(duration, 0)} min longest</span> : null}
        <span style={{ marginLeft: 'auto' }}>
          {row.total_sets} sessions · last {agoLabel(row.last_performed).toLowerCase()}
        </span>
      </div>
    </div>
  );
}
