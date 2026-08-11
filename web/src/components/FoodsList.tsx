'use client';

import { useMemo, useState } from 'react';
import type { FoodRow } from '@/lib/backend';
import { FoodEditor } from '@/components/FoodEditor';
import { ListControls, matches, type SortOption } from '@/components/ListControls';
import { Section, Empty } from '@/components/ui';
import { n } from '@/lib/num';
import { agoLabel, int, parseDay } from '@/lib/format';

/**
 * Everything eaten in the window, searchable and sortable.
 *
 * A Client Component because the filtering is: the rows arrive from the server once and are
 * narrowed in the browser, so typing costs nothing. It also has to own the row markup, since a
 * render callback cannot be passed across the server/client boundary.
 */
const SORTS: SortOption<FoodRow>[] = [
  // Default. The question this list answers is "what do I live on", and frequency is the answer
  // — a staple eaten 27 times beats one large meal that outweighs it.
  { key: 'often', label: 'Often', compare: (a, b) => b.times_eaten - a.times_eaten },
  {
    key: 'recent',
    label: 'Recent',
    compare: (a, b) => parseDay(b.last_eaten).getTime() - parseDay(a.last_eaten).getTime(),
  },
  { key: 'kcal', label: 'Calories', compare: (a, b) => (n(b.calories) ?? 0) - (n(a.calories) ?? 0) },
  // Estimated first, then the least certain of those — the correcting order.
  {
    key: 'review',
    label: 'Unsure',
    compare: (a, b) => rank(b) - rank(a) || b.times_eaten - a.times_eaten,
  },
  { key: 'name', label: 'A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
];

function rank(row: FoodRow): number {
  if (row.calories === null) return 3;
  if (row.confidence === 'low') return 2;
  if (row.confidence === 'medium') return 1;
  return 0;
}

export function isEstimated(row: FoodRow) {
  return row.calories === null || row.confidence === 'low' || row.confidence === 'medium';
}

export function FoodsList({ rows, capped }: { rows: FoodRow[]; capped: boolean }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('often');

  const shown = useMemo(() => {
    const active = SORTS.find((option) => option.key === sort) ?? SORTS[0];
    return rows.filter((row) => matches(row.name, query)).sort(active.compare);
  }, [rows, query, sort]);

  const estimated = rows.filter(isEstimated);

  return (
    <Section
      label="Foods"
      aside={
        estimated.length > 0
          ? `${estimated.length} of ${rows.length} estimated`
          : `${rows.length} · all confirmed`
      }
    >
      <ListControls
        query={query}
        onQuery={setQuery}
        placeholder="Search foods"
        sorts={SORTS}
        activeSort={sort}
        onSort={setSort}
        showing={shown.length}
        total={rows.length}
      />

      {shown.length === 0 ? (
        <Empty>Nothing matches “{query.trim()}”.</Empty>
      ) : (
        shown.map((row) => <Item key={row.id} row={row} />)
      )}

      <p style={{ marginTop: 18, color: 'var(--ink-faint)', fontSize: 'var(--t-sm)', lineHeight: 1.5 }}>
        Tap a row to correct its macros. Every past meal using that food moves with it, including
        the days in the chart above.
        {/* Silent truncation is the one thing a capped list must not do. */}
        {capped ? ' Only the most-eaten foods are listed — search to reach the rest.' : ''}
      </p>
    </Section>
  );
}

function Item({ row }: { row: FoodRow }) {
  const estimated = isEstimated(row);

  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--rule)' }}>
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
          <span>
            ×{row.times_eaten}
            {row.calories !== null
              ? ` · ${int(n(row.protein_g))} P ${int(n(row.carbs_g))} C ${int(n(row.fat_g))} F`
              : ''}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
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
