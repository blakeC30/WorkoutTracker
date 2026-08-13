import { getBodyweight, getMuscleCoverage, getNutrition, getRecency, getReview, n, n0, type RecencyRow, type FoodRow, type MuscleCoverageRow } from '@/lib/backend';
import type { CSSProperties } from 'react';
import { Masthead, Section, Rule, Figure, Empty, Fault, Swatch } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { WeightChart } from '@/components/WeightChart';
import { PATTERN_ROWS, patternColor, patternLabel } from '@/lib/patterns';
import { groupByRegion } from '@/lib/muscles';
import { MACROS, macroCalories } from '@/lib/macros';
import { agoLabel, dayLabel, int, isoWeek, toIso } from '@/lib/format';
import { nowInAppTz, todayInAppTz } from '@/lib/time';
import { signOut } from '@/app/login/actions';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * The window Coverage asks over.
 *
 * One constant because the number was previously written in four places — once as the argument
 * to the query and three times as the "28d" label — and only the two states nobody sees, the
 * error and the empty one, actually carried it. The section a person reads every day said
 * "8/20 muscles" and never mentioned a window at all, so there was no way to tell whether it
 * meant this week, this month, or ever.
 */
const COVERAGE_DAYS = 28;

/**
 * The five-second check-in.
 *
 * Rhythm down the page is deliberate: one big figure, then a chart, then a ledger of bars,
 * then a line of small numbers. Four identical blocks would be wallpaper — the eye needs to
 * be told what the focal point is, and here it is bodyweight.
 */
export default async function Today() {
  // Fetched together rather than in sequence; four round trips to Vercel add up on cellular.
  const [weight, coverage, nutrition, review, recency] = await Promise.all([
    getBodyweight(90),
    getMuscleCoverage(COVERAGE_DAYS),
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
        <Coverage result={coverage} />
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
 * rather than the lone sans-serif list row it used to be, which was the only thing on Today
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
    <Section label="Fuel" aside={`${row.items} item${row.items === 1 ? '' : 's'}`}>
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

/**
 * Which muscles are being trained, which are only passengers, and which are cold.
 *
 * This replaced a four-week volume-by-pattern chart, and the reason is worth keeping. That
 * section reported a magnitude with nothing to compare it against: no target exists in the
 * schema and it queried a single window, so its only available comparison was between patterns
 * — and tonnage between patterns mostly encodes which muscles are big. A leg press will always
 * dwarf a lateral raise. The app had already retired that same argument once, when the bars on
 * the exercises list became sparklines.
 *
 * It also asked a four-week question on a screen otherwise about now, which is what History is
 * for, and it answered "what am I neglecting" a third time after the pattern strip above and
 * the coverage matrix on History — worse than either, because its units did not convert.
 *
 * Coverage answers something nothing else in the app can. Patterns say a pull happened; only
 * this says the lats and biceps got it while the traps and rear delts did not. And the
 * primary/secondary split says the thing a volume total actively hides: arms and shoulders can
 * carry eleven thousand pounds of work across four weeks without one movement ever being FOR
 * them, which by tonnage looks like plenty and by intent is nothing.
 */
function Coverage({ result }: { result: Awaited<ReturnType<typeof getMuscleCoverage>> }) {
  if (!result.ok) {
    return (
      <Section label="Coverage" aside={`${COVERAGE_DAYS}d`}>
        <Fault error={result.error} />
      </Section>
    );
  }
  if (result.rows.length === 0) {
    return (
      <Section label="Coverage" aside={`${COVERAGE_DAYS}d`}>
        <Empty>No muscles catalogued yet. They arrive with your first exercise.</Empty>
      </Section>
    );
  }

  const regions = groupByRegion(result.rows);
  const worked = result.rows.filter((row) => row.sessions > 0);

  // Regions carrying real work where nothing was ever the target. The reading this section was
  // built for, so it is stated in words rather than left to be inferred from dimmer marks.
  const passengers = regions.filter(
    (region) =>
      region.rows.some((row) => row.sessions > 0) &&
      region.rows.every((row) => row.primary_sessions === 0),
  );

  return (
    <Section label="Coverage" aside={`${worked.length}/${result.rows.length} muscles · ${COVERAGE_DAYS}d`}>
      {/* No gap between rows now that each carries its own 40px tap height. Adding one on top
          of that would space them like paragraphs rather than like a list. */}
      <div>
        {regions.map((region, i) => (
          <RegionRow key={region.key} region={region} index={i} />
        ))}
      </div>

      {/* Two lines at most, and only when they have something to say. */}
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {passengers.length > 0 ? (
          <div className="cap" style={{ color: 'var(--flag)' }}>
            {passengers.map((r) => r.label).join(' · ')} — worked, never targeted
          </div>
        ) : null}
        <div className="cap" style={{ color: 'var(--ink-faint)' }}>
          Filled = trained directly · hollow = assisting only · tap a row for its muscles
        </div>
      </div>
    </Section>
  );
}

/**
 * One region: its name, a mark per muscle, how many were reached — and its muscles on tap.
 *
 * A mark per muscle rather than a bar, because the question is "how many of these six" and a
 * bar answering it would be a bar of a count — the marks ARE the count, and they carry which
 * ones as well as how many. The same reasoning as the calendar squares, and the same three
 * states: lit, half-lit, and a track that holds the position so a region with one muscle and a
 * region with six stay comparable down the column.
 *
 * The marks say how many and structurally cannot say WHICH, so the row itself opens. This
 * replaced one list at the foot of the section holding all twenty names grouped by state: it
 * answered the question, but only after you had already pointed at a row and were then made to
 * find that region again inside a list somewhere else. Tapping the thing you are asking about
 * and getting its answer directly underneath is the shorter path, and it means each answer is
 * four names rather than twenty.
 */
function RegionRow({
  region,
  index,
}: {
  region: { key: string; label: string; rows: MuscleCoverageRow[] };
  index: number;
}) {
  const reached = region.rows.filter((row) => row.sessions > 0).length;
  // Sorted so the marks read most-trained first and a region's lit end is always on the left.
  // Unsorted, the alphabetical order of muscle names put the gaps in arbitrary places and the
  // row's shape stopped meaning anything at a glance. The detail below is built from the same
  // sorted array, so the marks and the names cannot fall into different orders.
  const marks = [...region.rows].sort(
    (a, b) => b.primary_sessions - a.primary_sessions || b.sessions - a.sessions,
  );

  // Never trained at all, in the whole history — not merely quiet for four weeks. Worth
  // distinguishing: one is a lapse and the other is a movement you have never programmed.
  const untouched = region.rows.every((row) => row.days_since_ever === null);

  const states = [
    { label: 'Trained', tone: 'var(--ink)', rows: marks.filter((r) => r.primary_sessions > 0) },
    {
      label: 'Assisting',
      tone: 'var(--ink-dim)',
      rows: marks.filter((r) => r.sessions > 0 && r.primary_sessions === 0),
    },
    { label: 'Not touched', tone: 'var(--flag)', rows: marks.filter((r) => r.sessions === 0) },
  ].filter((state) => state.rows.length > 0);

  return (
    <details className="disclosure is-row">
      <summary className="pressable">
        <span className="cap" style={{ color: reached > 0 ? 'var(--ink-dim)' : 'var(--ink-faint)' }}>
          {region.label}
        </span>

        <span style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          {marks.map((row, i) => (
            <span
              key={row.muscle}
              className={row.sessions > 0 ? 'draw-x' : undefined}
              style={
                {
                  flex: 1,
                  height: row.sessions > 0 ? 8 : 1,
                  background:
                    row.primary_sessions > 0
                      ? 'var(--ink)'
                      : row.sessions > 0
                        ? 'var(--ink-faint)'
                        : 'var(--rule)',
                  '--delay': `${index * 60 + i * 25}ms`,
                } as CSSProperties
              }
            />
          ))}
        </span>

        <span
          className="mono"
          style={{
            fontSize: 'var(--t-cap)',
            textAlign: 'right',
            color: reached > 0 ? 'var(--ink)' : 'var(--flag)',
          }}
        >
          {untouched ? 'never' : `${reached}/${region.rows.length}`}
        </span>
      </summary>

      {/* Indented to where the marks begin, so it reads as belonging to the row above rather
          than as a new block. One line per state that has anything in it — a region with nothing
          untouched should not carry an empty "Not touched" saying so. */}
      <div style={{ paddingLeft: 86, paddingBottom: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {states.map((state) => (
          <div key={state.label} style={{ fontSize: 'var(--t-sm)', lineHeight: 1.45 }}>
            <span className="cap" style={{ color: state.tone }}>
              {state.label}
            </span>{' '}
            <span className="selectable" style={{ color: 'var(--ink-dim)' }}>
              {state.rows.map((row) => row.muscle).join(', ')}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}
