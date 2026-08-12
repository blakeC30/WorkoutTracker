import { Waiting } from '@/components/Waiting';
import { dayLabel, isoWeek, toIso } from '@/lib/format';
import { nowInAppTz } from '@/lib/time';

/**
 * Today's screen, waiting for its data.
 *
 * The date and the week number are the same two values the loaded page shows, computed the
 * same way from the same clock — so this header is not a placeholder for the real one, it IS
 * the real one, rendered before the fetches finish.
 */
export default function Loading() {
  const now = nowInAppTz();
  return <Waiting left={dayLabel(toIso(now))} right={`WK ${isoWeek(now)}`} />;
}
