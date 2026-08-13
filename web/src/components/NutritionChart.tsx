'use client';

import { useCallback, useRef, useState } from 'react';
import { Bar, ComposedChart, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { NutritionRow } from '@/lib/backend';
import { MACROS, macroColor } from '@/lib/macros';
import { useScrubGesture } from '@/lib/useScrubGesture';
import { dec, int, shortDay } from '@/lib/format';
import { nowInAppTz } from '@/lib/time';

/*
 * The one place in the app that uses Recharts.
 *
 * It earns it here: two series in different units on two axes (calories as bars, protein as a
 * line), plus a reference line at the period average. Hand-rolling dual-axis scaling is where
 * SVG-by-hand stops being cheaper than a dependency.
 *
 * What it does NOT use is Recharts' <Tooltip>. A floating tooltip on a touch screen is placed
 * under your finger and vanishes when you lift it. Instead a bar is a tap target and the
 * selected day is read out in fixed markup above the chart, where it stays put.
 */

type Point = {
  date: string;
  calories: number;
  /** null, not 0, on unlogged days — it is what lets the protein line break across a gap. */
  protein: number | null;
  carbs: number;
  fat: number;
  items: number;
  /** False for a calendar day with no meals recorded — not the same as a day you ate nothing. */
  logged: boolean;
};

/**
 * Expand the backend's rows into a continuous run of calendar days.
 *
 * `getDailyNutrition` groups by `entry_date`, so a day with no meals produces no row at all.
 * Plotted directly, the x-axis becomes ordinal-by-logged-day: a fortnight you never logged
 * collapses to nothing and the chart reads as unbroken normal eating. Padding the gaps back in
 * is what makes the axis mean time again.
 */
/**
 * How far the plot sits inside its own SVG, in pixels — and equally, how far the SVG bleeds
 * past the content column, since the wrapper is pulled out by the same amount.
 *
 * The two cancel, so the plot area lands exactly on the text column either way. What the
 * number buys is room for the axis labels, which are centred on their tick and hang half
 * their width to each side of it. At 6px the first label — centred about 6px into the plot,
 * ~36px wide — reached 12px past the SVG's left edge and was clipped by roughly one
 * character: "14 JUL" arrived as "4 JUL", which reads as a real date and so does not even
 * look like a rendering fault.
 *
 * 20px is the page gutter, so the SVG now spans the full screen width and the label clears
 * its edge by about 8px. Any smaller and the exact clipping depends on font metrics.
 *
 * It is one constant because the scrub reads it too: mapping a touch to a day means knowing
 * where the plot starts inside the box being touched, and a chart margin that drifted from
 * that number would silently select the wrong day near the edges.
 */
const PLOT_INSET = 20;

function buildSeries(rows: NutritionRow[], days: number): Point[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: Point[] = [];
  // App timezone, not the browser's. This axis is matched against `entry_date` keys the
  // backend wrote in Central, so a phone in another zone would shift every bucket by a day.
  const cursor = nowInAppTz();
  cursor.setHours(12, 0, 0, 0); // midday, so a DST shift can't step the date backwards
  cursor.setDate(cursor.getDate() - (days - 1));

  for (let i = 0; i < days; i += 1) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
      cursor.getDate(),
    ).padStart(2, '0')}`;
    const row = byDate.get(iso);
    out.push({
      date: iso,
      calories: row ? Math.round(Number(row.calories ?? 0)) : 0,
      protein: row ? Math.round(Number(row.protein_g ?? 0)) : null,
      carbs: row ? Math.round(Number(row.carbs_g ?? 0)) : 0,
      fat: row ? Math.round(Number(row.fat_g ?? 0)) : 0,
      items: row?.items ?? 0,
      logged: Boolean(row),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function NutritionChart({ rows, days = 30 }: { rows: NutritionRow[]; days?: number }) {
  const data = buildSeries(rows, days);
  const loggedDays = data.filter((d) => d.logged);

  // Opens on the most recent LOGGED day rather than on nothing — the readout is never blank, so
  // the layout doesn't jump the first time you touch it.
  const [selected, setSelected] = useState(() => {
    const last = data.map((d) => d.logged).lastIndexOf(true);
    return last === -1 ? data.length - 1 : last;
  });
  const point = data[Math.min(selected, data.length - 1)];

  // Averaged over days that were actually logged, not over thirty — the same rule the backend's
  // weekly rollup uses. Dividing by the calendar would turn a week you forgot to log into a
  // week you starved.
  const avgCalories = loggedDays.reduce((sum, d) => sum + d.calories, 0) / (loggedDays.length || 1);
  const avgProtein = loggedDays.reduce((sum, d) => sum + (d.protein ?? 0), 0) / (loggedDays.length || 1);

  const plot = useRef<HTMLDivElement>(null);

  /**
   * Scrub, not tap.
   *
   * Thirty bars across 390px makes each one about 1.5mm wide — far under the 44px a fingertip
   * needs. So the whole plot is one drag surface and the nearest day wins. You put a thumb down
   * anywhere and slide; precision is never required.
   */
  const scrub = useCallback(
    (clientX: number) => {
      const box = plot.current?.getBoundingClientRect();
      if (!box || data.length === 0) return;
      const usable = box.width - PLOT_INSET * 2;
      const ratio = (clientX - box.left - PLOT_INSET) / (usable || 1);
      const index = Math.round(ratio * (data.length - 1));
      setSelected(Math.min(Math.max(index, 0), data.length - 1));
    },
    [data.length],
  );

  // No onRelease: the selected day stays put after you lift off, so the readout above the plot
  // keeps answering for the day you stopped on. A tap counts here for the same reason — the
  // selection survives it, so it is a real shortcut rather than a flash.
  const gesture = useScrubGesture({ ref: plot, onScrub: scrub, tapToSelect: true });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div>
          <div className="cap" style={{ color: 'var(--signal)' }}>
            {shortDay(point.date)}
          </div>
          <div className="mono" style={{ fontSize: 'var(--t-2xl)', fontWeight: 500, lineHeight: 1.1, marginTop: 2 }}>
            {point.logged ? (
              <>
                {int(point.calories)}
                <span style={{ fontSize: 'var(--t-sm)', color: 'var(--ink-dim)', marginLeft: 6, fontWeight: 400 }}>
                  KCAL
                </span>
              </>
            ) : (
              <span style={{ color: 'var(--ink-faint)' }}>—</span>
            )}
          </div>
        </div>
        <div className="mono" style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-dim)', textAlign: 'right' }}>
          {point.logged ? (
            /* Driven off MACROS rather than three hard-coded letters, so this readout carries
               the same tones as the split bar on Now and the day page, and the P/C/F in the
               food list below it. All three used to inherit the container's --ink-dim and read
               as one grey block, which made the one place you scrub a day's macros the only
               place in the app where they were not colour-coded.

               The letter is tinted and the number is not, the same way `Macros` does it in the
               food list: three differently lit numbers in a stack read as three states rather
               than three quantities. */
            <>
              {MACROS.map((m) => (
                <div key={m.key}>
                  {point[m.key]}
                  <span style={{ color: m.color, marginLeft: 3 }}>{m.short}</span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ color: 'var(--ink-faint)' }}>Not logged</div>
          )}
        </div>
      </div>

      <div
        ref={plot}
        className="chart-in"
        // Pulled out by exactly PLOT_INSET, which the chart's margin then puts back — the plot
        // lands on the text column and the labels get the gutter to overhang into.
        style={{
          height: 168,
          margin: `14px -${PLOT_INSET}px 0`,
          position: 'relative',
          touchAction: 'pan-y',
        }}
        {...gesture}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: PLOT_INSET, bottom: 0, left: PLOT_INSET }}
            // Recharts 3 ships an accessibility layer by default: it puts role="application"
            // and tabindex="0" on the SVG surface and tabindex="-1" on every internal layer.
            // Touching the chart focuses those, and the app's global focus ring then paints
            // amber boxes around the surface and its layers — which is what you see when you
            // put a finger on it.
            //
            // Off, because it is redundant here rather than merely inconvenient. It exists to
            // give keyboard and screen-reader users a way into the chart, and this app has its
            // own: the date, calories and macros for the selected day are real DOM text above
            // the plot, not values locked inside the SVG. The chart draws the shape; the
            // numbers are already readable without it.
            accessibilityLayer={false}
            /*
             * The chart draws; it does not listen.
             *
             * Recharts tracks the pointer itself and keeps its own notion of which index is
             * active — separate from `selected`, and updated on contact rather than on the
             * deliberate drag the wrapper waits for. Two active indices on one plot is what
             * put a lit bar on one day and a marked protein point on another, and no amount
             * of turning off individual highlights fixes the cause of that.
             *
             * With pointer events off the surface, every touch lands on the wrapper div and
             * `selected` is the only state there is. Nothing is lost: the wrapper is the
             * element the scrub gesture reads, and events from children bubble to it anyway.
             */
            style={{ pointerEvents: 'none' }}
          >
            {/* Both axes exist for scaling; only the date axis is drawn. Gridlines are the
                reference line below and nothing else — a grid of boxes is a chart cliché that
                adds ink without adding a reading. */}
            <YAxis yAxisId="kcal" hide domain={[0, 'dataMax']} />
            <YAxis yAxisId="protein" hide domain={[0, 'dataMax']} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              interval={Math.max(Math.floor(data.length / 4) - 1, 0)}
              tick={{ fill: 'var(--ink-faint)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              tickFormatter={shortDay}
            />

            <ReferenceLine
              yAxisId="kcal"
              y={avgCalories}
              stroke="var(--ink-faint)"
              strokeDasharray="2 4"
              strokeWidth={1}
            />

            <Bar
              yAxisId="kcal"
              dataKey="calories"
              // Square caps. A rounded bar is a decoration that makes short bars read as taller
              // than they are.
              radius={0}
              maxBarSize={14}
              isAnimationActive={false}
              // The bar's equivalent of activeDot — Recharts 3 restyles whichever bar it
              // thinks is active. `shape` below already decides how a bar looks, and it reads
              // `selected`, which is the one source of truth for that.
              activeBar={false}
              shape={(props: unknown) => {
                const { x, y, width, height, index } = props as {
                  x: number;
                  y: number;
                  width: number;
                  height: number;
                  index: number;
                };
                const active = index === selected;
                const day = data[index];
                // A day with no meals recorded gets a baseline tick, not a zero-height bar and
                // not a gap. "I ate nothing" and "I logged nothing" are different claims, and
                // only one of them is ever true here.
                if (!day?.logged) {
                  return (
                    <rect
                      x={x}
                      y={y + height - 1}
                      width={width}
                      height={1}
                      fill={active ? 'var(--signal)' : 'var(--rule)'}
                    />
                  );
                }
                return (
                  <rect
                    x={x}
                    y={y}
                    width={width}
                    height={Math.max(height, 1)}
                    fill={active ? 'var(--signal)' : 'var(--signal-low)'}
                  />
                );
              }}
            />

            {/* Linear, not monotone. A smoothed spline through daily totals overshoots between
                points and invents intake on days that sit between two highs — it draws a curve
                where the data is a sequence of separate days. `connectNulls={false}` breaks the
                line across unlogged days rather than ruling straight through them. */}
            <Line
              yAxisId="protein"
              type="linear"
              dataKey="protein"
              // The macro ramp, not --ink-dim. The bars beside it are calories in amber, so the
              // two series on this plot are now the two things they are everywhere else.
              stroke={macroColor('protein')}
              strokeWidth={1.25}
              dot={false}
              // Recharts marks the active point with a circle by default. Belt and braces
              // alongside pointer-events above: this is the thing that was drawing it, and
              // saying so explicitly means a future change to that style cannot bring it back.
              // The selected day's protein is reported as text above the plot regardless.
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Says what the average is over. "30-day avg" across 22 logged days is a different
          number from the one that phrase implies, and the gap is exactly the thing worth
          knowing.

          It also does the legend's old job now. A swatch row underneath used to name the two
          series — an amber square for kcal, a stone one for protein — which was a whole extra
          line of chrome spent restating a mapping the chart could carry itself. Tinting the
          UNITS here says the same thing in the place the numbers already are: amber is
          calories, the macro stone is protein, and those are the two colours in the plot above.
          Same treatment as the P/C/F readout at the top of this chart and the letters in the
          food list below it.

          The unit is tinted and the number is not, which is the rule everywhere macros are
          written in this app: the value leads and the label annotates it. */}
      <div className="cap" style={{ marginTop: 8, color: 'var(--ink-dim)' }}>
        Avg {int(avgCalories)}{' '}
        {/* --signal, not the --signal-low the bars are drawn in. That tone is for a filled area
            on a dark ground; at 11px it sits below --ink-faint, which DESIGN.md fixes as the
            floor for anything you have to read. */}
        <span style={{ color: 'var(--signal)' }}>kcal</span> · {dec(avgProtein, 0)}{' '}
        <span style={{ color: macroColor('protein') }}>P</span>
        <span style={{ color: 'var(--ink-faint)' }}>
          {' '}
          · {loggedDays.length}/{data.length} days
        </span>
      </div>
    </div>
  );
}
