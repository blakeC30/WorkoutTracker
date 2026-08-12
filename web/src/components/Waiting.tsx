import { Masthead } from '@/components/ui';

/**
 * The one loading screen, given whatever the route already knows for certain.
 *
 * DESIGN.md is explicit — "Loading: a static dimmed label. No skeleton shimmer." — and the
 * reasoning holds: an animated grey box in the shape of content is a guess about data nobody
 * has fetched yet, and on a personal log the honest answer is often "nothing here". So there
 * is no shimmer, no spinner, nothing that loops.
 *
 * What changed is only the header. A masthead is not a guess: `Food` is always `Food`, and
 * today's date and week number come from the clock, not the backend. Rendering the true
 * header immediately means the screen arrives under a heading that is already correct and
 * does not move when the data lands — the previous version replaced a lone word with a whole
 * page, and that jump is most of what made the wait feel long.
 *
 * Routes that genuinely cannot know their own header — a month chosen by `?m=`, a date or an
 * exercise name in the path, none of which `loading.tsx` is given — pass nothing and get the
 * bare label. Guessing "August" and correcting it a moment later would be exactly the small
 * lie this file exists to avoid.
 */
export function Waiting({ left, right }: { left?: string; right?: string }) {
  return (
    <main className="screen">
      {left ? (
        <Masthead left={left} right={right} />
      ) : null}

      <div
        className="cap"
        style={{
          // Without a masthead above it, this line is what has to clear the notch.
          paddingTop: left ? 0 : 'calc(env(safe-area-inset-top) + 14px)',
          color: 'var(--ink-faint)',
        }}
      >
        Reading
      </div>
    </main>
  );
}
