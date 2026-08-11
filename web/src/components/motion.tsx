'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/*
 * The only two pieces of motion that need JavaScript. Bars, sparklines and press states are
 * pure CSS in globals.css — they animate on their own and ship nothing.
 */

// useLayoutEffect warns during SSR. Client Components are still server-rendered by Next, so the
// effect is swapped for useEffect on the server pass, where it is a no-op anyway.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Raises a section into place the first time it comes into view.
 *
 * Two safeguards, because the failure mode of a reveal is an invisible screen:
 *   - reduced motion resolves it immediately, before the observer is ever created
 *   - a timeout forces it visible regardless, so a browser that never fires the observer
 *     (element inside an overflow container, an old WebKit, a bug) still shows the data
 */
export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) return;
    if (prefersReducedMotion()) {
      setSeen(true);
      return;
    }

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // rootMargin pulls the trigger line above the fold so a section has finished arriving
        // by the time it is properly on screen, rather than animating under your eyes.
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.01 },
    );
    observer.observe(node);

    const failsafe = window.setTimeout(() => setSeen(true), 1600);
    return () => {
      observer.disconnect();
      window.clearTimeout(failsafe);
    };
  }, [seen]);

  return (
    <div
      ref={ref}
      className={seen ? 'reveal seen' : 'reveal'}
      style={{ '--delay': `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

/**
 * A number settling into its value, the way a gauge does when it powers on.
 *
 * The final value is what renders on the server, so the correct number is in the HTML and
 * survives with no JavaScript at all. The animation then rewrites `textContent` directly —
 * never React state — so a 900ms count costs zero re-renders and cannot cause a hydration
 * mismatch. `useLayoutEffect` sets the starting value before the browser paints, so there is no
 * frame where the final number flashes first.
 */
export function Counter({
  value,
  decimals = 0,
  duration = 900,
  delay = 0,
}: {
  value: number | null;
  decimals?: number;
  duration?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const format = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  useIsoLayoutEffect(() => {
    const node = ref.current;
    if (!node || value === null || prefersReducedMotion()) return;

    // Not from zero. A bodyweight counting up from 0 lb is a slot machine; starting near the
    // value and settling the last stretch reads as an instrument finding it. Volume and calorie
    // totals do sweep from zero, because for those the sweep IS the sense of magnitude.
    const from = Math.abs(value) > 400 ? 0 : value * 0.972;
    let frame = 0;
    let start = 0;
    let settled = false;

    node.textContent = format(from);

    const step = (now: number) => {
      if (settled) return;
      if (!start) start = now;
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4); // easeOutQuart: quick, then a long arrival
      node.textContent = format(from + (value - from) * eased);
      if (t < 1) frame = window.requestAnimationFrame(step);
    };

    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(step);
    }, delay);

    // The number on screen is data, so it is not allowed to end up anywhere except correct.
    // requestAnimationFrame stops being called in a backgrounded tab, and iOS pauses it when
    // the app is swiped away — a count interrupted mid-flight would otherwise sit at 207.3
    // forever while the real weigh-in was 208.1. This settles the true value regardless of
    // whether a single frame ever ran.
    const guarantee = window.setTimeout(
      () => {
        settled = true; // also stops a throttled frame from writing a stale value later
        node.textContent = format(value);
      },
      delay + duration + 250,
    );

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(guarantee);
      if (frame) window.cancelAnimationFrame(frame);
      node.textContent = format(value);
    };
  }, [value, decimals, duration, delay]);

  return <span ref={ref}>{value === null ? '—' : format(value)}</span>;
}
