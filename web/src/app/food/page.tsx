import { getFoods, getNutrition, n, type FoodRow } from '@/lib/backend';
import { Masthead, Section, Rule, Empty, Fault } from '@/components/ui';
import { NutritionChart } from '@/components/NutritionChart';
import { FoodEditor } from '@/components/FoodEditor';
import { Reveal } from '@/components/motion';
import { agoLabel, int } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Food() {
  const [nutrition, foods] = await Promise.all([getNutrition(30), getFoods(30)]);

  return (
    <main className="screen">
      <Masthead left="Food" right="30 days" />

      <Reveal>
        {nutrition.ok ? (
          nutrition.rows.length > 0 ? (
            <NutritionChart rows={nutrition.rows} />
          ) : (
            <Empty>No meals logged in the last 30 days.</Empty>
          )
        ) : (
          <Fault error={nutrition.error} />
        )}
      </Reveal>

      <Rule />

      <Reveal delay={80}>
        <Foods result={foods} />
      </Reveal>
    </main>
  );
}

/**
 * Everything you have eaten in the window, most frequent first.
 *
 * This replaced a list of only the foods needing correction. That made Food the one tab unable
 * to browse its own catalog — no way to look up what something contains, and no way to fix a
 * food that was not already flagged. Exercises browses the other catalog completely, and these
 * two tables are the same kind of thing.
 *
 * Merging the review queue in rather than adding a second list: ordered by frequency and ordered
 * by uncertainty, the two would have shown the same staples inches apart. The flag now travels
 * with the row, and the section header counts how many carry it.
 */
function Foods({ result }: { result: Awaited<ReturnType<typeof getFoods>> }) {
  if (!result.ok) {
    return (
      <Section label="Foods">
        <Fault error={result.error} />
      </Section>
    );
  }

  if (result.rows.length === 0) {
    return (
      <Section label="Foods">
        <Empty>No meals logged in the last 30 days. Foods appear here as you eat them.</Empty>
      </Section>
    );
  }

  const estimated = result.rows.filter(isEstimated);

  return (
    <Section
      label="Foods"
      aside={
        estimated.length > 0
          ? `${estimated.length} of ${result.rows.length} estimated`
          : `${result.rows.length} · all confirmed`
      }
    >
      {result.rows.map((row) => (
        <Item key={row.id} row={row} />
      ))}

      <p style={{ marginTop: 18, color: 'var(--ink-faint)', fontSize: 'var(--t-sm)', lineHeight: 1.5 }}>
        Tap a row to correct its macros. Every past meal using that food moves with it, including
        the days in the chart above.
      </p>
    </Section>
  );
}

/** A guess rather than a measurement — the only thing that earns the flag colour here. */
function isEstimated(row: FoodRow) {
  return row.calories === null || row.confidence === 'low' || row.confidence === 'medium';
}

function Item({ row }: { row: FoodRow }) {
  const estimated = isEstimated(row);

  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--rule)' }}>
      {/* The row itself opens the editor. Every food is now editable, not just the flagged ones
          — correcting a measured food you weighed more carefully is the same operation. */}
      <FoodEditor row={row}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <span className="selectable" style={{ lineHeight: 1.25, minWidth: 0 }}>
            {row.name}
            {row.unit_label ? (
              <span style={{ color: 'var(--ink-faint)', fontSize: 'var(--t-sm)' }}> / {row.unit_label}</span>
            ) : null}
          </span>
          <span
            className="mono"
            style={{ fontSize: 'var(--t-base)', flexShrink: 0, color: estimated ? 'var(--flag)' : 'var(--ink)' }}
          >
            {row.calories === null ? '—' : int(n(row.calories))}
            <span style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-dim)', marginLeft: 3 }}>KCAL</span>
          </span>
        </div>

        <div
          className="mono"
          style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 'var(--t-cap)', color: 'var(--ink-faint)' }}
        >
          {/* Per unit, matching the number above — this is what the food IS, not what a
              particular meal contributed. */}
          <span>
            ×{row.times_eaten}
            {row.calories !== null
              ? ` · ${int(n(row.protein_g))} P ${int(n(row.carbs_g))} C ${int(n(row.fat_g))} F`
              : ''}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            {/* Only estimates are labelled. Marking the confirmed ones "high" too would put a
                tag on every row and leave the flag with nothing to stand out against. */}
            {estimated ? (
              <span style={{ color: 'var(--flag)' }}>
                {row.calories === null ? 'no macros' : row.confidence}
              </span>
            ) : null}
            <span>{agoLabel(row.last_eaten).toLowerCase()}</span>
          </span>
        </div>
      </FoodEditor>
    </div>
  );
}
