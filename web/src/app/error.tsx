'use client';

/**
 * Last resort. Individual sections already degrade on their own via <Fault>, so reaching this
 * means a render threw — a shape the screen didn't expect, not a backend that's down.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="screen">
      <div style={{ paddingTop: 'calc(env(safe-area-inset-top) + 14px)' }}>
        <div className="cap" style={{ color: 'var(--fault)' }}>
          Screen failed
        </div>
        <p
          className="selectable"
          style={{ color: 'var(--ink-dim)', fontSize: 'var(--t-sm)', lineHeight: 1.5, marginTop: 10 }}
        >
          {error.message}
        </p>
        <button
          onClick={reset}
          className="cap pressable"
          style={{
            marginTop: 20,
            minHeight: 44,
            padding: '0 18px',
            border: '1px solid var(--rule)',
            borderRadius: 2,
            color: 'var(--signal)',
          }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
