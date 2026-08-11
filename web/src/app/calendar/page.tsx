import Link from 'next/link';
import type { CSSProperties } from 'react';
import { getCalendar, n, n0, type CalendarRow } from '@/lib/backend';
import { Masthead, Section, Rule, Figure, Empty, Fault, Swatch } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { compact, dec, int, monthKey, monthShape, shiftMonth, today } from '@/lib/format';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * A month at a glance, one square per day, tapping through to the full record.
 *
 * The squares carry two independent readings rather than a single "activity" score: an amber
 * bar for training volume and a dimmer one for calories. Blending them into one number would
 * make a heavy lifting day and a heavy eating day indistinguishable, which is exactly the
 * comparison this screen exists to make.
 */
export default async function Calendar({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const params = await searchParams;
  const key = /^\d{4}-\d{2}$/.test(params.m ?? '') ? params.m! : monthKey(today());
  const shape = monthShape(key);
  const result = await getCalendar(shape.from, shape.to);

  return (
    <main className="screen">
      <Masthead
        left={shape.label}
        right={result.ok ? `${result.rows.length} days logged` : `${shape.days} days`}
      />

      <Reveal>
        <Pager current={key} />
      </Reveal>

      {result.ok ? (
        <>
          <Reveal delay={60}>
            <Grid rows={result.rows} monthKey={key} />
          </Reveal>
          <Rule />
          <Reveal delay={120}>
            <Totals rows={result.rows} monthKey={key} />
          </Reveal>
        </>
      ) : (
        <Fault error={result.error} />
      )}
    </main>
  );
}

/** Month stepper. Plain links, so back and forward behave the way the phone expects. */
function Pager({ current }: { current: string }) {
  const previous = shiftMonth(current, -1);
  const next = shiftMonth(current, 1);
  // Nothing has been logged in the future, so forward stops at the current month rather than
  // offering an endless run of empty grids.
  const atPresent = current >= monthKey(today());

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
      <Step href={`/calendar?m=${previous}`} label={`‹ ${monthShape(previous).short}`} />
      <Link href="/calendar" className="cap pressable" style={{ color: 'var(--ink-dim)', padding: '10px 12px' }}>
        This month
      </Link>
      {atPresent ? (
        <span className="cap" style={{ color: 'var(--ink-faint)', opacity: 0.4, padding: '10px 0' }}>
          {monthShape(next).short} ›
        </span>
      ) : (
        <Step href={`/calendar?m=${next}`} label={`${monthShape(next).short} ›`} />
      )}
    </div>
  );
}

function Step({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="cap pressable"
      // 44px of height on a control that only looks 11px tall — the label is small because it
      // is a caption, but the target is a thumb.
      style={{ color: 'var(--signal)', minHeight: 44, display: 'flex', alignItems: 'center', padding: '0 2px' }}
    >
      {label}
    </Link>
  );
}

function Grid({ rows, monthKey: key }: { rows: CalendarRow[]; monthKey: string }) {
  const shape = monthShape(key);
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const now = today();

  // Both bars are scaled to the busiest day IN THIS MONTH, so the grid reads as a comparison
  // within the month rather than against an all-time maximum that is not on screen.
  const maxVolume = Math.max(...rows.map((r) => n0(r.volume_lbs)), 1);
  const maxCalories = Math.max(...rows.map((r) => n0(r.calories)), 1);

  const squares = [
    ...Array.from({ length: shape.leading }, (_, i) => <span key={`pad${i}`} />),
    ...Array.from({ length: shape.days }, (_, i) => {
      const date = `${key}-${String(i + 1).padStart(2, '0')}`;
      return (
        <Square
          key={date}
          date={date}
          day={i + 1}
          row={byDate.get(date)}
          maxVolume={maxVolume}
          maxCalories={maxCalories}
          isToday={date === now}
          isFuture={date > now}
        />
      );
    }),
  ];

  return (
    <div>
      <div
        className="cap"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 2,
          color: 'var(--ink-faint)',
          textAlign: 'center',
          marginBottom: 6,
        }}
      >
        {WEEKDAYS.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>{squares}</div>

      <div className="cap" style={{ marginTop: 12, color: 'var(--ink-faint)' }}>
        <Swatch tone="var(--signal)" />
        volume
        <span style={{ marginLeft: 12 }}>
          <Swatch tone="var(--signal-low)" />
          calories
        </span>
      </div>
    </div>
  );
}

function Square({
  date,
  day,
  row,
  maxVolume,
  maxCalories,
  isToday,
  isFuture,
}: {
  date: string;
  day: number;
  row?: CalendarRow;
  maxVolume: number;
  maxCalories: number;
  isToday: boolean;
  isFuture: boolean;
}) {
  const volume = n0(row?.volume_lbs);
  const calories = n0(row?.calories);
  const hasAnything = Boolean(row);

  // A cardio-only day has no volume but is not a rest day. It gets a minimum mark so it can't
  // disappear into the same blank as a day off.
  const volumePct = volume > 0 ? Math.max((volume / maxVolume) * 100, 8) : row?.sets ? 8 : 0;
  const caloriePct = calories > 0 ? Math.max((calories / maxCalories) * 100, 8) : 0;

  const numberTone = isToday
    ? 'var(--signal)'
    : isFuture
      ? 'var(--ink-faint)'
      : hasAnything
        ? 'var(--ink)'
        : 'var(--ink-faint)';

  const content = (
    <>
      <span className="mono" style={{ fontSize: 'var(--t-sm)', lineHeight: 1, color: numberTone }}>
        {day}
      </span>
      <span style={{ display: 'block' }}>
        <span
          className="draw-x"
          style={
            {
              display: 'block',
              height: 3,
              width: `${volumePct}%`,
              background: 'var(--signal)',
              marginBottom: 2,
              '--delay': `${day * 8}ms`,
            } as CSSProperties
          }
        />
        <span
          className="draw-x"
          style={
            {
              display: 'block',
              height: 3,
              width: `${caloriePct}%`,
              background: 'var(--signal-low)',
              '--delay': `${day * 8 + 40}ms`,
            } as CSSProperties
          }
        />
      </span>
    </>
  );

  const style: CSSProperties = {
    height: 52,
    padding: '6px 5px 5px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    // A background shift marks a day with data. Today gets an outline rather than a top border:
    // a border on the top edge sits flush against the bottom of the square directly above it in
    // the grid, so it reads as belonging to the wrong day. `outline` also costs no layout, so
    // the square doesn't shift by a pixel.
    background: hasAnything && !isFuture ? 'var(--panel)' : 'transparent',
    outline: isToday ? '1px solid var(--signal)' : undefined,
    outlineOffset: -1,
    opacity: isFuture ? 0.35 : 1,
  };

  // A day with nothing on it has nothing to show, so it is not a link. Tapping through to an
  // empty screen is a worse answer than the square already being blank.
  if (!hasAnything) return <span style={style}>{content}</span>;

  return (
    <Link href={`/calendar/${date}`} className="pressable" style={style} aria-label={`${date} detail`}>
      {content}
    </Link>
  );
}

function Totals({ rows, monthKey: key }: { rows: CalendarRow[]; monthKey: string }) {
  if (rows.length === 0) {
    return (
      <Section label="Month">
        <Empty>Nothing logged this month.</Empty>
      </Section>
    );
  }

  const trained = rows.filter((r) => r.sets > 0);
  const volume = rows.reduce((sum, r) => sum + n0(r.volume_lbs), 0);
  const cardio = rows.reduce((sum, r) => sum + n0(r.cardio_mi), 0);
  const fed = rows.filter((r) => r.items > 0);
  const avgCalories = fed.reduce((sum, r) => sum + n0(r.calories), 0) / (fed.length || 1);

  // First and last actual weigh-ins of the month, not the first and last day — a month that
  // starts on a Wednesday you didn't weigh in on still has a real change to report.
  const weighed = rows.filter((r) => n(r.weight_lbs) !== null);
  const weightChange =
    weighed.length > 1 ? n0(weighed[weighed.length - 1].weight_lbs) - n0(weighed[0].weight_lbs) : null;

  return (
    <Section label="Month" aside={`${trained.length} training days`}>
      <Figure value={int(volume)} unit="LB VOLUME" count={volume} />
      <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
        <Stat label="Sessions" value={String(trained.length)} />
        <Stat label="Cardio" value={dec(cardio, 1)} unit="MI" />
        <Stat label="Avg kcal" value={fed.length ? int(avgCalories) : '—'} />
        <Stat
          label="Weight"
          value={weightChange === null ? '—' : `${weightChange > 0 ? '+' : ''}${dec(weightChange)}`}
          unit={weightChange === null ? undefined : 'LB'}
          tone={weightChange === null ? undefined : weightChange > 0 ? 'var(--up)' : 'var(--down)'}
        />
      </div>
      {/* Measured against days ELAPSED, not against the days that happen to have rows. The
          latter would always read "10/10 days with food logged" — dividing a set by itself —
          and the number that actually matters is how many days got missed. */}
      <div className="cap" style={{ marginTop: 14, color: 'var(--ink-faint)' }}>
        Food logged {fed.length}/{elapsedDays(key)} days · busiest{' '}
        {compact(Math.max(...rows.map((r) => n0(r.volume_lbs))))} lb
      </div>
    </Section>
  );
}

/** Days of the month that have actually happened — the whole month once it is in the past. */
function elapsedDays(key: string): number {
  const shape = monthShape(key);
  const now = today();
  if (key < monthKey(now)) return shape.days;
  if (key > monthKey(now)) return 0;
  return Number(now.slice(8, 10));
}

function Stat({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: string }) {
  return (
    <div>
      <div className="cap" style={{ color: 'var(--ink-faint)' }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 'var(--t-lg)', marginTop: 2, color: tone ?? 'var(--ink)' }}>
        {value}
        {unit ? <span style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-dim)', marginLeft: 3 }}>{unit}</span> : null}
      </div>
    </div>
  );
}
