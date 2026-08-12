import { Waiting } from '@/components/Waiting';

/**
 * No header, because this screen's header is the month — and the month comes from `?m=`,
 * which `loading.tsx` is never handed. Defaulting to the current month would be right most
 * of the time and visibly wrong exactly when you are paging back through the year.
 */
export default function Loading() {
  return <Waiting />;
}
