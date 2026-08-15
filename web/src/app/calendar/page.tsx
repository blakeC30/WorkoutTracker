import Link from 'next/link';
import type { CSSProperties } from 'react';
import { getCalendar, n, n0, type CalendarRow } from '@/lib/backend';
import { Masthead, Section, Rule, Empty, Fault } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { PATTERNS, PATTERN_ROWS, patternLabel } from '@/lib/patterns';
import { dec, monthKey, monthShape, shiftMonth, today } from '@/lib/format';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * Only the three anchor meals get a slot.
 *
 * Snacks and desserts are genuinely optional, so their absence says nothing — but a missing
 * lunch is almost always a missed log rather than a skipped meal, and that is the signal this
 * row exists to surface.
 */
const MEALS = [
  { key: 'breakfast', long: 'Breakfast' },
  { key: 'lunch', long: 'Lunch' },
  { key: 'dinner', long: 'Dinner' },
] as const;

export default async function Calendar({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
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
            <Matrix rows={result.rows} monthKey={key} />
          </Reveal>

          <Rule />
          <Reveal delay={180}>
            <Totals rows={result.rows} monthKey={key} />
          </Reveal>
        </>
      ) : (
        <Fault error={result.error} />
      )}
    </main>
  );
}

// --- Month pager -------------------------------------------------------------------------

function Pager({ current }: { current: string }) {
  const previous = shiftMonth(current, -1);
  const next = shiftMonth(current, 1);
  const atPresent = current >= monthKey(today());

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
      <Step href={`/calendar?m=${previous}`} label={`‹ ${monthShape(previous).short}`} />
      {/* The month you are ON, so the row reads JUL · AUG · SEP and the middle names the thing
          either arrow moves you away from. It used to be a "This month" shortcut back to the
          present, which was the one label here that did not describe a month at all — and in a
          row of three, the middle slot is where you look to find out where you are.

          Ink rather than --signal, even though this is "the current value": amber in THIS row
          means tappable, since both arrows carry it. An amber label that does nothing when
          pressed would be the row contradicting itself. Whether you are on the present month is
          already said by the next arrow, which greys out when there is nowhere further to go. */}
      <span className="cap" style={{ color: 'var(--ink)', padding: '10px 12px' }}>
        {monthShape(current).short}
      </span>
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
      style={{ color: 'var(--signal)', minHeight: 44, display: 'flex', alignItems: 'center', padding: '0 2px' }}
    >
      {label}
    </Link>
  );
}

// --- The grid ----------------------------------------------------------------------------

function Grid({ rows, monthKey: key }: { rows: CalendarRow[]; monthKey: string }) {
  const shape = monthShape(key);
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const now = today();

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {Array.from({ length: shape.leading }, (_, i) => (
          <span key={`pad${i}`} />
        ))}
        {Array.from({ length: shape.days }, (_, i) => {
          const date = `${key}-${String(i + 1).padStart(2, '0')}`;
          return (
            <Square
              key={date}
              date={date}
              day={i + 1}
              row={byDate.get(date)}
              isToday={date === now}
              isFuture={date > now}
            />
          );
        })}
      </div>

      {/* The legend draws the same marks the squares do rather than describing them in words.
          Naming the rows in prose ran to two wrapped lines and still left you mapping "top row"
          onto a 4px tick; showing a lit slot next to its label does not.

          Closed by default, and a native <details> so it costs no JavaScript and no state. The
          grid is read every day and the legend is read roughly twice — once when the screen is
          new and once after a row is added — so it earns a line, not a permanent block above the
          fold. Each label is tinted to match its own slot, and the rows are in the squares' own
          top-to-bottom order, which is the whole reason this reads as a key rather than a list. */}
      <details className="disclosure" style={{ marginTop: 14 }}>
        <summary className="cap pressable">Legend</summary>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7, paddingBottom: 4 }}>
          <LegendRow items={[{ label: 'Weighed in', tone: 'var(--ink-faint)' }]} height={3} />
          <LegendRow items={PATTERNS.map((p) => ({ label: p.label, tone: p.color }))} height={4} />
          <LegendRow
            items={MEALS.map((m) => ({ label: m.long, tone: 'var(--ink-faint)' }))}
            height={3}
          />
        </div>
      </details>
    </div>
  );
}

function Square({
  date,
  day,
  row,
  isToday,
  isFuture,
}: {
  date: string;
  day: number;
  row?: CalendarRow;
  isToday: boolean;
  isFuture: boolean;
}) {
  const hasAnything = Boolean(row);
  const patterns = new Set(row?.patterns ?? []);
  const meals = new Set(row?.meal_types ?? []);
  const weighed = n(row?.weight_lbs) !== null;

  const numberTone = isToday
    ? 'var(--signal)'
    : isFuture || !hasAnything
      ? 'var(--ink-faint)'
      : 'var(--ink)';

  const style: CSSProperties = {
    height: 52,
    padding: '5px 5px 6px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    background: hasAnything && !isFuture ? 'var(--panel)' : 'transparent',
    outline: isToday ? '1px solid var(--signal)' : undefined,
    outlineOffset: -1,
    opacity: isFuture ? 0.35 : 1,
  };

  const content = (
    <>
      <span className="mono" style={{ fontSize: 'var(--t-sm)', lineHeight: 1, color: numberTone }}>
        {day}
      </span>

      {/* Slot tracks are drawn only on days that have something. Nine empty tracks on every
          rest day would fill the month with marks that all mean "no" — the blank square already
          says that, and says it more clearly. */}
      {hasAnything ? (
        <span style={{ display: 'block' }}>
          {/* One bar spanning the whole day rather than a slot, because there is only ever one
              weigh-in and nothing for it to hold a position against. It sits on top so the three
              rows read in the order a day is built: what you weighed, what you trained, what you
              ate. Monochrome and at the meals' weight, not the patterns' — full width already
              gives it presence, and colour in this app means movement pattern and nothing else.
              An unweighed day keeps the empty track so the two rows below never shift up, which
              is what lets one square's silhouette be compared with another's. */}
          <Slots
            items={[{ on: weighed, tone: 'var(--ink-faint)' }]}
            height={3}
            delay={day * 8}
          />
          <span style={{ display: 'block', height: 2 }} />
          <Slots
            items={PATTERNS.map((p) => ({ on: patterns.has(p.key), tone: p.color }))}
            height={4}
            delay={day * 8 + 20}
          />
          <span style={{ display: 'block', height: 2 }} />
          {/* Meals stay monochrome. Colour in this app means one thing — which movement
              pattern — and giving the meal row its own hues would imply the two rows are the
              same kind of category when they are not even the same dimension. */}
          <Slots
            items={MEALS.map((m) => ({ on: meals.has(m.key), tone: 'var(--ink-faint)' }))}
            height={3}
            delay={day * 8 + 40}
          />
        </span>
      ) : null}
    </>
  );

  if (!hasAnything) return <span style={style}>{content}</span>;

  return (
    <Link href={`/calendar/${date}`} className="pressable" style={style} aria-label={`${date} detail`}>
      {content}
    </Link>
  );
}

/** One legend line: the lit slots, then what each position means, in the slots' own order. */
function LegendRow({
  items,
  height,
}: {
  items: readonly { label: string; tone: string }[];
  height: number;
}) {
  return (
    <div className="cap" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ display: 'flex', gap: 2, width: 34, flexShrink: 0 }}>
        {items.map((item) => (
          <span key={item.label} style={{ flex: 1, height, background: item.tone }} />
        ))}
      </span>
      <span style={{ display: 'flex', gap: 8, minWidth: 0 }}>
        {items.map((item) => (
          <span key={item.label} style={{ color: item.tone }}>
            {item.label}
          </span>
        ))}
      </span>
    </div>
  );
}

/** A fixed row of on/off marks. Unfilled slots keep a faint track so position stays readable. */
function Slots({
  items,
  height,
  delay,
}: {
  items: { on: boolean; tone: string }[];
  height: number;
  delay: number;
}) {
  return (
    <span style={{ display: 'flex', gap: 2 }}>
      {items.map((item, i) => (
        <span
          key={i}
          className={item.on ? 'draw-x' : undefined}
          style={
            {
              flex: 1,
              height,
              background: item.on ? item.tone : 'var(--rule)',
              '--delay': `${delay + i * 25}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

// --- Pattern x day matrix ----------------------------------------------------------------

/**
 * Every pattern against every day of the month.
 *
 * This is the screen's answer to "what am I neglecting". The squares above show what each day
 * WAS; this shows what each pattern has been getting, read along a row — and a row with a long
 * empty stretch is visible from across the room in a way that thirty separate squares is not.
 */
function Matrix({ rows, monthKey: key }: { rows: CalendarRow[]; monthKey: string }) {
  const shape = monthShape(key);
  const byDate = new Map(rows.map((row) => [row.date, new Set(row.patterns)]));
  const now = today();

  const days = Array.from({ length: shape.days }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`);

  return (
    <Section label="Coverage" aside="by pattern">
      <div>
        {/* Rows, not slots: the catch-all gets a line here even though it has no square slot,
            so a month of Sunday-league football is not a blank in the coverage view. */}
        {PATTERN_ROWS.map((pattern, rowIndex) => {
          const hits = days.filter((date) => byDate.get(date)?.has(pattern.key)).length;
          return (
            <div
              key={pattern.key}
              style={{ display: 'grid', gridTemplateColumns: '54px 1fr 26px', alignItems: 'center', gap: 8, height: 20 }}
            >
              <span className="cap" style={{ color: hits ? pattern.color : 'var(--ink-faint)' }}>
                {patternLabel(pattern.key)}
              </span>
              <span style={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                {days.map((date, i) => {
                  const on = byDate.get(date)?.has(pattern.key) ?? false;
                  const future = date > now;
                  return (
                    <span
                      key={date}
                      className={on ? 'draw-x' : undefined}
                      style={
                        {
                          flex: 1,
                          // A trained day is a solid block; an untrained one is a hairline on the
                          // baseline. Same footprint, so the columns stay aligned with the dates.
                          height: on ? 12 : 1,
                          background: on ? pattern.color : 'var(--rule)',
                          opacity: future ? 0.3 : 1,
                          '--delay': `${rowIndex * 60 + i * 6}ms`,
                        } as CSSProperties
                      }
                    />
                  );
                })}
              </span>
              <span className="mono" style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-faint)', textAlign: 'right' }}>
                {hits}
              </span>
            </div>
          );
        })}
      </div>

      {/* Date ruler. Only four labels — one per day would be unreadable at 9px per column, and
          the point of the row is the shape of the gaps, not reading off exact dates. */}
      <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr 26px', gap: 8, marginTop: 6 }}>
        <span />
        <span className="cap" style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-faint)' }}>
          <span>1</span>
          <span>8</span>
          <span>15</span>
          <span>22</span>
          <span>{shape.days}</span>
        </span>
        <span />
      </div>
    </Section>
  );
}

// --- Days since --------------------------------------------------------------------------

// --- Month totals ------------------------------------------------------------------------

/**
 * What the grid above cannot show: how much of the month got logged at all.
 *
 * The volume, cardio and calorie totals that used to live here were a straight duplicate of the
 * eight-week ledger further down the same screen. What is left is the coverage question — days
 * trained, days fed and days weighed, against days elapsed — which nothing else reports.
 */
function Totals({ rows, monthKey: key }: { rows: CalendarRow[]; monthKey: string }) {
  if (rows.length === 0) {
    return (
      <Section label="Month">
        <Empty>Nothing logged this month.</Empty>
      </Section>
    );
  }

  const elapsed = elapsedDays(key);
  const trained = rows.filter((r) => r.sets > 0).length;
  const fed = rows.filter((r) => r.items > 0).length;

  const weighed = rows.filter((r) => n(r.weight_lbs) !== null);
  const weightChange =
    weighed.length > 1 ? n0(weighed[weighed.length - 1].weight_lbs) - n0(weighed[0].weight_lbs) : null;

  return (
    <Section label="Month" aside={`${elapsed} days so far`}>
      {/* Two columns rather than one row. Four of these will not fit across 350px — the labels
          alone run past it at 11px with the cap tracking — and the pairing the grid produces is
          the right one anyway: the three coverage counts read down the left and across, and the
          only stat here that is not a count of days sits last. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 26px' }}>
        <Stat label="Trained" value={`${trained}`} unit={`/ ${elapsed}`} />
        <Stat label="Food logged" value={`${fed}`} unit={`/ ${elapsed}`} />
        {/* Sits next to the change below it on purpose: a month with four weigh-ins makes that
            figure nearly meaningless, and the count is the only thing that says so. */}
        <Stat label="Weighed in" value={`${weighed.length}`} unit={`/ ${elapsed}`} />
        {/* No tone. The sign in front of the number already says which way it went, and
            colouring the direction made a month of gaining read as an error and a month of
            losing read as a reward — a judgement this screen has no business making. */}
        <Stat
          label="Weight"
          value={weightChange === null ? '—' : `${weightChange > 0 ? '+' : ''}${dec(weightChange)}`}
          unit={weightChange === null ? undefined : 'LB'}
        />
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
