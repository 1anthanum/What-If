import { create } from 'zustand';
import {
  orchestratorApi,
  FeedbackLoopConfig,
  LoopIteration,
  FeedbackLoopResult,
} from '../services/api';

type LoopStatus = 'idle' | 'running' | 'complete' | 'error';
type ActiveModule = 'counterfactual' | 'causal' | 'debate' | 'synthesizing' | null;

interface OrchestratorState {
  // Config
  loopId: string | null;
  config: FeedbackLoopConfig | null;

  // Status
  status: LoopStatus;
  error: string | null;
  activeModule: ActiveModule;
  currentIteration: number;
  maxIterations: number;

  // Results
  iterations: LoopIteration[];
  finalSynthesis: string;
  convergenceAchieved: boolean;
  tokenUsage: Record<string, number> | null;

  // Actions
  startFeedbackLoop: (config: FeedbackLoopConfig) => Promise<void>;
  reset: () => void;
}

const initialState = {
  loopId: null,
  config: null,
  status: 'idle' as LoopStatus,
  error: null,
  activeModule: null as ActiveModule,
  currentIteration: 0,
  maxIterations: 3,
  iterations: [],
  finalSynthesis: '',
  convergenceAchieved: false,
  tokenUsage: null,
};

export const useOrchestratorStore = create<OrchestratorState>((set, get) => ({
  ...initialState,

  startFeedbackLoop: async (config: FeedbackLoopConfig) => {
    set({
      ...initialState,
      config,
      status: 'running',
      maxIterations: config.max_iterations ?? 3,
    });

    try {
      const stream = orchestratorApi.feedbackLoopStream(config);

      for await (const event of stream) {
        const state = get();
        if (state.status !== 'running') break;

        switch (event.type) {
          case 'loop_start':
            set({
              loopId: event.data.loop_id as string,
              maxIterations: event.data.max_iterations as number,
            });
            break;

          case 'iteration_start':
            set({
              currentIteration: event.data.iteration as number,
              activeModule: 'counterfactual',
            });
            break;

          case 'counterfactual_done':
            set({
              activeModule: 'causal',
              iterations: updateLastIteration(get().iterations, event.data.iteration as number, {
                counterfactual_summary: event.data.summary as string,
                key_divergences: event.data.key_divergences as string[],
              }),
            });
            break;

          case 'causal_done':
            set({
              activeModule: 'debate',
              iterations: updateLastIteration(get().iterations, event.data.iteration as number, {
                causal_insights: event.data.insights as string[],
                causal_graph_id: event.data.graph_id as string,
              }),
            });
            break;

          case 'debate_done':
            set({
              activeModule: 'synthesizing',
              iterations: updateLastIteration(get().iterations, event.data.iteration as number, {
                debate_consensus: event.data.consensus as string[],
                debate_dissent: event.data.dissent as string[],
              }),
            });
            break;

          case 'iteration_complete':
            set({
              activeModule: null,
              iterations: updateLastIteration(get().iterations, event.data.iteration as number, {
                refinement_for_next: event.data.refinement as string,
              }),
            });
            break;

          case 'loop_complete': {
            const result = event.data as unknown as FeedbackLoopResult;
            set({
              status: 'complete',
              activeModule: null,
              finalSynthesis: result.final_synthesis,
              convergenceAchieved: result.convergence_achieved,
              iterations: result.iterations,
              tokenUsage: result.token_usage,
            });
            break;
          }

          case 'error':
            set({
              status: 'error',
              error: event.data.detail as string || '闭环推演失败',
              activeModule: null,
            });
            break;
        }
      }
    } catch (err: unknown) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : '闭环推演连接失败',
        activeModule: null,
      });
    }
  },

  reset: () => set(initialState),
}));

/**
 * Helper: update or append an iteration in the iterations array.
 */
function updateLastIteration(
  iterations: LoopIteration[],
  iterationNum: number,
  patch: Partial<LoopIteration>,
): LoopIteration[] {
  const idx = iterations.findIndex((it) => it.iteration === iterationNum);
  if (idx >= 0) {
    const updated = [...iterations];
    updated[idx] = { ...updated[idx], ...patch };
    return updated;
  }
  // New iteration — create with defaults
  return [
    ...iterations,
    {
      iteration: iterationNum,
      counterfactual_summary: '',
      key_divergences: [],
      causal_insights: [],
      causal_graph_id: '',
      debate_consensus: [],
      debate_dissent: [],
      refinement_for_next: '',
      ...patch,
    },
  ];
}
