import { getWeeks, n, n0, type WeekRow } from '@/lib/backend';
import { Masthead, Section, Rule, Figure, Empty, Fault, Swatch } from '@/components/ui';
import { compact, dec, int, isoWeek, parseDay, shortDay } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Eight weeks as a ledger, newest first.
 *
 * Deliberately not a bar chart. A chart of eight bars answers one question — which week was
 * biggest — and hides the four numbers per week that actually matter. A dense row of aligned
 * monospace figures answers all of them at once, and on a 390px screen it fits.
 */
export default async function Week() {
  const result = await getWeeks(8);
  const now = new Date();

  return (
    <main className="screen">
      <Masthead left="Weeks" right={`WK ${isoWeek(now)}`} />
      <Body result={result} />
    </main>
  );
}

function Body({ result }: { result: Awaited<ReturnType<typeof getWeeks>> }) {
  if (!result.ok) return <Fault error={result.error} />;

  // The backend returns oldest first, which is right for charts and wrong for reading.
  const weeks = [...result.rows].reverse();
  const withTraining = weeks.filter((w) => w.training_days > 0);

  if (withTraining.length === 0) {
    return <Empty>Nothing logged in the last eight weeks.</Empty>;
  }

  const current = weeks[0];
  const previous = weeks[1];
  const maxVolume = Math.max(...weeks.map((w) => n0(w.volume_lbs)), 1);

  // Deliberately NOT a delta against last week.
  //
  // The current week is always partial — on a Tuesday it holds one session — so a signed change
  // against a finished week reads as a 70% collapse every Monday and means nothing. Last week's
  // finished total is shown beside it instead and the comparison is left to the reader, who
  // knows what day it is.
  const lastWeekVolume = previous ? n(previous.volume_lbs) : null;

  return (
    <>
      <Section label="This week" aside={`${current.training_days}/7 days`}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <Figure value={int(n(current.volume_lbs))} unit="LB VOLUME" size="var(--t-2xl)" />
          {lastWeekVolume !== null ? (
            <span className="mono" style={{ fontSize: 'var(--t-sm)', color: 'var(--ink-faint)' }}>
              {compact(lastWeekVolume)} last wk
            </span>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 26, marginTop: 16 }}>
          <Stat label="Sets" value={String(current.total_sets)} />
          <Stat label="Cardio" value={dec(n(current.cardio_miles))} unit="MI" />
          <Stat label="Avg kcal" value={int(n(current.avg_calories))} />
          <Stat label="Weight" value={dec(n(current.avg_weight_lbs))} unit="LB" />
        </div>
      </Section>

      <Rule />

      <Section label="Eight weeks" aside="volume">
        <div>
          {weeks.map((week) => (
            <WeekLine key={week.week_starting} week={week} max={maxVolume} />
          ))}
        </div>
        <div className="cap" style={{ marginTop: 14, color: 'var(--ink-faint)' }}>
          <Swatch tone="var(--signal)" />
          Each row: volume bar, training days, avg kcal, avg weight
        </div>
      </Section>
    </>
  );
}

/**
 * One week.
 *
 * A skipped week renders as a dimmed row with a hairline where the bar would be, rather than
 * being dropped. Absence is information on a training log — the gaps are the story of a block
 * as much as the peaks are.
 */
function WeekLine({ week, max }: { week: WeekRow; max: number }) {
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
              <div style={{ position: 'absolute', insetInline: 0, top: 5, height: 1, background: 'var(--rule)' }} />
            ) : (
              <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${pct}%`, background: 'var(--signal)' }} />
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

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <div className="cap" style={{ color: 'var(--ink-faint)' }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 'var(--t-lg)', marginTop: 2 }}>
        {value}
        {unit ? <span style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-dim)', marginLeft: 3 }}>{unit}</span> : null}
      </div>
    </div>
  );
}
