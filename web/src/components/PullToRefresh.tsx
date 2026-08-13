'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Pull down at the top of any screen to refetch it.
 *
 * The app had no way to reload. Standalone mode has no address bar and no browser chrome, and
 * `overscroll-behavior-y: none` deliberately kills the rubber-band — so the only refresh was
 * tapping the tab you were already on, which TabBar does for exactly this reason and which
 * nobody discovers. Everything on these screens is written from a phone conversation with
 * Claude, so "I just logged that, show me" is the single most common thing you want from the
 * dashboard.
 *
 * Because the native bounce is off, the gesture is ours to define rather than to intercept.
 * That is also why touchmove has to be non-passive: nothing else will stop the page from
 * treating a downward drag at the top as a scroll that goes nowhere.
 */

/** Damped pull, in px, needed to arm the refresh. */
const THRESHOLD = 64;
/** Past this the finger keeps moving and the sheet does not, which is what makes it feel held. */
const MAX = 96;
/** Half. The content trails the finger, so the gesture reads as resistance rather than as drag. */
const RESISTANCE = 0.5;
/** Movement before the gesture commits to an axis. Below this it could still become a scrub. */
const SLOP = 8;

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Mirrors of the two values the touch handlers need, because those are bound once and would
  // otherwise close over the first render's state forever.
  const pullRef = useRef(0);
  const pendingRef = useRef(false);
  pendingRef.current = pending;

  const start = useRef({ x: 0, y: 0 });
  const owns = useRef(false);
  const decided = useRef(false);

  const set = useCallback((next: number) => {
    pullRef.current = next;
    setPull(next);
  }, []);

  useEffect(() => {
    function onStart(event: TouchEvent) {
      if (event.touches.length !== 1 || pendingRef.current) return;
      const touch = event.touches[0];
      start.current = { x: touch.clientX, y: touch.clientY };
      // Only from the very top. Anywhere else a downward drag is an ordinary scroll and taking
      // it would make the page feel stuck.
      owns.current = window.scrollY <= 0;
      decided.current = false;
    }

    function onMove(event: TouchEvent) {
      if (!owns.current) return;
      const touch = event.touches[0];
      const dy = touch.clientY - start.current.y;
      const dx = touch.clientX - start.current.x;

      /*
       * Decide once, on the first movement worth reading, and never revisit it.
       *
       * The charts are horizontal scrub surfaces and two of them — the nutrition chart, the
       * bodyweight chart — sit close enough to the top of their screens to be touched at
       * scrollY 0. A pull that grabbed any downward component would steal the first frames of
       * a scrub and leave the chart following a finger that had already been taken.
       *
       * So the gesture must be clearly downward AND clearly more vertical than horizontal, or
       * this gives it up for good.
       */
      if (!decided.current) {
        if (Math.abs(dy) < SLOP && Math.abs(dx) < SLOP) return;
        decided.current = true;
        if (dy <= 0 || Math.abs(dy) < Math.abs(dx) * 1.5) {
          owns.current = false;
          return;
        }
        setDragging(true);
      }

      if (dy <= 0) {
        set(0);
        return;
      }

      // Non-passive listener, so this is allowed and is what keeps the page still under the
      // pull. Only ever called once the gesture is committed and heading down.
      event.preventDefault();
      set(Math.min(dy * RESISTANCE, MAX));
    }

    function onEnd() {
      if (!owns.current) return;
      owns.current = false;
      decided.current = false;
      setDragging(false);

      if (pullRef.current >= THRESHOLD) {
        // router.refresh() refetches the Server Components in place. Wrapped in a transition so
        // `pending` reports when that has actually landed — there is no promise to await, and
        // the indicator has to hold until the new markup is on screen rather than for a guessed
        // number of milliseconds.
        startTransition(() => router.refresh());
      }
      set(0);
    }

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [router, set, startTransition]);

  const progress = Math.min(pull / THRESHOLD, 1);
  const ready = progress >= 1;

  return (
    <>
      {/*
       * The indicator is one hairline, which is the only container this design has.
       *
       * It opens from the centre outward as you pull, so its width IS how far you have pulled —
       * the reading DESIGN.md asks every animation to carry. Centre rather than the left origin
       * `draw-x` uses: a bar filling from the left across the top of a screen is a page-load
       * progress bar, and this is not loading anything yet.
       *
       * Amber at rest is `--signal-low` and goes to full `--signal` at the threshold, which is
       * the moment the gesture will do something if you let go. Colour is the only channel that
       * can say that without moving anything, and 180ms matches the nutrition bars — the app's
       * one other colour-on-touch response.
       *
       * While refreshing it holds full width at full signal, then fades. No spinner and no
       * looping sweep: this design has no idle animation anywhere, and a bar that is simply
       * still says "waiting" perfectly well for the half second this takes.
       */}
      <div
        aria-hidden
        className={dragging ? 'pull-bar' : 'pull-bar pull-eased'}
        style={{
          transform: `scaleX(${pending ? 1 : progress})`,
          opacity: pull > 0 || pending ? 1 : 0,
          background: ready || pending ? 'var(--signal)' : 'var(--signal-low)',
        }}
      />
      <div
        className={dragging ? 'pull-content' : 'pull-content pull-eased'}
        style={{ transform: pull > 0 ? `translateY(${pull}px)` : undefined }}
      >
        {children}
      </div>
    </>
  );
}
