/**
 * Shown while a screen's data is being fetched.
 *
 * A dimmed word, not a skeleton shimmer. Skeletons animate grey boxes into the shape of
 * content that may turn out to be an empty state, which is a small lie told sixty times a
 * second — and on a personal log, empty is a routine outcome.
 */
export default function Loading() {
  return (
    <main className="screen">
      <div
        className="cap"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 14px)',
          color: 'var(--ink-faint)',
        }}
      >
        Reading
      </div>
    </main>
  );
}
