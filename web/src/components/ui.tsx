import type { CSSProperties, ReactNode } from 'react';
import { Counter } from './motion';
import { MACROS } from '@/lib/macros';

/*
 * The vocabulary the screens are built from. All of it renders on the server — none of these
 * ship a byte of JavaScript.
 *
 * Note what is absent: there is no <Card>. Separation is whitespace, then a hairline, then a
 * background shift, in that order, and it rarely gets past the second.
 */

/** The screen header: the date on the left, the ISO week on the right. */
export function Masthead({ left, right }: { left: string; right?: string }) {
  return (
    <header
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        // Clears the notch. Without the inset the first line sits under the status bar in
        // standalone mode, because viewport-fit=cover let us paint up there.
        paddingTop: 'calc(env(safe-area-inset-top) + 14px)',
        paddingBottom: 18,
      }}
    >
      <h1 className="cap" style={{ margin: 0, color: 'var(--ink)', fontWeight: 500 }}>
        {left}
      </h1>
      {right ? <span className="cap">{right}</span> : null}
    </header>
  );
}

/** A labelled block. The label is the only uppercase text on the screen. */
export function Section({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={{ marginBottom: 4 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 12,
        }}
      >
        <span className="cap">{label}</span>
        {aside ? <span className="cap">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function Rule({ tight = false }: { tight?: boolean }) {
  return <div className={tight ? 'rule rule--tight' : 'rule'} />;
}

/**
 * The headline number of a section. Unit is set smaller and dimmer so the digits dominate —
 * a value and its unit at the same size read as one long string at a glance.
 */
export function Figure({
  value,
  unit,
  size = 'var(--t-2xl)',
  tone = 'var(--ink)',
  count,
  decimals = 0,
}: {
  value: string;
  unit?: string;
  size?: string;
  tone?: string;
  /**
   * Pass the raw number to have the figure settle into it on arrival. `value` stays the
   * server-rendered string, so the correct number is in the HTML either way — the count is
   * decoration over a already-correct value, never the source of it.
   */
  count?: number | null;
  decimals?: number;
}) {
  return (
    <span className="mono" style={{ color: tone, fontSize: size, fontWeight: 500, lineHeight: 1 }}>
      {count !== undefined && count !== null ? <Counter value={count} decimals={decimals} /> : value}
      {unit ? (
        <span style={{ fontSize: 'var(--t-sm)', color: 'var(--ink-dim)', marginLeft: 6, fontWeight: 400 }}>
          {unit}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A signed change, in one ink. The triangle says which way; the colour says nothing.
 *
 * Bodyweight, calories and volume all move both ways for good reasons, and an app that
 * decided which was praiseworthy would be wrong half the time — so it does not decide.
 */
export function Delta({
  value,
  unit,
  over,
  /**
   * Force a fixed number of decimals.
   *
   * By default a whole number prints bare, which is right next to a count of sessions and
   * wrong next to a weight: `205.0 LB` with `▼ 2 lb` under it reads as two different kinds
   * of measurement. Pass 1 where the figure beside it carries a decimal.
   */
  decimals,
}: {
  value: number | null;
  unit?: string;
  over?: string;
  decimals?: number;
}) {
  if (value === null) return null;
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  /*
   * Direction is carried by the glyph, never by colour.
   *
   * This used to be moss for up and rust for down, with a note in DESIGN.md insisting they
   * were "used neutrally, not as praise". That was a claim the colours could not honour:
   * green-up and red-down are read as good and bad whatever the palette intends, and on the
   * reading this component is used for most — bodyweight — neither direction is either. A
   * cut showed rust and a bulk showed moss, and the app was congratulating or scolding a
   * number it has no opinion about.
   *
   * The triangle already says which way, so nothing is lost. Zero stays faint because it is
   * genuinely less to report, not because standing still is worse.
   */
  const tone = rounded === 0 ? 'var(--ink-faint)' : 'var(--ink)';
  const arrow = rounded > 0 ? '▲' : rounded < 0 ? '▼' : '–';
  const magnitude = Math.abs(rounded);

  return (
    <span className="mono" style={{ color: tone, fontSize: 'var(--t-sm)' }}>
      {arrow}{' '}
      {magnitude.toLocaleString('en-US', {
        minimumFractionDigits: decimals ?? 0,
        maximumFractionDigits: decimals ?? 1,
      })}
      {unit ? ` ${unit}` : ''}
      {over ? <span style={{ color: 'var(--ink-faint)' }}>{` / ${over}`}</span> : null}
    </span>
  );
}

/**
 * A horizontal bar row: label, bar, value.
 *
 * Two divs and a width percentage. Reaching for a charting library to draw this would ship a
 * client bundle and a set of defaults to override, for a rectangle.
 */
export function BarRow({
  label,
  value,
  max,
  display,
  tone = 'var(--signal)',
  index = 0,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
  tone?: string;
  /** Position in its list, used only to stagger the draw. */
  index?: number;
}) {
  const pct = max > 0 ? Math.max(value / max, 0) * 100 : 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '78px 1fr auto', alignItems: 'center', gap: 10, height: 26 }}>
      <span className="cap" style={{ color: 'var(--ink-dim)', letterSpacing: '0.08em' }}>
        {label}
      </span>
      {/* Both bars draw to length on arrival. The width in the HTML is already final — the
          animation is scaleX from 0, so it composites on the GPU and never reflows the row.
          Each row starts a beat after the one above it, which reads as the list filling in
          rather than as five things twitching at once. */}
      <div style={{ position: 'relative', height: 10 }}>
        <div
          className="draw-x"
          style={
            {
              position: 'absolute',
              inset: '0 auto 0 0',
              width: `${pct}%`,
              background: tone,
              '--delay': `${index * 70}ms`,
            } as CSSProperties
          }
        />
      </div>
      <span className="mono" style={{ fontSize: 'var(--t-sm)', color: 'var(--ink)' }}>
        {display}
      </span>
    </div>
  );
}

/**
 * An inline sparkline, drawn as an SVG path on the server.
 *
 * `preserveAspectRatio="none"` lets it stretch to any width while the viewBox stays in data
 * space, so no measuring and no client JavaScript are needed.
 */
export function Sparkline({
  points,
  height = 44,
  tone = 'var(--signal)',
  fill = true,
  floor = 0,
  activeIndex = null,
}: {
  points: number[];
  height?: number;
  tone?: string;
  fill?: boolean;
  /**
   * The point being read, when something is scrubbing the chart. Draws a guide down to it and
   * moves the marker there; null leaves the marker on the latest value, which is the resting
   * state and what the chart means when nobody is touching it.
   */
  activeIndex?: number | null;
  /**
   * Minimum span of the y-axis, in data units.
   *
   * Without it a sparkline always fills its full height, because it scales to its own min and
   * max — so a lift that moved 12lb draws the same dramatic peaks as one that moved 200. Passing
   * a floor proportional to the values keeps small changes looking small. The series is centred
   * within the padded range rather than pinned to the bottom of it.
   */
  floor?: number;
}) {
  if (points.length < 2) return null;

  const W = 100;
  const H = 30;
  const min = Math.min(...points);
  const max = Math.max(...points);
  // A flat series would divide by zero; drawing it down the middle is the honest picture.
  const span = Math.max(max - min, floor, 1e-9) || 1;
  const mid = (min + max) / 2;
  const lo = mid - span / 2;
  const step = W / (points.length - 1);
  const coords = points.map((p, i) => [i * step, H - ((p - lo) / span) * H] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const at = activeIndex === null ? coords.length - 1 : Math.min(Math.max(activeIndex, 0), coords.length - 1);
  const [lastX, lastY] = coords[at];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block', overflow: 'visible' }}
      aria-hidden="true"
    >
      {/* Line and fill wipe on together under one clip, so the shaded area arrives with the
          line rather than chasing it. The fill gets its own opacity keyframe because a CSS
          `opacity: 1` from a generic reveal would beat the 0.12 attribute and flood the panel. */}
      <g className="wipe-x">
        {fill ? <path d={area} fill={tone} className="fill-in" /> : null}
        <path d={line} fill="none" stroke={tone} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </g>
      {/* The current value gets a mark; every other point does not. One focal point.
          A zero-length LINE rather than a <rect>: the viewBox is stretched unequally by
          preserveAspectRatio="none", so a rect 4 units wide and 4 tall comes out as a wide
          flat bar. Stroke geometry escapes that scaling via non-scaling-stroke, so a square
          cap on a zero-length segment is a true square in device pixels at any plot size. */}
      {/* A guide only while scrubbing. At rest the marker alone is enough, and a permanent
          vertical rule would be one more line on a screen already made of them. */}
      {activeIndex !== null ? (
        <line
          x1={lastX}
          y1={0}
          x2={lastX}
          y2={H}
          stroke={tone}
          strokeWidth={1}
          opacity={0.35}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <line
        x1={lastX}
        y1={lastY}
        x2={lastX}
        y2={lastY}
        stroke={tone}
        strokeWidth={5}
        strokeLinecap="square"
        vectorEffect="non-scaling-stroke"
        className="mark-in"
      />
    </svg>
  );
}

/**
 * Nothing to show, and why.
 *
 * On a personal log this is a routine state, not an edge case — every screen looks like this
 * the day the database is cleared. So it gets a sentence that says what would fill it.
 */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p style={{ margin: '4px 0 8px', color: 'var(--ink-faint)', fontSize: 'var(--t-sm)', lineHeight: 1.5 }}>
      {children}
    </p>
  );
}

/** A section that failed. The rest of the screen still renders. */
export function Fault({ error }: { error: string }) {
  return (
    <div style={{ borderLeft: '2px solid var(--fault)', paddingLeft: 12, margin: '4px 0 8px' }}>
      <div className="cap" style={{ color: 'var(--fault)' }}>
        Unavailable
      </div>
      <p className="selectable" style={{ margin: '4px 0 0', color: 'var(--ink-dim)', fontSize: 'var(--t-sm)' }}>
        {error}
      </p>
    </div>
  );
}

/**
 * Protein / carbs / fat on one line.
 *
 * The pairs used to be three spans in a flex row with a plain space inside each — "54 P 0 C 6 F"
 * — which put roughly the same gap inside a pair as between pairs, so the eye had nothing to
 * group on and it read as one run of alternating characters. Two changes fix it: the unit sits
 * hard against its number, and the gap between pairs is widened well past a space. The number is
 * also a step brighter than its unit, so the value leads and the letter annotates it.
 */
export function Macros({
  protein,
  carbs,
  fat,
  size = 'var(--t-cap)',
}: {
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  size?: string;
}) {
  const values = { protein, carbs, fat };
  return (
    <span className="mono" style={{ display: 'inline-flex', gap: 14, fontSize: size }}>
      {MACROS.map((m) => (
        <MacroPair key={m.key} value={values[m.key]} unit={m.short} tone={m.color} />
      ))}
    </span>
  );
}

/**
 * The unit letter carries the macro's tone; the number stays plain ink.
 *
 * Only the letter, because these sit in a dense row under a food name and three differently
 * lit numbers would read as three different states rather than three quantities. The letter is
 * the part that says WHICH macro, so it is the part the colour belongs on — and it makes the
 * ramp mean the same thing here as it does in the split bar on Today.
 */
function MacroPair({ value, unit, tone }: { value: number | null; unit: string; tone: string }) {
  return (
    <span style={{ whiteSpace: 'nowrap', color: 'var(--ink-dim)' }}>
      {value === null ? '—' : Math.round(value).toLocaleString('en-US')}
      {/* About half a space at this size — enough to breathe, still far tighter than the 14px
          between pairs, which is what does the grouping. A full space made the two read as
          separate tokens; none at all made them collide. */}
      <span style={{ color: tone, marginLeft: 3 }}>{unit}</span>
    </span>
  );
}

/**
 * A legend swatch. A drawn box rather than a `■` glyph, whose size and baseline shift with
 * whatever font happens to have it.
 */
export function Swatch({ tone }: { tone: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        background: tone,
        marginRight: 5,
        verticalAlign: 'baseline',
      }}
    />
  );
}

/** A ledger row: name on the left, measured values on the right. */
export function Row({
  name,
  meta,
  right,
  dim = false,
  style,
}: {
  name: ReactNode;
  meta?: ReactNode;
  right?: ReactNode;
  dim?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 14,
        padding: '11px 0',
        borderTop: '1px solid var(--rule)',
        opacity: dim ? 0.55 : 1,
        ...style,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="selectable" style={{ fontSize: 'var(--t-base)', lineHeight: 1.25 }}>
          {name}
        </div>
        {meta ? <div style={{ marginTop: 3 }}>{meta}</div> : null}
      </div>
      {right ? <div style={{ textAlign: 'right', flexShrink: 0 }}>{right}</div> : null}
    </div>
  );
}
