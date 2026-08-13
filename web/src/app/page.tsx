import { getBodyweight, getNutrition, getRecency, getReview, getVolumeByPattern, n, n0, type RecencyRow, type FoodRow, type PatternVolumeRow } from '@/lib/backend';
import { Masthead, Section, Rule, Figure, BarRow, Empty, Fault, Swatch } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { WeightChart } from '@/components/WeightChart';
import { PATTERN_ROWS, patternColor, patternLabel } from '@/lib/patterns';
import { MACROS, macroCalories } from '@/lib/macros';
import { agoLabel, compact, dayLabel, dec, int, isoWeek, toIso } from '@/lib/format';
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
export default async function Today() {
  // Fetched together rather than in sequence; four round trips to Vercel add up on cellular.
  const [weight, patterns, nutrition, review, recency] = await Promise.all([
    getBodyweight(90),
    getVolumeByPattern(28),
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
        <Volume result={patterns} />
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
 * Four weeks of work, by movement pattern, in whatever units it was recorded in.
 *
 * Bars are tonnage only, because tonnage is the one measure comparable between patterns. Reps,
 * miles and minutes each get named underneath rather than being folded in — converting between
 * them would need an invented exchange rate, and dropping them made a month of situps or a run
 * logged without a stopwatch look like nothing happened.
 */
function Volume({ result }: { result: Awaited<ReturnType<typeof getVolumeByPattern>> }) {
  if (!result.ok) {
    return (
      <Section label="Volume" aside="28d">
        <Fault error={result.error} />
      </Section>
    );
  }

  const byPattern = new Map(result.rows.map((r) => [r.pattern, r]));
  // PATTERN_ROWS, not PATTERNS: the five have calendar slots, but a list can carry the
  // catch-all too. Iterating the five dropped sports entirely — 75 minutes of basketball
  // reported as nothing at all.
  const trained = PATTERN_ROWS.map((p) => ({ pattern: p, row: byPattern.get(p.key) }))
    .filter((entry) => entry.row !== undefined)
    .map((entry) => ({ ...entry, measures: measuresOf(entry.row) }))
    // A pattern the query returned but which produced no measurable work at all — possible if
    // sets were logged with no reps, weight, distance or duration on any of them.
    .filter((entry) => entry.measures.length > 0);

  if (trained.length === 0) {
    return (
      <Section label="Volume" aside="28d">
        <Empty>Nothing logged in the last four weeks.</Empty>
      </Section>
    );
  }

  // The bar is tonnage and only tonnage, because tonnage is the one measure that means the same
  // thing from one pattern to the next. Patterns with none get a row with no bar, not no row.
  const tonnage = (entry: (typeof trained)[number]) => n0(entry.row?.volume_lbs);
  const max = Math.max(...trained.map(tonnage), 1);
  const total = trained.reduce((sum, entry) => sum + tonnage(entry), 0);

  return (
    <Section label="Volume" aside="28d">
      {trained.map((entry, i) => (
        <BarRow
          key={entry.pattern.key}
          index={i}
          label={
            <>
              {/* The swatch, not the bar, is what ties a row to its pattern colour. A row
                  measured in miles has no bar to be coloured, and losing the colour on exactly
                  the rows that are not tonnage would make the palette look like it encodes
                  "loaded" rather than "which pattern". */}
              <Swatch tone={entry.pattern.color} />
              {patternLabel(entry.pattern.key)}
            </>
          }
          value={tonnage(entry)}
          max={max}
          tone={entry.pattern.color}
          display={<Measures parts={entry.measures} />}
        />
      ))}

      {total > 0 ? (
        <div className="cap" style={{ marginTop: 10, textAlign: 'right', color: 'var(--ink-faint)' }}>
          {int(total)} lb lifted
        </div>
      ) : null}
    </Section>
  );
}

/** One measure a pattern actually recorded: a number and the unit it was recorded in. */
type Measure = { value: string; unit: string };

/**
 * Everything a pattern accumulated, in the units it accumulated it in.
 *
 * Deliberately not "the unit for this pattern". Core is not only planks — situps and crunches
 * are unloaded REPS while a weighted cable crunch is tonnage, so one pattern can legitimately
 * produce three measures in four weeks. Cardio is the same: a run may carry miles, minutes, or
 * both. Assuming one unit per pattern printed "Core — min" for a month of situps and
 * "3.0 mi · — min" for a run logged without a stopwatch.
 *
 * Tonnage leads when there is any, because it is the measure the bar beside it is drawn from.
 */
function measuresOf(row: PatternVolumeRow | undefined): Measure[] {
  const parts: Measure[] = [];
  const push = (value: number | null, format: (v: number) => string, unit: string) => {
    if (value !== null && value > 0) parts.push({ value: format(value), unit });
  };
  push(n(row?.volume_lbs), (v) => compact(v), 'lb');
  push(n(row?.bodyweight_reps), (v) => int(v), 'reps');
  push(n(row?.distance_mi), (v) => dec(v, 1), 'mi');
  push(n(row?.duration_min), (v) => int(v), 'min');
  return parts;
}

/**
 * A pattern's measures on one line: `2.7k lb · 4 reps`.
 *
 * This is the fix for the section's oldest wrong idea. Tonnage used to be drawn as bars and
 * everything else listed separately underneath, which meant a pattern doing both appeared
 * TWICE — pull showed up as a 2.7k bar for barbell rows and again below as "4 reps" for
 * pull-ups, reading as two different patterns that happened to share a name. A pattern is one
 * thing and gets one row; the units it was measured in belong inside that row, not in a second
 * list keyed by the same name.
 *
 * Units stay dimmed so a scan down the column reads the numbers first, and the separator is the
 * same interpunct the app uses everywhere else for "and also".
 */
function Measures({ parts }: { parts: Measure[] }) {
  return (
    <>
      {parts.map((part, i) => (
        <span key={part.unit} style={{ whiteSpace: 'nowrap' }}>
          {i > 0 ? <span style={{ color: 'var(--ink-faint)' }}> · </span> : null}
          {part.value}
          <span style={{ color: 'var(--ink-dim)', marginLeft: 3 }}>{part.unit}</span>
        </span>
      ))}
    </>
  );
}

