/**
 * Per-user inference settings — temperature & token budgets for both
 * the persona side (local Ollama) and the judge side (Claude API).
 *
 * Persisted to localStorage so tweaks survive a page reload.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ModelParams {
  persona_temperature: number;
  persona_max_tokens: number;
  judge_temperature: number;
  judge_max_tokens: number;
  eval_enabled: boolean;
}

export const DEFAULT_PARAMS: ModelParams = {
  persona_temperature: 0.7,
  persona_max_tokens: 800,
  judge_temperature: 0.4,
  judge_max_tokens: 1500,
  eval_enabled: true,
};

interface SettingsStore extends ModelParams {
  set: (patch: Partial<ModelParams>) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_PARAMS,
      set: (patch) => set(patch),
      reset: () => set(DEFAULT_PARAMS),
    }),
    { name: 'whatif-model-settings' },
  ),
);

/** Helper: snapshot just the ModelParams shape for sending to the API. */
export function getModelParams(): ModelParams {
  const s = useSettingsStore.getState();
  return {
    persona_temperature: s.persona_temperature,
    persona_max_tokens: s.persona_max_tokens,
    judge_temperature: s.judge_temperature,
    judge_max_tokens: s.judge_max_tokens,
    eval_enabled: s.eval_enabled,
  };
}
