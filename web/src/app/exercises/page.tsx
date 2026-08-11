import { getPrs } from '@/lib/backend';
import { Masthead, Empty, Fault } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { ExercisesList } from '@/components/ExercisesList';

export const dynamic = 'force-dynamic';

/**
 * The exercise catalog: every movement with its record and its own trend.
 *
 * Ordered by recency by default, not by size of record — the useful question standing in a gym
 * is "what did I do last time", and an all-time list sorted by weight buries the thing you are
 * about to repeat under a deadlift you last did in March.
 */
export default async function Exercises() {
  // One more than displayed, so a truncated list can say so rather than silently hiding rows.
  const LIMIT = 120;
  const result = await getPrs(LIMIT + 1);

  return (
    <main className="screen">
      <Masthead left="Exercises" right="Best set" />
      <Reveal>
        {result.ok ? (
          result.rows.length > 0 ? (
            <ExercisesList rows={result.rows.slice(0, LIMIT)} capped={result.rows.length > LIMIT} />
          ) : (
            <Empty>No sets recorded yet. Log a session and every exercise in it appears here.</Empty>
          )
        ) : (
          <Fault error={result.error} />
        )}
      </Reveal>
    </main>
  );
}
