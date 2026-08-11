import type { CSSProperties } from 'react';
import { n, n0, type WeekRow } from '@/lib/backend';
import { Section, Swatch } from '@/components/ui';
import { compact, dec, int, isoWeek, parseDay, shortDay } from '@/lib/format';

/**
 * Eight weeks as a ledger, newest first.
 *
 * Deliberately not a bar chart. A chart of eight bars answers one question — which week was
 * biggest — and hides the four numbers per week that actually matter. A dense row of aligned
 * monospace figures answers all of them at once, and on a 390px screen it fits.
 *
 * Lives on the calendar screen rather than a tab of its own: the month grid and this ledger are
 * the same question — "have I been consistent" — at two zoom levels, and two tabs for one
 * question meant scrolling past the same numbers twice.
 */
export function WeekLedger({ weeks }: { weeks: WeekRow[] }) {
  // The backend returns oldest first, which is right for charts and wrong for reading.
  const ordered = [...weeks].reverse();
  const maxVolume = Math.max(...ordered.map((w) => n0(w.volume_lbs)), 1);

  return (
    <Section label="Eight weeks" aside="volume">
      <div>
        {ordered.map((week, i) => (
          <WeekLine key={week.week_starting} week={week} max={maxVolume} index={i} />
        ))}
      </div>
      <div className="cap" style={{ marginTop: 14, color: 'var(--ink-faint)' }}>
        <Swatch tone="var(--signal)" />
        Each row: volume bar, training days, avg kcal, avg weight
      </div>
    </Section>
  );
}

/**
 * One week.
 *
 * A skipped week renders as a dimmed row with a hairline where the bar would be, rather than
 * being dropped. Absence is information on a training log — the gaps are the story of a block
 * as much as the peaks are.
 */
function WeekLine({ week, max, index }: { week: WeekRow; max: number; index: number }) {
  const volume = n0(week.volume_lbs);
  const pct = (volume / max) * 100;
  const skipped = week.training_days === 0;
  const start = parseDay(week.week_starting);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '52px 1fr',
        gap: 12,
        alignItems: 'center',
        padding: '10px 0',
        borderTop: '1px solid var(--rule)',
        opacity: skipped ? 0.42 : 1,
      }}
    >
      <div>
        <div className="cap" style={{ color: skipped ? 'var(--ink-faint)' : 'var(--ink-dim)' }}>
          W{isoWeek(start)}
        </div>
        <div className="mono" style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-faint)', marginTop: 1 }}>
          {shortDay(week.week_starting)}
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative', height: 12, flex: 1 }}>
            {skipped ? (
              <div
                className="draw-x"
                style={
                  {
                    position: 'absolute',
                    insetInline: 0,
                    top: 5,
                    height: 1,
                    background: 'var(--rule)',
                    '--delay': `${index * 55}ms`,
                  } as CSSProperties
                }
              />
            ) : (
              <div
                className="draw-x"
                style={
                  {
                    position: 'absolute',
                    inset: '0 auto 0 0',
                    width: `${pct}%`,
                    background: 'var(--signal)',
                    '--delay': `${index * 55}ms`,
                  } as CSSProperties
                }
              />
            )}
          </div>
          <span className="mono" style={{ fontSize: 'var(--t-sm)', minWidth: 44, textAlign: 'right' }}>
            {skipped ? '—' : compact(volume)}
          </span>
        </div>

        <div
          className="mono"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 6,
            fontSize: 'var(--t-cap)',
            color: 'var(--ink-faint)',
          }}
        >
          <TrainingDays count={week.training_days} />
          {week.total_sets ? <span>{week.total_sets} sets</span> : null}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
            {week.avg_calories ? <span>{int(n(week.avg_calories))} kcal</span> : null}
            {week.avg_weight_lbs ? <span>{dec(n(week.avg_weight_lbs))} lb</span> : null}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Seven marks, filled for each day trained.
 *
 * Fixed at seven rather than drawn per training day, so consistency reads at a glance without
 * counting: the shape of a 5-day week is different from a 2-day week even in peripheral vision.
 */

/**
 * Seven marks, filled for each day trained.
 *
 * Fixed at seven rather than drawn per training day, so consistency reads at a glance without
 * counting: the shape of a 5-day week is different from a 2-day week even in peripheral vision.
 */
function TrainingDays({ count }: { count: number }) {
  return (
    <span style={{ display: 'flex', gap: 3 }} aria-label={`${count} of 7 days trained`}>
      {Array.from({ length: 7 }, (_, i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            background: i < count ? 'var(--signal)' : 'var(--rule)',
          }}
        />
      ))}
    </span>
  );
}
