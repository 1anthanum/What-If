/**
 * Onboarding flow state — first-time users get a 30-second "what do
 * you want to do?" choice that routes them into the right module with
 * a pre-filled example scenario.
 *
 * Persisted so the modal only shows once.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ScenarioDraft {
  title: string;
  hypothesis: string;
  domain: string;
}

interface OnboardingState {
  seen: boolean;
  /** A draft a chosen onboarding path wants to inject into a module's
   *  input form. The receiving form clears it after consuming. */
  pendingDraft: ScenarioDraft | null;

  markSeen: () => void;
  setPendingDraft: (d: ScenarioDraft | null) => void;
  reopen: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      seen: false,
      pendingDraft: null,
      markSeen: () => set({ seen: true }),
      setPendingDraft: (d) => set({ pendingDraft: d }),
      reopen: () => set({ seen: false }),
    }),
    {
      name: 'whatif-onboarding',
      version: 1,
      partialize: (s) => ({ seen: s.seen }),  // never persist pendingDraft
    },
  ),
);
