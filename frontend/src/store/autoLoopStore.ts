import { create } from 'zustand';
import { autoLoopApi, type AutoLoopConfig } from '../services/api';

export type AutoLoopStatus = 'idle' | 'running' | 'complete' | 'cancelled' | 'error';

export interface CycleState {
  cycle: number;
  hypothesis: string;
  loopId: string;
  synthesisPreview: string;
  nextHypothesis: string;
  converged: boolean;
  activeModule: string | null;   // which sub-module is active
  currentIteration: number;
}

interface AutoLoopState {
  // Config
  sessionId: string | null;
  config: AutoLoopConfig | null;

  // Status
  status: AutoLoopStatus;
  error: string | null;
  currentCycle: number;
  maxCycles: number;

  // Data
  cycles: CycleState[];
  evolutionChain: string[];
  stoppedReason: string;

  // Timing
  startedAt: number | null;
  elapsedSeconds: number;

  // Actions
  start: (config: AutoLoopConfig) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
  tick: () => void;  // called by interval to update elapsed time
}

const initialState = {
  sessionId: null as string | null,
  config: null as AutoLoopConfig | null,
  status: 'idle' as AutoLoopStatus,
  error: null as string | null,
  currentCycle: 0,
  maxCycles: 5,
  cycles: [] as CycleState[],
  evolutionChain: [] as string[],
  stoppedReason: '',
  startedAt: null as number | null,
  elapsedSeconds: 0,
};

export const useAutoLoopStore = create<AutoLoopState>((set, get) => ({
  ...initialState,

  start: async (config: AutoLoopConfig) => {
    set({
      ...initialState,
      config,
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
              activeModule: 'counterfactual',
              currentIteration: 0,
            };
            set((s) => ({
              currentCycle: event.data.cycle as number,
              cycles: [...s.cycles, cycle],
            }));
            break;
          }

          // Forward sub-loop events to update active module indicator
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
              error: event.data.detail as string || '自主探索失败',
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

function updateCurrentCycle(
  set: (fn: (s: AutoLoopState) => Partial<AutoLoopState>) => void,
  get: () => AutoLoopState,
  patch: Partial<CycleState>,
) {
  const { currentCycle, cycles } = get();
  const idx = cycles.findIndex((c) => c.cycle === currentCycle);
  if (idx < 0) return;
  set((s) => {
    const updated = [...s.cycles];
    updated[idx] = { ...updated[idx], ...patch };
    return { cycles: updated };
  });
}
