import { getNutrition, getReview, n, type ReviewRow } from '@/lib/backend';
import { Masthead, Section, Rule, Empty, Fault } from '@/components/ui';
import { NutritionChart } from '@/components/NutritionChart';
import { FoodEditor } from '@/components/FoodEditor';
import { Reveal } from '@/components/motion';
import { agoLabel, int } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Food() {
  const [nutrition, review] = await Promise.all([getNutrition(30), getReview(25)]);

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
        <Review result={review} />
      </Reveal>
    </main>
  );
}

/**
 * The foods whose macros are guesses, ordered by how much they actually move the totals.
 *
 * This is the screen's only call to action, and it is the reason the whole catalog model
 * exists: fixing one row here corrects every meal ever logged with it, including past days.
 * Ranking by calories contributed rather than by confidence alone puts the work where it
 * changes a number — a rough estimate eaten twenty times is worth an afternoon; one eaten once
 * is not worth the tap.
 */
function Review({ result }: { result: Awaited<ReturnType<typeof getReview>> }) {
  if (!result.ok) {
    return (
      <Section label="Needs review">
        <Fault error={result.error} />
      </Section>
    );
  }

  if (result.rows.length === 0) {
    return (
      <Section label="Needs review">
        <Empty>Every food you&apos;ve eaten has macros you trust. Nothing to correct.</Empty>
      </Section>
    );
  }

  return (
    <Section label="Needs review" aside={`${result.rows.length} foods`}>
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

function Item({ row }: { row: ReviewRow }) {
  const low = row.confidence === 'low' || row.calories === null;

  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--rule)' }}>
      {/* The row itself opens the editor. The queue used to end at "this number is wrong" and
          require a conversation elsewhere to fix it; this closes the loop where you're standing. */}
      <FoodEditor row={row}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="selectable" style={{ lineHeight: 1.25, minWidth: 0 }}>
          {row.name}
          {row.unit_label ? (
            <span style={{ color: 'var(--ink-faint)', fontSize: 'var(--t-sm)' }}> / {row.unit_label}</span>
          ) : null}
        </span>
        <span
          className="cap"
          style={{
            color: low ? 'var(--flag)' : 'var(--ink-dim)',
            // A rule under the word rather than a filled badge. A pill here would be the fourth
            // shape on the screen for no gain in meaning.
            borderBottom: `1px solid ${low ? 'var(--flag)' : 'var(--rule)'}`,
            paddingBottom: 1,
            flexShrink: 0,
          }}
        >
          {row.calories === null ? 'No macros' : row.confidence}
        </span>
      </div>

      <div
        className="mono"
        style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 'var(--t-cap)', color: 'var(--ink-faint)' }}
      >
        <span style={{ color: 'var(--ink-dim)' }}>
          {row.calories === null ? '— kcal' : `${int(n(row.calories))} kcal`}
        </span>
        <span>{row.protein_g === null ? '' : `${int(n(row.protein_g))} P`}</span>
        <span style={{ marginLeft: 'auto' }}>
          ×{row.times_eaten} · {int(n(row.total_calories))} total
        </span>
        <span>{agoLabel(row.last_eaten)}</span>
      </div>
      </FoodEditor>
    </div>
  );
}
