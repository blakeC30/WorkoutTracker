import { Waiting } from '@/components/Waiting';

/**
 * Without this, the list's loading state ("Exercises / Best set") would show while a single
 * exercise loads, and then be replaced by that exercise's name — a header that announces the
 * wrong screen for as long as the fetch takes.
 */
export default function Loading() {
  return <Waiting />;
}
