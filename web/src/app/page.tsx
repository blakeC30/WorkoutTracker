import { getBodyweight, getNutrition, getRecency, getReview, getVolumeByPattern, n, n0, type PatternVolumeRow, type RecencyRow } from '@/lib/backend';
import { Masthead, Section, Rule, Figure, Delta, BarRow, Sparkline, Empty, Fault, Row, Swatch } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { PATTERNS, patternColor, patternLabel } from '@/lib/patterns';
import { agoLabel, compact, dayLabel, dec, int, isoWeek, toIso } from '@/lib/format';
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

  const now = new Date();

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
          <Link href="/food" className="pressable" style={{ display: 'block' }}>
            <Row
              name={<span style={{ color: 'var(--flag)' }}>{review.rows.length} foods need review</span>}
              meta={<span className="cap">Macros are estimates</span>}
              right={<span className="mono" style={{ color: 'var(--ink-faint)' }}>→</span>}
              style={{ borderTop: 'none' }}
            />
          </Link>
        </Reveal>
      ) : null}
    </main>
  );
}

// --- Sections ---------------------------------------------------------------------------

function Bodyweight({ result }: { result: Awaited<ReturnType<typeof getBodyweight>> }) {
  if (!result.ok) {
    return (
      <Section label="Bodyweight">
        <Fault error={result.error} />
      </Section>
    );
  }

  const rows = result.rows;
  if (rows.length === 0) {
    return (
      <Section label="Bodyweight">
        <Empty>No weigh-ins in the last 90 days. Tell Claude your weight and it lands here.</Empty>
      </Section>
    );
  }

  const latest = rows[rows.length - 1];
  const current = n(latest.weight_lbs);
  const smoothed = n(latest.rolling_7d);

  // Compared against the smoothed line, not against the raw reading 30 days ago — one heavy
  // dinner four weeks ago should not be the baseline the whole trend is measured from.
  const monthAgo = rows.find((r) => daysBetween(r.date, latest.date) <= 30) ?? rows[0];
  const change = smoothed !== null && n(monthAgo.rolling_7d) !== null ? smoothed - n(monthAgo.rolling_7d)! : null;

  // The rolling average is what the sparkline draws. Daily noise is a couple of pounds either
  // way and would bury a trend this shallow.
  const series = rows.map((r) => n(r.rolling_7d)).filter((v): v is number => v !== null);

  return (
    <Section label="Bodyweight" aside={agoLabel(latest.date)}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <Figure value={dec(current)} unit="LB" size="var(--t-3xl)" count={current} decimals={1} />
        <Delta value={change} unit="lb" over="30d" />
      </div>

      <div style={{ marginTop: 16 }}>
        <Sparkline points={series} height={54} />
      </div>

      <div className="cap" style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
        <span>7-day avg {dec(smoothed)}</span>
        <span style={{ color: 'var(--ink-faint)' }}>{rows.length} weigh-ins / 90d</span>
      </div>
    </Section>
  );
}

function Fuel({ result }: { result: Awaited<ReturnType<typeof getNutrition>> }) {
  if (!result.ok) {
    return (
      <Section label="Fuel">
        <Fault error={result.error} />
      </Section>
    );
  }

  const today = toIso(new Date());
  const row = result.rows.find((r) => r.date === today);

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

  const protein = n0(row.protein_g);
  const carbs = n0(row.carbs_g);
  const fat = n0(row.fat_g);
  // Macro grams are not comparable by weight — a gram of fat carries more than twice the
  // energy of a gram of protein. The split bar is drawn in calories so its widths mean
  // something; the labels stay in grams because that is how food is logged.
  const kcal = [protein * 4, carbs * 4, fat * 9];
  const total = kcal.reduce((a, b) => a + b, 0);
  const tones = ['var(--signal)', 'var(--ink-dim)', 'var(--signal-low)'];

  return (
    <Section label="Fuel" aside={`${row.items} item${row.items === 1 ? '' : 's'}`}>
      <Figure value={int(n(row.calories))} unit="KCAL" count={n(row.calories)} />

      {total > 0 ? (
        <div style={{ display: 'flex', height: 8, marginTop: 16, gap: 2 }}>
          {kcal.map((value, i) => (
            <div key={i} style={{ flex: `${(value / total) * 100} 0 0`, background: tones[i] }} />
          ))}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 22, marginTop: 12 }}>
        <Macro label="Protein" grams={protein} tone={tones[0]} />
        <Macro label="Carbs" grams={carbs} tone={tones[1]} />
        <Macro label="Fat" grams={fat} tone={tones[2]} />
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

  // Ordered longest-gap-first by the query, so the thing most worth doing is leftmost.
  const overdue = result.rows.filter((r) => r.days_since === null || r.days_since >= 7);

  return (
    <Section
      label="Last trained"
      aside={overdue.length > 0 ? `${overdue.length} over a week` : 'all within a week'}
    >
      <div style={{ display: 'flex', gap: 10 }}>
        {result.rows.map((row) => (
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
 * Four weeks of work, by movement pattern.
 *
 * Cardio is reported separately rather than as a sixth bar: it has no tonnage, so a bar scaled
 * against loaded volume would always read zero and imply you had not done it. Miles and minutes
 * are its real measures.
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
  const trained = PATTERNS.map((p) => ({ pattern: p, row: byPattern.get(p.key) })).filter(
    (entry) => entry.row !== undefined,
  );

  // Split, not filtered. A bar needs tonnage to have a length, and planks and cardio have none —
  // so a bar chart drops them silently and the screen reads "you have not trained core in four
  // weeks", which is a very different claim from "core was timed rather than loaded".
  const loaded = trained.filter((entry) => n0(entry.row?.volume_lbs) > 0);
  const timed = trained.filter((entry) => n0(entry.row?.volume_lbs) === 0);

  if (trained.length === 0) {
    return (
      <Section label="Volume" aside="28d">
        <Empty>Nothing logged in the last four weeks.</Empty>
      </Section>
    );
  }

  const max = Math.max(...loaded.map((entry) => n0(entry.row?.volume_lbs)), 1);
  const total = loaded.reduce((sum, entry) => sum + n0(entry.row?.volume_lbs), 0);

  return (
    <Section label="Volume" aside="28d">
      {loaded.map((entry, i) => (
        <BarRow
          key={entry.pattern.key}
          index={i}
          label={entry.pattern.label}
          value={n0(entry.row?.volume_lbs)}
          max={max}
          tone={entry.pattern.color}
          display={compact(n0(entry.row?.volume_lbs))}
        />
      ))}

      {timed.length > 0 ? (
        <div
          className="cap"
          style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 14, color: 'var(--ink-faint)' }}
        >
          {timed.map((entry) => (
            <span key={entry.pattern.key}>
              <Swatch tone={entry.pattern.color} />
              {entry.pattern.label}{' '}
              {n0(entry.row?.distance_mi) > 0 ? `${dec(n(entry.row?.distance_mi), 1)} mi · ` : ''}
              {int(n(entry.row?.duration_min))} min
            </span>
          ))}
        </div>
      ) : null}

      <div className="cap" style={{ marginTop: 10, textAlign: 'right', color: 'var(--ink-faint)' }}>
        {int(total)} lb loaded
      </div>
    </Section>
  );
}

// --- Helpers ----------------------------------------------------------------------------

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.abs(new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86_400_000;
}
