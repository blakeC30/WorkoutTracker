'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

/*
 * Four destinations, bottom of the screen, in the thumb's arc. No icons — a set of glyphs from
 * a library would be four more decisions averaged for me, and four words are unambiguous where
 * a dumbbell pictogram is not. The active tab is marked by a rule above it rather than a
 * filled pill, which matches how the rest of the app separates things.
 */
const TABS = [
  { href: '/', label: 'Today' },
  // Four tabs, one question each: now / over time / exercises / food. "Week" used to sit between
  // the first two and answered the same question as this one at a different zoom, so its
  // eight-week ledger moved onto this screen and the tab went away.
  { href: '/calendar', label: 'History' },
  { href: '/exercises', label: 'Exercises' },
  { href: '/food', label: 'Food' },
] as const;

export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();

  // A day detail lives under /calendar/<date>, so the tab stays lit while you are down there.
  const activeIndex = TABS.findIndex(
    (tab) => pathname === tab.href || (tab.href !== '/' && pathname.startsWith(`${tab.href}/`)),
  );

  return (
    <nav
      style={{
        position: 'fixed',
        insetInline: 0,
        bottom: 0,
        display: 'grid',
        gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
        background: 'var(--ground)',
        borderTop: '1px solid var(--rule)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        zIndex: 10,
      }}
    >
      {/* One marker that slides, rather than four that blink on and off. It tracks where you
          came from, which is the only thing on screen that says these four are one row and not
          four buttons. Hidden entirely on a route that isn't a tab. */}
      {activeIndex >= 0 ? (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -1,
            left: 0,
            width: `${100 / TABS.length}%`,
            height: 2,
            background: 'var(--signal)',
            transform: `translateX(${activeIndex * 100}%)`,
            transition: 'transform 0.34s var(--settle)',
          }}
        />
      ) : null}
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="cap pressable"
            aria-current={active ? 'page' : undefined}
            // Tapping the tab you are already on refetches it. Standalone mode has no reload
            // button and no pull-to-refresh, so without this the only way to see a workout you
            // just logged from Claude is to force-quit the app.
            onClick={
              active
                ? (event) => {
                    event.preventDefault();
                    router.refresh();
                  }
                : undefined
            }
            style={{
              height: 'var(--tabbar)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: active ? 'var(--signal)' : 'var(--ink-faint)',
              transition: 'color 0.34s var(--settle), opacity 0.12s ease-out',
              // Matches the sliding marker's 2px so the labels sit on one baseline whether or
              // not their tab is active.
              borderTop: '2px solid transparent',
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
