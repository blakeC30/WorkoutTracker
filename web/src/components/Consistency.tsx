import type { CSSProperties } from 'react';
import type { MonthRow } from '@/lib/backend';
import { Section, Empty } from '@/components/ui';
import { monthKey, monthShape, today } from '@/lib/format';

/**
 * Training days per month, for the last six.
 *
 * This replaced an eight-week ledger of volume, sets, calories and bodyweight — every column of
 * which was reported somewhere else in the app, and half of which restated the month grid
 * directly above it. It was the tallest block on the page and the least informative.
 *
 * One number per month, on purpose. The rest of this screen is scoped to a single month and the
 * rest of the app to a rolling four weeks, so the only question left for a tab called History is
 * whether the habit is holding up across seasons — and that is a count of days, not a tonnage.
 */
export function Consistency({ rows }: { rows: MonthRow[] }) {
  // Months before the first session ever logged are dropped. A zero there means "the app did not
  // exist yet", not "training stopped" — but a zero BETWEEN two active months is a real gap and
  // stays, because that is the single most useful thing a consistency view can show.
  const firstActive = rows.findIndex((row) => row.training_days > 0);
  const shown = firstActive === -1 ? [] : rows.slice(firstActive);

  if (shown.length === 0) {
    return (
      <Section label="Consistency">
        <Empty>No sessions logged yet. Months appear here as you train.</Empty>
      </Section>
    );
  }

  const current = monthKey(today());
  const complete = shown.filter((row) => row.month !== current);
  const average =
    complete.length > 0
      ? complete.reduce((sum, row) => sum + row.training_days, 0) / complete.length
      : null;

  const max = Math.max(...shown.map((row) => row.training_days), 1);

  return (
    <Section label="Consistency" aside={`${shown.length} month${shown.length === 1 ? '' : 's'}`}>
      <div>
        {shown.map((row, i) => (
          <MonthLine key={row.month} row={row} max={max} index={i} isCurrent={row.month === current} />
        ))}
      </div>

      {average !== null ? (
        <div className="cap" style={{ marginTop: 14, color: 'var(--ink-faint)' }}>
          {/* Averaged over COMPLETE months only. Including a month that is eleven days old drags
              the figure down by two thirds and reports it as a decline. */}
          {average.toFixed(average % 1 === 0 ? 0 : 1)} days/month across {complete.length} complete{' '}
          {complete.length === 1 ? 'month' : 'months'}
        </div>
      ) : null}
    </Section>
  );
}

function MonthLine({
  row,
  max,
  index,
  isCurrent,
}: {
  row: MonthRow;
  max: number;
  index: number;
  isCurrent: boolean;
}) {
  const shape = monthShape(row.month);
  const pct = (row.training_days / max) * 100;
  const empty = row.training_days === 0;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '38px 1fr auto',
        alignItems: 'center',
        gap: 10,
        height: 30,
        // A month with nothing in it is dimmed rather than hidden — the gap is the point.
        opacity: empty ? 0.45 : 1,
      }}
    >
      <span className="cap" style={{ color: isCurrent ? 'var(--signal)' : 'var(--ink-dim)' }}>
        {shape.short}
      </span>

      <div style={{ position: 'relative', height: 10 }}>
        {empty ? (
          <div style={{ position: 'absolute', insetInline: 0, top: 5, height: 1, background: 'var(--rule)' }} />
        ) : (
          <div
            className="draw-x"
            style={
              {
                position: 'absolute',
                inset: '0 auto 0 0',
                width: `${pct}%`,
                // The running month is drawn in the dimmer amber: its bar is short because the
                // month is young, not because training fell off, and a full-strength bar
                // invites that comparison.
                background: isCurrent ? 'var(--signal-low)' : 'var(--signal)',
                '--delay': `${index * 60}ms`,
              } as CSSProperties
            }
          />
        )}
      </div>

      <span className="mono" style={{ fontSize: 'var(--t-sm)', color: empty ? 'var(--ink-faint)' : 'var(--ink)' }}>
        {row.training_days}
        {isCurrent ? (
          <span style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-faint)' }}> / {row.days_elapsed}d</span>
        ) : null}
      </span>
    </div>
  );
}
