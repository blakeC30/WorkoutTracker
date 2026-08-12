import { Waiting } from '@/components/Waiting';

/**
 * Signing out passes through here. Without this file the root loading state applies, and the
 * last thing shown on the way out would be today's date over the word "Reading" — the app
 * appearing to start up at the moment you are leaving it.
 */
export default function Loading() {
  return <Waiting />;
}
