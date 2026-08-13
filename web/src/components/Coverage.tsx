'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { MuscleCoverageRow } from '@/lib/backend';
import { Section, Empty } from '@/components/ui';
import { forCoverage, groupByRegion } from '@/lib/muscles';

/**
 * The windows the toggle offers, and the default.
 *
 * Fourteen days by default because it is the shortest window that still describes a programme
 * rather than a week. Seven days makes any ordinary split look like neglect — train legs on a
 * Monday and by the following Sunday the row reads 0/6 while nothing is wrong — and twenty-eight
 * is long enough that a muscle dropped three weeks ago still shows as covered. Two weeks is
 * roughly two passes through a rotation, so a gap in it is a real gap.
 *
 * The same three numbers are named in `getMuscleCoverage` in the backend, which returns a count
 * pair for each. Duplicated across the two apps on purpose, as the README says of every shape
 * that crosses that boundary.
 */
const WINDOWS = [7, 14, 28] as const;
type Window = (typeof WINDOWS)[number];
const DEFAULT_WINDOW: Window = 14;

/** A row flattened to the window being read, so nothing downstream has to know which one. */
type Reading = { muscle: string; region: string; sessions: number; primary: number };

function read(row: MuscleCoverageRow, days: Window): Reading {
  const sessions = days === 7 ? row.sessions_7 : days === 14 ? row.sessions_14 : row.sessions_28;
  const primary = days === 7 ? row.primary_7 : days === 14 ? row.primary_14 : row.primary_28;
  return { muscle: row.muscle, region: row.region, sessions, primary };
}

/**
 * Which muscles are being trained, which are only passengers, and which are cold.
 *
 * This replaced a four-week volume-by-pattern chart, and the reason is worth keeping. That
 * section reported a magnitude with nothing to compare it against: no target exists in the
 * schema and it queried a single window, so its only available comparison was between patterns
 * — and tonnage between patterns mostly encodes which muscles are big. A leg press will always
 * dwarf a lateral raise. The app had already retired that same argument once, when the bars on
 * the exercises list became sparklines.
 *
 * Coverage answers something nothing else in the app can. Patterns say a pull happened; only
 * this says the lats and biceps got it while the traps and rear delts did not. And the
 * primary/secondary split says the thing a volume total actively hides: arms and shoulders can
 * carry eleven thousand pounds of work across four weeks without one movement ever being FOR
 * them, which by tonnage looks like plenty and by intent is nothing.
 *
 * A Client Component only because of the toggle. Every count for every window is already in the
 * props, so switching windows re-renders from data in hand and never fetches — which is the
 * whole reason the query returns all three at once.
 */
export function Coverage({ rows }: { rows: MuscleCoverageRow[] }) {
  const [days, setDays] = useState<Window>(DEFAULT_WINDOW);

  // Filtered before anything counts them, so the header total and the rows can never disagree
  // about what is in scope. Cardiovascular is the one this removes — see REGIONS_OUTSIDE_COVERAGE.
  const readings = forCoverage(rows).map((row) => read(row, days));

  if (readings.length === 0) {
    return (
      <Section label="Coverage">
        <Empty>No muscles catalogued yet. They arrive with your first exercise.</Empty>
      </Section>
    );
  }

  const regions = groupByRegion(readings);
  const worked = readings.filter((row) => row.sessions > 0);

  return (
    <Section label="Coverage" aside={`${worked.length}/${readings.length} muscles`}>
      {/* The window is the toggle, so it is no longer repeated in the aside — the lit chip says
          it, and says it in the one place you can also change it. Same treatment as the sort
          row on the exercises and food lists: a hairline under the live option rather than a
          filled pill, one weight lighter than the tab bar's marker. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
        {WINDOWS.map((option) => {
          const active = option === days;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setDays(option)}
              className="cap pressable"
              aria-pressed={active}
              style={{
                minHeight: 32,
                color: active ? 'var(--signal)' : 'var(--ink-faint)',
                borderBottom: `1px solid ${active ? 'var(--signal)' : 'transparent'}`,
                paddingBottom: 2,
              }}
            >
              {option}d
            </button>
          );
        })}
      </div>

      {/* No gap between rows now that each carries its own 40px tap height. Adding one on top
          of that would space them like paragraphs rather than like a list.

          Nothing follows the rows. Two lines used to: a key explaining what a filled mark meant,
          and a computed line naming the regions that were worked but never targeted. Both became
          answers to questions the rows had started answering themselves — opening a region names
          its three states in words, which is the key, and a region with no Trained line is the
          passenger reading stated where you are already looking. */}
      <div>
        {regions.map((region, i) => (
          <RegionRow key={region.key} region={region} index={i} />
        ))}
      </div>
    </Section>
  );
}

/**
 * One region: its name, a mark per muscle, how many were reached — and its muscles on tap.
 *
 * A mark per muscle rather than a bar, because the question is "how many of these six" and a
 * bar answering it would be a bar of a count — the marks ARE the count, and they carry which
 * ones as well as how many. The same reasoning as the calendar squares, and the same three
 * states: lit, half-lit, and a track that holds the position so a region with one muscle and a
 * region with six stay comparable down the column.
 *
 * The marks say how many and structurally cannot say WHICH, so the row itself opens. Tapping the
 * thing you are asking about and getting its answer directly underneath beats one list at the
 * foot of the section holding all twenty names, which is what this replaced.
 */
function RegionRow({
  region,
  index,
}: {
  region: { key: string; label: string; rows: Reading[] };
  index: number;
}) {
  const reached = region.rows.filter((row) => row.sessions > 0).length;
  // Sorted so the marks read most-trained first and a region's lit end is always on the left.
  // Unsorted, the alphabetical order of muscle names put the gaps in arbitrary places and the
  // row's shape stopped meaning anything at a glance. The detail below is built from the same
  // sorted array, so the marks and the names cannot fall into different orders.
  const marks = [...region.rows].sort((a, b) => b.primary - a.primary || b.sessions - a.sessions);

  const states = [
    { label: 'Trained', tone: 'var(--ink)', rows: marks.filter((r) => r.primary > 0) },
    {
      label: 'Assisting',
      tone: 'var(--ink-dim)',
      rows: marks.filter((r) => r.sessions > 0 && r.primary === 0),
    },
    { label: 'Not touched', tone: 'var(--flag)', rows: marks.filter((r) => r.sessions === 0) },
  ].filter((state) => state.rows.length > 0);

  return (
    <details className="disclosure is-row">
      <summary className="pressable">
        <span className="cap" style={{ color: reached > 0 ? 'var(--ink-dim)' : 'var(--ink-faint)' }}>
          {region.label}
        </span>

        <span style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          {marks.map((row, i) => (
            <span
              key={row.muscle}
              className={row.sessions > 0 ? 'draw-x' : undefined}
              style={
                {
                  flex: 1,
                  height: row.sessions > 0 ? 8 : 1,
                  background:
                    row.primary > 0
                      ? 'var(--ink)'
                      : row.sessions > 0
                        ? 'var(--ink-faint)'
                        : 'var(--rule)',
                  '--delay': `${index * 60 + i * 25}ms`,
                } as CSSProperties
              }
            />
          ))}
        </span>

        {/* Always a fraction, never a word. Only the numerator is flagged, and only at zero: it
            is the count that is wrong, while the denominator is how many muscles the region has
            and is the same number whether you trained them or not. */}
        <span className="mono" style={{ fontSize: 'var(--t-cap)', textAlign: 'right' }}>
          <span style={{ color: reached === 0 ? 'var(--flag)' : 'var(--ink)' }}>{reached}</span>
          <span style={{ color: 'var(--ink-dim)' }}>/{region.rows.length}</span>
        </span>
      </summary>

      {/* Indented to where the marks begin, so it reads as belonging to the row above rather
          than as a new block. One line per state that has anything in it — a region with nothing
          untouched should not carry an empty "Not touched" saying so. */}
      <div style={{ paddingLeft: 86, paddingBottom: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {states.map((state) => (
          <div key={state.label} style={{ fontSize: 'var(--t-sm)', lineHeight: 1.45 }}>
            <span className="cap" style={{ color: state.tone }}>
              {state.label}
            </span>{' '}
            <span className="selectable" style={{ color: 'var(--ink-dim)' }}>
              {state.rows.map((row) => row.muscle).join(', ')}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}
