'use client';

import { useCallback, useRef } from 'react';
import type { PointerEvent } from 'react';

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

/**
 * How far a finger travels before the gesture is called.
 *
 * Eight pixels, in the neighbourhood of what the browser itself uses to start a scroll. Much
 * lower and a thumb resting on the plot reads as a drag; much higher and a genuine scrub feels
 * like it ignores the start of the movement.
 */
const INTENT_PX = 8;

type Intent = 'undecided' | 'scrub' | 'scroll';

export function useScrubGesture({
  onScrub,
  onRelease,
  tapToSelect = false,
}: {
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
      if (Math.max(dx, dy) < INTENT_PX) return;

      if (dx > dy) {
        intent.current = 'scrub';
        event.currentTarget.setPointerCapture(event.pointerId);
        onScrub(event.clientX);
      } else {
        // Vertical. Hand the gesture to the page and stay out of it until the next contact.
        intent.current = 'scroll';
      }
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
