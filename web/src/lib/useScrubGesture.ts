'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent, RefObject } from 'react';

/**
 * Tells a scrub apart from a page scroll, for the charts you drag a finger across.
 *
 * THE PROBLEM THIS EXISTS FOR. Both charts used to scrub on `pointerdown`: touch the plot and
 * the readout immediately became whatever day was under your finger. On a screen you scroll
 * with your thumb that is the wrong default, because the most common reason to put a finger on
 * a chart is to get past it. What happened next was worse — `touch-action: pan-y` lets the
 * browser take over once it decides you are panning, and taking over fires `pointercancel`, so
 * the readout snapped back. Every attempt to scroll flashed a wrong number and then undid it.
 *
 * THE FIX. Do nothing on contact. Wait for movement, and let the first few pixels of it decide:
 * mostly sideways is a scrub, mostly vertical is a scroll and this gesture is abandoned. Below
 * the threshold nothing has happened yet, which is what makes resting a thumb harmless.
 *
 * Once the gesture is a scrub the pointer is captured, so the rest of the drag arrives here
 * even if it wanders vertically — a scrub that dies because your finger drifted is the same
 * annoyance from the other direction.
 *
 * `touch-action: pan-y` still belongs on the element. It is what keeps vertical panning
 * instant: the browser scrolls immediately rather than waiting to see what this decides.
 */

/*
 * The two outcomes are not symmetric, and the thresholds say so.
 *
 * Guessing "scroll" wrongly costs a moment: the page moves a little, you drag again. Guessing
 * "scrub" wrongly captures the pointer, and the page then refuses to scroll for the rest of
 * the gesture — the finger keeps moving and nothing happens. One is a hesitation, the other
 * reads as broken. So scrolling is the default and scrubbing has to earn it.
 *
 * The reason this matters at all is that a thumb does not travel in straight lines. Scrolling
 * with the thumb pivots from its base, and the first few pixels of that arc are often as
 * sideways as they are down. A rule of "whichever axis is ahead right now" is a coin flip on
 * that arc — which is exactly what made the charts work sometimes and not others.
 */

/** Vertical travel that hands the gesture to the page. Low, because bailing out is cheap. */
const SCROLL_PX = 8;

/** Horizontal travel before a scrub may start. Higher, because committing is not cheap. */
const SCRUB_PX = 12;

/**
 * How much further sideways than downward the finger must have gone to count as a scrub.
 *
 * 1.7 is about 30 degrees off horizontal. Inside that wedge the movement is unambiguous;
 * outside it, and not yet vertical enough to abandon, the gesture stays undecided and waits
 * for more travel rather than committing on a tie.
 */
const SCRUB_BIAS = 1.7;

type Intent = 'undecided' | 'scrub' | 'scroll';

export function useScrubGesture({
  ref,
  onScrub,
  onRelease,
  tapToSelect = false,
}: {
  /** The element the gesture happens on. Needed to lock scrolling during a scrub. */
  ref: RefObject<HTMLElement | null>;
  /** Called with the pointer's clientX for every frame of a scrub. */
  onScrub: (clientX: number) => void;
  /** Called when a scrub ends. Omit where the selection should persist. */
  onRelease?: () => void;
  /**
   * Whether a tap that never moved selects the point under it.
   *
   * True where selection persists, since a tap is then a real shortcut. Pointless where the
   * chart resets on release — the selection would be discarded in the same breath — and there
   * it stays off, so a tap changes nothing at all.
   */
  tapToSelect?: boolean;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const intent = useRef<Intent>('undecided');

  /*
   * Once a scrub is underway, the page must not scroll. A finger reading across the plot
   * never travels perfectly flat, and every pixel of vertical drift used to slide the page —
   * so the thing you were pointing at moved while you were pointing at it.
   *
   * `touch-action: pan-y` cannot express this. It is latched when the touch begins and it
   * permits vertical panning for the WHOLE gesture, not just its opening. Capturing the
   * pointer does not help either: capture governs which element receives events, and native
   * scrolling is not an event anyone receives. The only thing that stops it is preventDefault
   * on a touchmove — and React's own onTouchMove cannot, because React registers touchmove
   * passively at the root, where preventDefault is ignored. Hence a real listener, bound to
   * the element, explicitly non-passive.
   *
   * Only while scrubbing. Blocking earlier — before the gesture has declared itself — would
   * make the page feel stuck exactly when someone is trying to scroll past the chart, which
   * is the complaint this whole hook exists to answer.
   */
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const lockWhileScrubbing = (event: TouchEvent) => {
      if (intent.current === 'scrub') event.preventDefault();
    };

    element.addEventListener('touchmove', lockWhileScrubbing, { passive: false });
    return () => element.removeEventListener('touchmove', lockWhileScrubbing);
  }, [ref]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    // Deliberately no capture and no scrub here. Contact alone means nothing yet.
    start.current = { x: event.clientX, y: event.clientY };
    intent.current = 'undecided';
  }, []);

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (intent.current === 'scroll') return;
      if (intent.current === 'scrub') {
        onScrub(event.clientX);
        return;
      }

      const from = start.current;
      if (!from) return;

      const dx = Math.abs(event.clientX - from.x);
      const dy = Math.abs(event.clientY - from.y);

      // Checked first, and on the looser condition, so anything with real vertical intent
      // leaves before it can be mistaken for a drag.
      if (dy >= SCROLL_PX && dy >= dx) {
        intent.current = 'scroll';
        return;
      }

      if (dx >= SCRUB_PX && dx >= dy * SCRUB_BIAS) {
        intent.current = 'scrub';
        event.currentTarget.setPointerCapture(event.pointerId);
        onScrub(event.clientX);
        return;
      }

      // Neither yet. Staying undecided is the point: a gesture that has not declared itself
      // gets to keep travelling, and if the browser claims it for a scroll in the meantime,
      // pointercancel arrives having committed to nothing.
    },
    [onScrub],
  );

  const finish = useCallback(
    (event: PointerEvent<HTMLDivElement>, tapCounts: boolean) => {
      if (intent.current === 'undecided' && tapCounts) onScrub(event.clientX);
      if (intent.current === 'scrub') onRelease?.();

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      intent.current = 'undecided';
      start.current = null;
    },
    [onRelease, onScrub],
  );

  return {
    onPointerDown,
    onPointerMove,

    /** Finger lifted. If it never moved, that was a tap. */
    onPointerUp: useCallback(
      (event: PointerEvent<HTMLDivElement>) => finish(event, tapToSelect),
      [finish, tapToSelect],
    ),

    /*
     * The browser took the gesture for a scroll.
     *
     * NEVER a tap, whatever `tapToSelect` says — and this is the whole reason cancel is
     * handled separately from release. iOS claims a vertical pan before any pointermove
     * reaches this hook, so the intent is still 'undecided' when cancel arrives: identical,
     * from in here, to a finger that touched and lifted without moving. Treating the two the
     * same meant every attempt to scroll past the chart selected whatever day was under the
     * thumb. The distinction is not in the coordinates, it is in which event fired.
     */
    onPointerCancel: useCallback(
      (event: PointerEvent<HTMLDivElement>) => finish(event, false),
      [finish],
    ),
  };
}
