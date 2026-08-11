import { getBodyweight, getMuscles, getNutrition, getReview, n, n0 } from '@/lib/backend';
import { Masthead, Section, Rule, Figure, Delta, BarRow, Sparkline, Empty, Fault, Row, Swatch } from '@/components/ui';
import { agoLabel, compact, dayLabel, dec, int, isoWeek } from '@/lib/format';
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
  const [weight, muscles, nutrition, review] = await Promise.all([
    getBodyweight(90),
    getMuscles(28),
    getNutrition(7),
    getReview(25),
  ]);

  const now = new Date();

  return (
    <main className="screen">
      <Masthead left={dayLabel(toIso(now))} right={`WK ${isoWeek(now)}`} />

      <Bodyweight result={weight} />
      <Rule />
      <Fuel result={nutrition} />
      <Rule />
      <Volume result={muscles} />

      {review.ok && review.rows.length > 0 ? (
        <>
          <Rule />
          <Link href="/food" className="pressable" style={{ display: 'block' }}>
            <Row
              name={<span style={{ color: 'var(--flag)' }}>{review.rows.length} foods need review</span>}
              meta={<span className="cap">Macros are estimates</span>}
              right={<span className="mono" style={{ color: 'var(--ink-faint)' }}>→</span>}
              style={{ borderTop: 'none' }}
            />
          </Link>
        </>
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
        <Figure value={dec(current)} unit="LB" size="var(--t-3xl)" />
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
      <Figure value={int(n(row.calories))} unit="KCAL" />

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

function Volume({ result }: { result: Awaited<ReturnType<typeof getMuscles>> }) {
  if (!result.ok) {
    return (
      <Section label="Volume" aside="28d">
        <Fault error={result.error} />
      </Section>
    );
  }

  const rows = result.rows.filter((r) => n0(r.primary_volume_lbs) > 0 || n0(r.secondary_volume_lbs) > 0);
  if (rows.length === 0) {
    return (
      <Section label="Volume" aside="28d">
        <Empty>No loaded sets in the last four weeks. Cardio-only sessions don&apos;t produce volume.</Empty>
      </Section>
    );
  }

  const max = Math.max(...rows.map((r) => n0(r.primary_volume_lbs)));
  const total = rows.reduce((sum, r) => sum + n0(r.primary_volume_lbs), 0);

  return (
    <Section label="Volume" aside="28d">
      {rows.map((row) => (
        <BarRow
          key={row.region}
          label={row.region}
          value={n0(row.primary_volume_lbs)}
          secondary={n0(row.secondary_volume_lbs)}
          max={max}
          display={compact(n0(row.primary_volume_lbs))}
        />
      ))}
      <div className="cap" style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--ink-faint)' }}>
          <Swatch tone="var(--signal)" />
          primary
          <span style={{ marginLeft: 12 }}>
            <Swatch tone="var(--signal-low)" />
            secondary
          </span>
        </span>
        <span>{int(total)} lb</span>
      </div>
    </Section>
  );
}

// --- Helpers ----------------------------------------------------------------------------

/** Today in the phone's own timezone, as 'YYYY-MM-DD'. `toISOString()` would give UTC. */
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.abs(new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86_400_000;
}
