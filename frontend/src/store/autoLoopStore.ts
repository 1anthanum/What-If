import { create } from 'zustand';
import { autoLoopApi, type AutoLoopConfig, type AutoLoopMode } from '../services/api';

export type AutoLoopStatus = 'idle' | 'running' | 'complete' | 'cancelled' | 'error';

export interface PhilPersonaState {
  id: string;
  name: string;
  role: string;
  model: string;
  content: string;
  streaming: boolean;
}

export interface CycleState {
  cycle: number;
  hypothesis: string;
  loopId: string;
  synthesisPreview: string;
  nextHypothesis: string;
  converged: boolean;
  activeModule: string | null;   // which sub-module is active
  currentIteration: number;
  // Philosophical mode
  personas: PhilPersonaState[];
}

interface AutoLoopState {
  // Config
  sessionId: string | null;
  config: AutoLoopConfig | null;
  mode: AutoLoopMode;

  // Status
  status: AutoLoopStatus;
  error: string | null;
  currentCycle: number;
  maxCycles: number;

  // Data
  cycles: CycleState[];
  evolutionChain: string[];
  stoppedReason: string;

  // Philosophical mode — active persona
  activePersonaId: string | null;

  // Timing
  startedAt: number | null;
  elapsedSeconds: number;

  // Actions
  start: (config: AutoLoopConfig) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
  tick: () => void;
}

const initialState = {
  sessionId: null as string | null,
  config: null as AutoLoopConfig | null,
  mode: 'historical' as AutoLoopMode,
  status: 'idle' as AutoLoopStatus,
  error: null as string | null,
  currentCycle: 0,
  maxCycles: 5,
  cycles: [] as CycleState[],
  evolutionChain: [] as string[],
  stoppedReason: '',
  activePersonaId: null as string | null,
  startedAt: null as number | null,
  elapsedSeconds: 0,
};

export const useAutoLoopStore = create<AutoLoopState>((set, get) => ({
  ...initialState,

  start: async (config: AutoLoopConfig) => {
    const resolvedMode = config.mode ?? 'historical';
    set({
      ...initialState,
      config,
      mode: resolvedMode,
      status: 'running',
      maxCycles: config.max_cycles ?? 5,
      startedAt: Date.now(),
      evolutionChain: [config.seed_hypothesis],
    });

    try {
      const stream = autoLoopApi.startStream(config);

      for await (const event of stream) {
        const state = get();
        if (state.status !== 'running') break;

        switch (event.type) {
          case 'auto_start':
            set({
              sessionId: event.data.session_id as string,
              maxCycles: event.data.max_cycles as number,
              mode: (event.data.mode as AutoLoopMode) ?? resolvedMode,
            });
            break;

          case 'cycle_start': {
            const cycle: CycleState = {
              cycle: event.data.cycle as number,
              hypothesis: event.data.hypothesis as string,
              loopId: '',
              synthesisPreview: '',
              nextHypothesis: '',
              converged: false,
              activeModule: resolvedMode === 'philosophical' ? 'debate' : 'counterfactual',
              currentIteration: 0,
              personas: [],
            };
            set((s) => ({
              currentCycle: event.data.cycle as number,
              cycles: [...s.cycles, cycle],
              activePersonaId: null,
            }));
            break;
          }

          // ── Historical mode sub-loop events ──
          case 'loop_iteration_start':
            updateCurrentCycle(set, get, {
              currentIteration: event.data.iteration as number,
              activeModule: 'counterfactual',
            });
            break;

          case 'loop_counterfactual_done':
            updateCurrentCycle(set, get, { activeModule: 'causal' });
            break;

          case 'loop_causal_done':
            updateCurrentCycle(set, get, { activeModule: 'debate' });
            break;

          case 'loop_debate_done':
            updateCurrentCycle(set, get, { activeModule: 'synthesizing' });
            break;

          case 'loop_iteration_complete':
            updateCurrentCycle(set, get, { activeModule: null });
            break;

          // ── Philosophical mode events ──
          case 'phil_persona_start': {
            const persona: PhilPersonaState = {
              id: event.data.persona_id as string,
              name: event.data.persona_name as string,
              role: event.data.persona_role as string,
              model: event.data.model as string,
              content: '',
              streaming: true,
            };
            set({ activePersonaId: persona.id });
            addPersonaToCycle(set, get, persona);
            break;
          }

          case 'phil_persona_chunk': {
            const pid = event.data.persona_id as string;
            const text = event.data.text as string;
            appendPersonaChunk(set, get, pid, text);
            break;
          }

          case 'phil_persona_complete': {
            const pid2 = event.data.persona_id as string;
            markPersonaDone(set, get, pid2, event.data.content as string);
            break;
          }

          case 'phil_debate_done':
            updateCurrentCycle(set, get, { activeModule: 'synthesizing' });
            set({ activePersonaId: null });
            break;

          case 'phil_synthesis_done':
            updateCurrentCycle(set, get, {
              synthesisPreview: event.data.synthesis as string,
              activeModule: null,
            });
            break;

          // ── Common events ──
          case 'cycle_complete':
            updateCurrentCycle(set, get, {
              loopId: event.data.loop_id as string,
              synthesisPreview: event.data.synthesis_preview as string,
              converged: event.data.converged as boolean,
              activeModule: null,
            });
            break;

          case 'next_hypothesis':
            updateCurrentCycle(set, get, {
              nextHypothesis: event.data.hypothesis as string,
            });
            set((s) => ({
              evolutionChain: [...s.evolutionChain, event.data.hypothesis as string],
            }));
            break;

          case 'auto_converged':
            set({ stoppedReason: 'converged' });
            break;

          case 'auto_cancelled':
            set({ status: 'cancelled', stoppedReason: 'cancelled' });
            break;

          case 'cycle_error':
            set({
              status: 'error',
              error: event.data.error as string,
              stoppedReason: 'error',
            });
            break;

          case 'auto_complete':
            set({
              status: 'complete',
              stoppedReason: event.data.stopped_reason as string,
              evolutionChain: event.data.evolution_chain as string[],
            });
            break;

          case 'error':
            set({
              status: 'error',
              error: event.data.detail as string || '探索失败',
            });
            break;
        }
      }
    } catch (err: unknown) {
      if (get().status === 'running') {
        set({
          status: 'error',
          error: err instanceof Error ? err.message : '连接失败',
        });
      }
    }
  },

  cancel: async () => {
    const { sessionId } = get();
    if (sessionId) {
      try {
        await autoLoopApi.cancel(sessionId);
      } catch {
        // ignore
      }
    }
    set({ status: 'cancelled', stoppedReason: 'cancelled' });
  },

  reset: () => set(initialState),

  tick: () => {
    const { startedAt, status } = get();
    if (startedAt && status === 'running') {
      set({ elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) });
    }
  },
}));

type SetFn = (fn: (s: AutoLoopState) => Partial<AutoLoopState>) => void;
type GetFn = () => AutoLoopState;

function updateCurrentCycle(set: SetFn, get: GetFn, patch: Partial<CycleState>) {
  const { currentCycle, cycles } = get();
  const idx = cycles.findIndex((c) => c.cycle === currentCycle);
  if (idx < 0) return;
  set((s) => {
    const updated = [...s.cycles];
    updated[idx] = { ...updated[idx], ...patch };
    return { cycles: updated };
  });
}

function addPersonaToCycle(set: SetFn, get: GetFn, persona: PhilPersonaState) {
  const { currentCycle, cycles } = get();
  const idx = cycles.findIndex((c) => c.cycle === currentCycle);
  if (idx < 0) return;
  set((s) => {
    const updated = [...s.cycles];
    updated[idx] = {
      ...updated[idx],
      personas: [...updated[idx].personas, persona],
    };
    return { cycles: updated };
  });
}

function appendPersonaChunk(set: SetFn, get: GetFn, personaId: string, text: string) {
  const { currentCycle, cycles } = get();
  const idx = cycles.findIndex((c) => c.cycle === currentCycle);
  if (idx < 0) return;
  set((s) => {
    const updated = [...s.cycles];
    const personas = updated[idx].personas.map((p) =>
      p.id === personaId ? { ...p, content: p.content + text } : p
    );
    updated[idx] = { ...updated[idx], personas };
    return { cycles: updated };
  });
}

function markPersonaDone(set: SetFn, get: GetFn, personaId: string, fullContent: string) {
  const { currentCycle, cycles } = get();
  const idx = cycles.findIndex((c) => c.cycle === currentCycle);
  if (idx < 0) return;
  set((s) => {
    const updated = [...s.cycles];
    const personas = updated[idx].personas.map((p) =>
      p.id === personaId ? { ...p, content: fullContent, streaming: false } : p
    );
    updated[idx] = { ...updated[idx], personas };
    return { cycles: updated };
  });
}
