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
  { href: '/week', label: 'Week' },
  { href: '/lifts', label: 'Lifts' },
  { href: '/food', label: 'Food' },
] as const;

export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav
      style={{
        position: 'fixed',
        insetInline: 0,
        bottom: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        background: 'var(--ground)',
        borderTop: '1px solid var(--rule)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        zIndex: 10,
      }}
    >
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
              // Always 2px, transparent when inactive, so the label never shifts by a pixel as
              // you move between tabs.
              borderTop: `2px solid ${active ? 'var(--signal)' : 'transparent'}`,
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
