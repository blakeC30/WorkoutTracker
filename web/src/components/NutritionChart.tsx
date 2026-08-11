'use client';

import { useCallback, useRef, useState } from 'react';
import { Bar, ComposedChart, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { NutritionRow } from '@/lib/backend';
import { Swatch } from '@/components/ui';
import { dec, int, shortDay } from '@/lib/format';

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
function buildSeries(rows: NutritionRow[], days: number): Point[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: Point[] = [];
  const cursor = new Date();
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
      const inset = 6; // matches the chart's left/right margin
      const usable = box.width - inset * 2;
      const ratio = (clientX - box.left - inset) / (usable || 1);
      const index = Math.round(ratio * (data.length - 1));
      setSelected(Math.min(Math.max(index, 0), data.length - 1));
    },
    [data.length],
  );

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
            <>
              <div>{point.protein} P</div>
              <div>{point.carbs} C</div>
              <div>{point.fat} F</div>
            </>
          ) : (
            <div style={{ color: 'var(--ink-faint)' }}>Not logged</div>
          )}
        </div>
      </div>

      <div
        ref={plot}
        className="chart-in"
        style={{ height: 168, margin: '14px -6px 0', position: 'relative', touchAction: 'pan-y' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e.clientX);
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 6 }}>
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
              stroke="var(--ink-dim)"
              strokeWidth={1.25}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Says what the average is over. "30-day avg" across 22 logged days is a different
          number from the one that phrase implies, and the gap is exactly the thing worth
          knowing. */}
      <div className="cap" style={{ marginTop: 8, color: 'var(--ink-dim)' }}>
        Avg {int(avgCalories)} kcal · {dec(avgProtein, 0)} P
        <span style={{ color: 'var(--ink-faint)' }}>
          {' '}
          · {loggedDays.length}/{data.length} days
        </span>
      </div>

      <div
        className="cap"
        style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, color: 'var(--ink-faint)' }}
      >
        {/* The chart carries two series in two units, so it has to say which is which. The
            dashed line is the period average, drawn once rather than as a full grid. */}
        <span>
          <Swatch tone="var(--signal-low)" />
          kcal
          <span style={{ marginLeft: 12 }}>
            <Swatch tone="var(--ink-dim)" />
            protein
          </span>
        </span>
        <span>Drag to read</span>
      </div>
    </div>
  );
}
