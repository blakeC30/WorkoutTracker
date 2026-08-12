import { Waiting } from '@/components/Waiting';

/**
 * The date is in the path, but `loading.tsx` receives no params — and without this file the
 * nearest ancestor's loading state would be used instead, which is the wrong shape for a day.
 */
export default function Loading() {
  return <Waiting />;
}
