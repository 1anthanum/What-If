/**
 * Shared helpers for Zustand store persistence.
 *
 * Each module's store calls `persist(...)` with its own partialize and merge,
 * but the rules for cleaning up transient state after rehydration are
 * uniform — that's what this file owns.
 */

/** Statuses that mean "an in-flight stream was running" — we never want to
 *  rehydrate into these. On reload they always become 'idle' / 'active'. */
const STREAMING_STATUSES = new Set([
  'starting', 'streaming', 'generating', 'propagating',
  'running', 'loading_events', 'loading_event', 'exploring', 'analyzing',
]);

/** Normalize a possibly-streaming status to its idle counterpart.
 *  Keeps 'complete' / 'error' / 'idle' as-is. */
export function normalizeStatus(
  status: string | undefined,
  idleFallback: string = 'idle',
  activeFallback: string = 'active',
): string {
  if (!status) return idleFallback;
  if (STREAMING_STATUSES.has(status)) {
    // If the store had real session data, 'active' is more honest than 'idle'
    return activeFallback;
  }
  return status;
}

/** Strip any `isStreaming: true` flag from a list of statements/items. */
export function clearStreamingFlags<T extends { isStreaming?: boolean }>(items: T[] | undefined): T[] {
  if (!items) return [];
  return items.map(item => (item.isStreaming ? { ...item, isStreaming: false } : item));
}
