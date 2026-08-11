'use client';

/**
 * Search and sort for a long list. Shared, because both catalogs need it.
 *
 * Filtering happens in the browser against rows the server already sent, so it is instant and
 * costs no request. That is affordable precisely because these lists are one person's catalog —
 * a few hundred rows at most — which is also why there is no pagination anywhere in this app.
 * Paging exists for unbounded data over an expensive network; here it would just be a worse
 * scrollbar.
 */

export type SortOption<T> = {
  key: string;
  label: string;
  compare: (a: T, b: T) => number;
};

export function ListControls<T>({
  query,
  onQuery,
  placeholder,
  sorts,
  activeSort,
  onSort,
  showing,
  total,
}: {
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  sorts: SortOption<T>[];
  activeSort: string;
  onSort: (key: string) => void;
  showing: number;
  total: number;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ position: 'relative' }}>
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={placeholder}
          // `search` gets the keyboard a clear affordance and stops iOS offering autocorrect on
          // what are mostly proper nouns.
          type="search"
          inputMode="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="mono selectable"
          style={{
            width: '100%',
            minHeight: 44,
            background: 'var(--panel)',
            border: '1px solid var(--rule)',
            borderRadius: 2,
            color: 'var(--ink)',
            fontSize: 'var(--t-base)',
            padding: '0 34px 0 10px',
          }}
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQuery('')}
            aria-label="Clear search"
            className="mono pressable"
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              width: 34,
              height: 44,
              color: 'var(--ink-faint)',
              fontSize: 'var(--t-lg)',
            }}
          >
            ×
          </button>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
        {sorts.map((sort) => {
          const active = sort.key === activeSort;
          return (
            <button
              key={sort.key}
              type="button"
              onClick={() => onSort(sort.key)}
              className="cap pressable"
              aria-pressed={active}
              style={{
                minHeight: 34,
                color: active ? 'var(--signal)' : 'var(--ink-faint)',
                // A rule under the active option rather than a filled pill — the same way the
                // tab bar marks its current tab.
                borderBottom: `2px solid ${active ? 'var(--signal)' : 'transparent'}`,
                paddingBottom: 2,
              }}
            >
              {sort.label}
            </button>
          );
        })}

        {/* Only shown while filtering. "22 of 22" on an unfiltered list is noise; the section
            header already carries the total. */}
        {showing !== total ? (
          <span className="cap" style={{ marginLeft: 'auto', color: 'var(--ink-dim)' }}>
            {showing} of {total}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Case-insensitive substring match, used by both lists so they behave identically. */
export function matches(haystack: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle);
}
