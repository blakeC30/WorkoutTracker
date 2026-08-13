'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { PrRow } from '@/lib/backend';
import { Section, Rule, Sparkline, Empty } from '@/components/ui';
import { ListControls, matches, type FilterOption, type SortOption } from '@/components/ListControls';
import { patternColor, patternLabel } from '@/lib/patterns';
import { n } from '@/lib/num';
import { agoLabel, clock, daysAgo, dec, duration as duration_, int, parseDay, shortDay } from '@/lib/format';

/**
 * The exercise catalog, searchable.
 *
 * Search rather than sort chips here: the three sections already impose an order that means
 * something — loaded, bodyweight, cardio, each by recency — and a global sort would cut across
 * them. Filtering keeps the grouping and just narrows what's in it, hiding sections that empty
 * out so the headings never lie about their counts.
 */
const SORTS: SortOption<PrRow>[] = [
  {
    key: 'recent',
    label: 'Recent',
    compare: (a, b) => parseDay(b.last_performed).getTime() - parseDay(a.last_performed).getTime(),
  },
  { key: 'name', label: 'A–Z', compare: (a, b) => a.exercise.localeCompare(b.exercise) },
];

const SECTIONS = [
  { key: 'weighted', label: 'Loaded' },
  { key: 'bodyweight', label: 'Bodyweight' },
  { key: 'endurance', label: 'Cardio' },
  { key: 'other', label: 'Sport' },
] as const;

export function ExercisesList({ rows, capped }: { rows: PrRow[]; capped: boolean }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [section, setSection] = useState('all');

  const found = useMemo(() => {
    const active = SORTS.find((option) => option.key === sort) ?? SORTS[0];
    // Pattern is searchable too, so "pull" finds every pulling movement without needing to
    // remember which exercises those are.
    return rows
      .filter((row) => matches(`${row.exercise} ${row.pattern ?? ''}`, query))
      .sort(active.compare);
  }, [rows, query, sort]);

  // Counts come from the SEARCH result, not the whole catalog, so a chip never advertises rows
  // that the current query has already excluded.
  const filters: FilterOption[] = [
    { key: 'all', label: 'All', count: found.length },
    ...SECTIONS.map((s) => ({
      key: s.key,
      label: s.label,
      count: found.filter((r) => r.record_type === s.key).length,
    })).filter((f) => f.count > 0),
  ];

  // A chip for a section that has just emptied would otherwise stay selected and show nothing.
  const activeSection = filters.some((f) => f.key === section) ? section : 'all';
  const shown = activeSection === 'all' ? found : found.filter((r) => r.record_type === activeSection);

  const weighted = shown.filter((r) => r.record_type === 'weighted');
  const bodyweight = shown.filter((r) => r.record_type === 'bodyweight');
  const endurance = shown.filter((r) => r.record_type === 'endurance');
  const other = shown.filter((r) => r.record_type === 'other');

  return (
    <>
      <ListControls
        query={query}
        onQuery={setQuery}
        placeholder="Search"
        sorts={SORTS}
        activeSort={sort}
        onSort={setSort}
        showing={shown.length}
        total={rows.length}
        filters={filters}
        activeFilter={activeSection}
        onFilter={setSection}
      />

      {shown.length === 0 ? (
        <Empty>Nothing matches “{query.trim()}”. Movement patterns work too — try “pull”.</Empty>
      ) : null}

      {weighted.length > 0 ? (
        <Section label="Loaded" aside={`${weighted.length}`}>
          {weighted.map((row) => (
            <Weighted key={row.exercise} row={row} />
          ))}
        </Section>
      ) : null}

      {weighted.length > 0 && bodyweight.length > 0 ? <Rule /> : null}

      {/* Push-ups, sit-ups, pull-ups, planks — anything unloaded that isn't cardio. Grouped by
          kind rather than by unit, so a hold sits with the calisthenics it belongs to instead of
          beside the rowing machine just because both are measured in minutes. */}
      {bodyweight.length > 0 ? (
        <Section label="Bodyweight" aside={`${bodyweight.length}`}>
          {bodyweight.map((row) => (
            <Calisthenic key={row.exercise} row={row} />
          ))}
        </Section>
      ) : null}

      {(weighted.length > 0 || bodyweight.length > 0) && endurance.length > 0 ? <Rule /> : null}

      {endurance.length > 0 ? (
        <Section label="Cardio" aside={`${endurance.length}`}>
          {endurance.map((row) => (
            <Endurance key={row.exercise} row={row} />
          ))}
        </Section>
      ) : null}

      {(weighted.length > 0 || bodyweight.length > 0 || endurance.length > 0) && other.length > 0 ? (
        <Rule />
      ) : null}

      {/* Sports and anything else without a movement pattern. Its own section because a
          basketball game is neither a lift, a calisthenic nor conditioning — filed under
          Bodyweight it sat between push-ups and planks. */}
      {other.length > 0 ? (
        <Section label="Sport & other" aside={`${other.length}`}>
          {other.map((row) => (
            <Endurance key={row.exercise} row={row} />
          ))}
        </Section>
      ) : null}

      <p style={{ marginTop: 22, color: 'var(--ink-faint)', fontSize: 'var(--t-sm)', lineHeight: 1.5 }}>
        Tap any exercise for its full history. Estimated max is Epley — weight × (1 + reps ÷ 30).
        It is an estimate from your best set, not a single you have actually pulled.
        {capped ? ' Only your most recent exercises are listed — search to reach the rest.' : ''}
      </p>
    </>
  );
}

function Weighted({ row }: { row: PrRow }) {
  return (
    <Link href={`/exercises/${encodeURIComponent(row.exercise)}`} className="pressable" style={{ display: 'block' }}>
      <WeightedBody row={row} />
    </Link>
  );
}

function WeightedBody({ row }: { row: PrRow }) {
  const e1rm = n(row.best_e1rm_lbs);
  const heaviest = n(row.heaviest_lbs);
  const stale = daysAgo(row.last_performed) > 28;

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

      <Trend row={row} />

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
    <Link href={`/exercises/${encodeURIComponent(row.exercise)}`} className="pressable" style={{ display: 'block' }}>
      <EnduranceBody row={row} />
    </Link>
  );
}

function EnduranceBody({ row }: { row: PrRow }) {
  const distance = n(row.best_distance_mi);
  const duration = n(row.best_duration_sec);
  const pace = n(row.best_pace_sec_per_mi);
  const stale = daysAgo(row.last_performed) > 28;

  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--rule)', opacity: stale ? 0.55 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="selectable" style={{ fontSize: 'var(--t-base)', lineHeight: 1.2 }}>
          {row.exercise}
          {/* Still read from the row rather than hard-coded green. This section is cardio-only
              now, but the colour has one source of truth and that should not depend on which
              list a row happens to be in. */}
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
            /* Seconds now, so the headline prints mm:ss for anything past two minutes and a
               bare second count below it. "2400 MIN" would be the old unit's number under the
               new unit's data, which is the one way this migration could read as plausible and
               be wrong by a factor of sixty. */
            <>
              {duration === null ? '—' : duration < 120 ? Math.round(duration) : clock(duration)}
              <span style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-dim)', marginLeft: 4 }}>
                {duration !== null && duration < 120 ? 'SEC' : 'MIN:SEC'}
              </span>
            </>
          )}
        </span>
      </div>

      {/* Two groups, each unbreakable: the record on the left, recency on the right. The words
          "best" and "longest" on every item pushed this past 350px, and with nowrap items the
          overflow lands mid-phrase — "last 6d" on one line and "ago" on the next. Shorter labels
          plus wrapping by GROUP means it degrades to two clean lines instead. */}
      <Trend row={row} />

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
        <span style={{ whiteSpace: 'nowrap' }}>
          {pace !== null ? <span style={{ color: 'var(--ink-dim)' }}>best {clock(pace)}/mi</span> : null}
          {distance !== null && duration !== null ? ` · ${duration_(duration)}` : ''}
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
function Calisthenic(props: { row: PrRow }) {
  return (
    <Link
      href={`/exercises/${encodeURIComponent(props.row.exercise)}`}
      className="pressable"
      style={{ display: 'block' }}
    >
      <CalisthenicBody {...props} />
    </Link>
  );
}

function CalisthenicBody({ row }: { row: PrRow }) {
  const stale = daysAgo(row.last_performed) > 28;

  // Reps when the movement has them, hold time when it does not. A plank has no reps at all,
  // and printing "— REPS" over it was the whole reason it used to sit under Cardio.
  const reps = row.best_reps;
  const hold = n(row.best_duration_sec);
  const isReps = reps !== null;
  // A hold is seconds now, so it prints as seconds — "45" over "SEC" rather than "0.8" over
  // "MIN", which was the old column's way of saying three quarters of a minute. Past two
  // minutes it switches to mm:ss and drops the unit, since "2:30" needs no label.
  const value = isReps ? String(reps) : hold === null ? '—' : hold < 120 ? String(Math.round(hold)) : clock(hold);
  const unit = isReps ? 'REPS' : hold !== null && hold < 120 ? 'SEC' : 'MIN:SEC';


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
          {value}
          <span style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-dim)', marginLeft: 4 }}>{unit}</span>
        </span>
      </div>

      <Trend row={row} />

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
        {/* Only reps carry a best-set date — it comes from the CTE that requires reps, so a hold
            has none. A bare "best set" with nothing after it was worse than no label at all. */}
        {isReps && row.best_reps_on ? (
          <span style={{ whiteSpace: 'nowrap', color: 'var(--ink-dim)' }}>
            best {shortDay(row.best_reps_on)}
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          {row.total_bodyweight_reps !== null ? `${int(row.total_bodyweight_reps)} reps · ` : ''}
          {row.total_sets} sets · {agoLabel(row.last_performed).toLowerCase()}
        </span>
      </div>
    </div>
  );
}

/**
 * A row's own recent history, as a sparkline.
 *
 * This replaced a bar whose length was that exercise's record divided by the biggest record in
 * the list. That comparison is meaningless — a curl will never approach a leg press — so the
 * bar was telling you which exercises use big muscles, which you already knew. The sparkline
 * compares the exercise only to itself, which is the question actually being asked: is this
 * moving?
 *
 * Units differ from row to row (pounds, reps, miles, minutes) and that is fine precisely because
 * these series are never read against each other. The y-axis is unlabelled for the same reason:
 * the shape is the message, and a number would invite exactly the comparison being removed.
 */
function Trend({ row }: { row: PrRow }) {
  const points = row.trend ?? [];
  const tone = patternColor(row.pattern);

  // One session is a dot, not a line. A flat rule makes it clear there is nothing to trend yet
  // rather than implying a plateau.
  if (points.length < 2) {
    return (
      <div style={{ height: 22, margin: '8px 0 6px', display: 'flex', alignItems: 'center' }}>
        <div style={{ height: 1, width: 18, background: tone, opacity: 0.5 }} />
      </div>
    );
  }

  // The floor is 15% of the exercise's own top value, so a lift that moved 12lb does not draw
  // the same dramatic peaks as one that moved 200. Proportional rather than absolute, because
  // these series are in different units — pounds, reps, miles, minutes.
  const floor = Math.max(...points) * 0.15;

  return (
    <div style={{ margin: '10px 0 8px' }}>
      <Sparkline points={points} height={24} tone={tone} fill={false} floor={floor} />
    </div>
  );
}
