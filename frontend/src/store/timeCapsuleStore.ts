/**
 * Time capsule — tracks which historical sessions the user has "reviewed"
 * (i.e. opened the consistency test on). Sessions older than the
 * REVIEW_AGE_DAYS threshold and not yet reviewed get surfaced in the
 * SessionBrowser banner.
 *
 * Storage is local — sessions live on the server, but "have I reviewed
 * this session yet?" is a per-user-machine concept that doesn't need to
 * be cloud-synced for now.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const REVIEW_AGE_DAYS = 7;

interface TimeCapsuleState {
  /** Map of session_id → ISO timestamp when the user reviewed it. */
  reviewed: Record<string, string>;
  /** Map of session_id → ISO timestamp when the user dismissed the prompt
   *  without doing the review. Re-suppresses for 30 days. */
  snoozed: Record<string, string>;

  markReviewed: (sessionId: string) => void;
  snooze: (sessionId: string) => void;
  isReviewed: (sessionId: string) => boolean;
  isSnoozed: (sessionId: string) => boolean;
}

export const useTimeCapsuleStore = create<TimeCapsuleState>()(
  persist(
    (set, get) => ({
      reviewed: {},
      snoozed: {},

      markReviewed: (sessionId) =>
        set((s) => ({
          reviewed: { ...s.reviewed, [sessionId]: new Date().toISOString() },
        })),

      snooze: (sessionId) =>
        set((s) => ({
          snoozed: { ...s.snoozed, [sessionId]: new Date().toISOString() },
        })),

      isReviewed: (sessionId) => !!get().reviewed[sessionId],

      isSnoozed: (sessionId) => {
        const ts = get().snoozed[sessionId];
        if (!ts) return false;
        const ageMs = Date.now() - new Date(ts).getTime();
        return ageMs < 30 * 24 * 60 * 60 * 1000;
      },
    }),
    { name: 'whatif-time-capsule', version: 1 },
  ),
);

/** Days since an ISO date string, integer. */
export function ageInDays(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}
