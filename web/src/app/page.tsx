import { getBodyweight, getMuscleCoverage, getNutrition, getRecency, getReview, n, n0, type RecencyRow, type FoodRow } from '@/lib/backend';
import { Masthead, Section, Rule, Figure, Empty, Fault, Swatch } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { WeightChart } from '@/components/WeightChart';
import { Coverage } from '@/components/Coverage';
import { PATTERN_ROWS, patternColor, patternLabel } from '@/lib/patterns';
import { MACROS, macroCalories } from '@/lib/macros';
import { agoLabel, dayLabel, int, isoWeek, toIso } from '@/lib/format';
import { nowInAppTz, todayInAppTz } from '@/lib/time';
import { signOut } from '@/app/login/actions';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * The five-second check-in.
 *
 * Rhythm down the page is deliberate: one big figure, then a chart, then a ledger of bars,
 * then a line of small numbers. Four identical blocks would be wallpaper — the eye needs to
 * be told what the focal point is, and here it is bodyweight.
 */
export default async function Now() {
  // Fetched together rather than in sequence; four round trips to Vercel add up on cellular.
  const [weight, coverage, nutrition, review, recency] = await Promise.all([
    getBodyweight(90),
    getMuscleCoverage(),
    getNutrition(7),
    getReview(25),
    getRecency(),
  ]);

  // Not `new Date()`. This is a Server Component on Vercel, where that is UTC.
  const now = nowInAppTz();

  return (
    <main className="screen">
      <Masthead left={dayLabel(toIso(now))} right={`WK ${isoWeek(now)}`} />

      {/* Sections are raised into place as they come into view, each a beat after the last.
          The delays are small on purpose — this is a screen you check for five seconds, so the
          whole page has to be settled before you have finished looking at the first number. */}
      {/* First thing on the screen, because it is the only thing here that tells you what to
          DO. It was previously three scrolls down a tab you had to open on purpose. */}
      <Reveal>
        <Ready result={recency} />
      </Reveal>
      <Rule />
      <Reveal delay={60}>
        <Bodyweight result={weight} />
      </Reveal>
      <Rule />
      <Reveal delay={120}>
        <Fuel result={nutrition} />
      </Reveal>
      <Rule />
      <Reveal delay={180}>
        {coverage.ok ? (
          <Coverage rows={coverage.rows} />
        ) : (
          <Section label="Coverage">
            <Fault error={coverage.error} />
          </Section>
        )}
      </Reveal>

      {review.ok && review.rows.length > 0 ? (
        <Reveal delay={240}>
          <Rule />
          <Review rows={review.rows} />
        </Reveal>
      ) : null}

      {/* Bottom of the last screen, deliberately unremarkable. Signing out means typing the
          password again on a phone, so it should be findable and never nearly-tapped. */}
      <form action={signOut} style={{ marginTop: 48, marginBottom: 24 }}>
        <button
          type="submit"
          className="cap"
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--ink-faint)' }}
        >
          Sign out
        </button>
      </form>
    </main>
  );
}

// --- Sections ---------------------------------------------------------------------------

/**
 * How many foods are still running on estimated macros.
 *
 * Built like every other block on this screen — a Section label, one mono figure, a caption —
 * rather than the lone sans-serif list row it used to be, which was the only thing on Now
 * that did not look like the rest of the app.
 */
function Review({ rows }: { rows: FoodRow[] }) {
  return (
    <Link href="/food" className="pressable" style={{ display: 'block' }}>
      <Section label="Needs review">
        {/* --flag, not the pattern palette: this is the app's established "estimated, needs
            fixing" colour, the same one the review queue and low-confidence dishes use. */}
        <Figure
          value={String(rows.length)}
          unit={rows.length === 1 ? 'FOOD' : 'FOODS'}
          count={rows.length}
          tone="var(--flag)"
        />
        <div className="cap" style={{ marginTop: 12, color: 'var(--ink-faint)' }}>
          Tap to correct their macros
        </div>
      </Section>
    </Link>
  );
}

function Bodyweight({ result }: { result: Awaited<ReturnType<typeof getBodyweight>> }) {
  if (!result.ok) {
    return (
      <Section label="Bodyweight">
        <Fault error={result.error} />
      </Section>
    );
  }
  // The section itself is a Client Component now: reading a specific day off the line needs
  // pointer state, and the empty and error states live close to the thing that renders them.
  return <WeightChart rows={result.rows} />;
}

function Fuel({ result }: { result: Awaited<ReturnType<typeof getNutrition>> }) {
  if (!result.ok) {
    return (
      <Section label="Fuel">
        <Fault error={result.error} />
      </Section>
    );
  }

  // Must be the same day the backend stamped these rows with, or the lookup misses and Fuel
  // reads as "nothing logged today" on an evening when plenty was.
  const row = result.rows.find((r) => r.date === todayInAppTz());

  if (!row) {
    // A blank rather than a zero. "0 kcal" is a claim about today that isn't true; nothing
    // having been logged yet is the actual state.
    const last = result.rows[result.rows.length - 1];
    return (
      <Section label="Fuel" aside="Today">
        <Empty>
          Nothing logged today.
          {last ? ` Last entry ${agoLabel(last.date).toLowerCase()}, ${int(n(last.calories))} kcal.` : ''}
        </Empty>
      </Section>
    );
  }

  const grams = { protein: n0(row.protein_g), carbs: n0(row.carbs_g), fat: n0(row.fat_g) };

  // Macro grams are not comparable by weight — a gram of fat carries more than twice the
  // energy of a gram of protein. The split bar is drawn in calories so its widths mean
  // something; the labels stay in grams because that is how food is logged. The conversion
  // lives on MACROS beside the colours, since a bar drawn in one and coloured from the other
  // is exactly where the two would drift apart.
  const split = MACROS.map((m) => ({ ...m, grams: grams[m.key], kcal: macroCalories(m.key, grams[m.key]) }));
  const total = split.reduce((sum, m) => sum + m.kcal, 0);

  return (
    /*
     * "Today" leads the aside, and it is not decoration.
     *
     * Every other section on this screen reads a window — 28 days of coverage, 90 of bodyweight
     * — and this one reads a single day. It used to say so only when the day was EMPTY: with
     * food logged the aside became "3 items" and nothing on screen said the calories above it
     * were today's rather than an average or a total. The one section actually scoped to the day
     * was the one that stopped mentioning it as soon as it had something to report.
     */
    <Section label="Fuel" aside={`Today · ${row.items} item${row.items === 1 ? '' : 's'}`}>
      <Figure value={int(n(row.calories))} unit="KCAL" count={n(row.calories)} />

      {total > 0 ? (
        <div style={{ display: 'flex', height: 8, marginTop: 16, gap: 2 }}>
          {split.map((m) => (
            <div key={m.key} style={{ flex: `${(m.kcal / total) * 100} 0 0`, background: m.color }} />
          ))}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 22, marginTop: 12 }}>
        {split.map((m) => (
          <Macro key={m.key} label={m.label} grams={m.grams} tone={m.color} />
        ))}
      </div>
    </Section>
  );
}

function Macro({ label, grams, tone }: { label: string; grams: number; tone: string }) {
  return (
    <div>
      <div className="cap" style={{ color: 'var(--ink-faint)' }}>
        <Swatch tone={tone} />
        {label}
      </div>
      <div className="mono" style={{ fontSize: 'var(--t-lg)', marginTop: 2 }}>
        {int(grams)}
        <span style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-dim)', marginLeft: 3 }}>G</span>
      </div>
    </div>
  );
}

/**
 * What you have and have not trained lately, in the calendar's colours and order.
 *
 * This replaced a volume-by-muscle-region chart. Two reasons: the app already reports volume on
 * three other screens, and that chart spoke a taxonomy (`arms`, `back`) no other screen uses —
 * so the one place you looked first disagreed with everywhere you went next.
 */
function Ready({ result }: { result: Awaited<ReturnType<typeof getRecency>> }) {
  if (!result.ok) {
    return (
      <Section label="Last trained">
        <Fault error={result.error} />
      </Section>
    );
  }
  if (result.rows.length === 0) {
    return (
      <Section label="Last trained">
        <Empty>No sessions recorded yet.</Empty>
      </Section>
    );
  }

  /*
   * Fixed pattern order, matching Volume below and the coverage matrix on History.
   *
   * The query returns these sorted by longest gap first, which is the right order for the MCP
   * tool that shares it — a model asking what to train next wants the most neglected pattern
   * first. It is the wrong order for a row of five columns you read every day: the labels
   * swapped places whenever anything was logged, so recognising a column meant reading it
   * rather than knowing where it lives. Position is the fastest channel on this screen and it
   * was being spent on a ranking that the numbers already state.
   *
   * Nothing about urgency is lost. The day count is the reading, and overdue columns are
   * flagged by colour and counted in the aside.
   */
  const byPattern = new Map(result.rows.map((r) => [r.pattern, r]));
  const ordered = PATTERN_ROWS.map((p) => byPattern.get(p.key)).filter(
    (row): row is RecencyRow => row !== undefined,
  );

  const overdue = ordered.filter((r) => r.days_since === null || r.days_since >= 7);

  return (
    <Section
      label="Last trained"
      aside={overdue.length > 0 ? `${overdue.length} over a week` : 'all within a week'}
    >
      <div style={{ display: 'flex', gap: 10 }}>
        {ordered.map((row) => (
          <Gap key={row.pattern} row={row} />
        ))}
      </div>
    </Section>
  );
}

function Gap({ row }: { row: RecencyRow }) {
  const days = row.days_since;
  const overdue = days === null || days >= 7;

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        className="cap"
        style={{
          color: 'var(--ink-faint)',
          borderBottom: `2px solid ${patternColor(row.pattern)}`,
          paddingBottom: 3,
        }}
      >
        {patternLabel(row.pattern)}
      </div>
      <div
        className="mono"
        style={{ fontSize: 'var(--t-lg)', marginTop: 5, color: overdue ? 'var(--flag)' : 'var(--ink)' }}
      >
        {days === null ? '—' : days === 0 ? 'today' : days}
        {days !== null && days > 0 ? (
          <span style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-dim)' }}>d</span>
        ) : null}
      </div>
    </div>
  );
}
