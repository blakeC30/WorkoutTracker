import type { Metadata } from 'next';
import Link from 'next/link';
import { signIn } from './actions';
import { authDisabled } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Log',
  robots: { index: false, follow: false },
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; wait?: string }>;
}) {
  const params = await searchParams;
  const wait = Number(params.wait);

  // Nothing here is reachable by redirect when the login is off, but the URL still is — and
  // a fresh clone with AUTH_DISABLED set has no AUTH_PASSWORD_HASH to check a password
  // against, so submitting this form would throw. Say what is going on instead.
  if (authDisabled()) {
    return (
      <main className="screen" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '70vh' }}>
        <div className="cap" style={{ color: 'var(--ink-faint)', marginBottom: 12 }}>
          Login is off in this environment
        </div>
        <Link href="/" className="cap" style={{ color: 'var(--signal)' }}>
          Go to the log
        </Link>
      </main>
    );
  }

  return (
    <main className="screen" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '70vh' }}>
      <div className="cap" style={{ color: 'var(--ink-faint)', marginBottom: 24 }}>
        Training log
      </div>

      <form action={signIn}>
        <input type="hidden" name="next" value={params.next ?? ''} />

        {/*
          A username field iOS can see, even though there is only ever one user. iCloud
          Keychain offers to save a password far more reliably when it has something to file
          it under, and an autofilled password is the difference between this being pleasant
          and being a thing you avoid opening. Hidden rather than absent for the same reason.
        */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value="log"
          readOnly
          aria-hidden="true"
          tabIndex={-1}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />

        <label className="cap" htmlFor="password" style={{ display: 'block', marginBottom: 8, color: 'var(--ink-dim)' }}>
          Password
        </label>
        <input
          id="password"
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          required
          style={{
            width: '100%',
            padding: '12px 14px',
            background: 'transparent',
            border: '1px solid var(--ink-faint)',
            borderRadius: 2,
            color: 'var(--ink)',
            font: 'inherit',
            fontFamily: 'var(--font-mono)',
            // 16px or larger, or iOS zooms the whole page when the field takes focus and
            // never quite zooms back.
            fontSize: 16,
          }}
        />

        {params.error === 'rate' ? (
          <p className="cap" style={{ marginTop: 12, color: 'var(--signal)' }}>
            Too many attempts. Try again in {Number.isFinite(wait) && wait > 0 ? wait : 10} min.
          </p>
        ) : params.error ? (
          <p className="cap" style={{ marginTop: 12, color: 'var(--signal)' }}>
            Not that one.
          </p>
        ) : null}

        <button
          type="submit"
          style={{
            marginTop: 20,
            width: '100%',
            padding: '12px 14px',
            background: 'var(--signal)',
            border: 'none',
            borderRadius: 2,
            color: '#121110',
            font: 'inherit',
            fontFamily: 'var(--font-mono)',
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          Enter
        </button>
      </form>
    </main>
  );
}
