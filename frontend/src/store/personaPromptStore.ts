/**
 * User-edited persona system prompts.
 *
 * The defaults are fetched from /api/orchestrator/personas on first open.
 * Edits are stored locally and sent with each auto-loop start as
 * `persona_overrides` so the user's customizations take effect.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BASE_URL } from '../services/api';

export interface PersonaDefault {
  id: string;
  name: string;
  role: string;
  system_prompt: string;
}

interface PersonaPromptState {
  defaults: PersonaDefault[] | null;   // null = not yet fetched
  fetchingDefaults: boolean;
  /** Map of persona_id → user-edited prompt. Missing entries fall back to default. */
  edits: Record<string, string>;
  /** Which personas the user has explicitly edited (for badge counts). */
  editedIds: string[];

  loadDefaults: () => Promise<void>;
  setEdit: (personaId: string, text: string) => void;
  clearEdit: (personaId: string) => void;
  clearAll: () => void;
  /** Returns the active prompt (edited if present, else default). */
  effectivePrompt: (personaId: string) => string;
  /** Subset of edits matching `personas` parameter — to send as override payload. */
  overridePayload: (activePersonaIds: string[]) => Record<string, string>;
}

export const usePersonaPromptStore = create<PersonaPromptState>()(
  persist(
    (set, get) => ({
      defaults: null,
      fetchingDefaults: false,
      edits: {},
      editedIds: [],

      loadDefaults: async () => {
        if (get().defaults || get().fetchingDefaults) return;
        set({ fetchingDefaults: true });
        try {
          const r = await fetch(`${BASE_URL}/orchestrator/personas`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          set({ defaults: data.personas || [], fetchingDefaults: false });
        } catch (e) {
          console.error('loadDefaults failed:', e);
          set({ fetchingDefaults: false });
        }
      },

      setEdit: (personaId, text) =>
        set((s) => {
          const next = { ...s.edits, [personaId]: text };
          const ids = Object.keys(next);
          return { edits: next, editedIds: ids };
        }),

      clearEdit: (personaId) =>
        set((s) => {
          const next = { ...s.edits };
          delete next[personaId];
          return { edits: next, editedIds: Object.keys(next) };
        }),

      clearAll: () => set({ edits: {}, editedIds: [] }),

      effectivePrompt: (personaId) => {
        const s = get();
        if (s.edits[personaId]) return s.edits[personaId];
        const d = s.defaults?.find((p) => p.id === personaId);
        return d?.system_prompt ?? '';
      },

      overridePayload: (activePersonaIds) => {
        const { edits } = get();
        const out: Record<string, string> = {};
        for (const id of activePersonaIds) {
          if (edits[id]) out[id] = edits[id];
        }
        return out;
      },
    }),
    {
      name: 'whatif-persona-prompts',
      version: 1,
      // Persist edits but not the fetched defaults (they may change server-side).
      partialize: (s) => ({ edits: s.edits, editedIds: s.editedIds }),
    },
  ),
);
