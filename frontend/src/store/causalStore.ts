/**
 * Zustand store for the Causal Graph module.
 */

import { create } from 'zustand';
import {
  causalApi,
  type CausalNode,
  type CausalEdge,
  type PropagationAnalysis,
  type TokenUsage,
} from '../services/api';

interface CausalState {
  // Graph state
  graphId: string | null;
  title: string;
  nodes: CausalNode[];
  edges: CausalEdge[];

  // UI state
  selectedNodeId: string | null;
  propagationAnalysis: PropagationAnalysis | null;
  affectedNodeIds: Set<string>;
  status: 'idle' | 'generating' | 'propagating' | 'error';
  error: string | null;
  tokenUsage: TokenUsage | null;

  // Streaming
  streamingText: string;

  // Actions
  generateGraph: (title: string, hypothesis: string, domain: string) => Promise<void>;
  selectNode: (nodeId: string | null) => void;
  propagateNode: (perturbation: string, depth?: number) => Promise<void>;
  setError: (error: string | null) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  graphId: null,
  title: '',
  nodes: [],
  edges: [],
  selectedNodeId: null,
  propagationAnalysis: null,
  affectedNodeIds: new Set<string>(),
  status: 'idle' as const,
  error: null,
  tokenUsage: null,
  streamingText: '',
};

export const useCausalStore = create<CausalState>((set, get) => ({
  ...INITIAL_STATE,

  generateGraph: async (title: string, hypothesis: string, domain: string) => {
    set({ ...INITIAL_STATE, status: 'generating' });

    try {
      const { events, abort } = causalApi.generateStream(title, hypothesis, domain);
      let streamText = '';

      for await (const event of events) {
        switch (event.type) {
          case 'chunk':
            streamText += (event.data.text as string) || '';
            set({ streamingText: streamText });
            break;

          case 'graph_complete':
            set({
              graphId: event.data.graph_id as string,
              title: (event.data.title as string) || title,
              nodes: event.data.nodes as CausalNode[],
              edges: event.data.edges as CausalEdge[],
              tokenUsage: (event.data.token_usage as TokenUsage) || null,
              status: 'idle',
              streamingText: '',
            });
            break;

          case 'error':
            set({
              status: 'error',
              error: (event.data.message as string) || '图谱生成失败',
              streamingText: '',
            });
            break;
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        set({
          status: 'error',
          error: (err as Error).message,
          streamingText: '',
        });
      }
    }
  },

  selectNode: (nodeId: string | null) => {
    set({
      selectedNodeId: nodeId,
      propagationAnalysis: null,
      affectedNodeIds: new Set(),
    });
  },

  propagateNode: async (perturbation: string, depth: number = 4) => {
    const { graphId, selectedNodeId } = get();
    if (!graphId || !selectedNodeId) return;

    set({ status: 'propagating', error: null, streamingText: '' });

    try {
      const { events } = causalApi.propagateStream(graphId, selectedNodeId, perturbation, depth);
      let streamText = '';

      for await (const event of events) {
        switch (event.type) {
          case 'chunk':
            streamText += (event.data.text as string) || '';
            set({ streamingText: streamText });
            break;

          case 'propagation_complete': {
            const analysis = event.data.analysis as PropagationAnalysis;
            const affected = new Set<string>();
            affected.add(selectedNodeId);
            if (analysis?.steps) {
              for (const step of analysis.steps) {
                affected.add(step.node_id);
              }
            }
            set({
              propagationAnalysis: analysis,
              affectedNodeIds: affected,
              tokenUsage: (event.data.token_usage as TokenUsage) || get().tokenUsage,
              status: 'idle',
              streamingText: '',
            });
            break;
          }

          case 'error':
            set({
              status: 'error',
              error: (event.data.message as string) || '传播分析失败',
              streamingText: '',
            });
            break;
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        set({
          status: 'error',
          error: (err as Error).message,
          streamingText: '',
        });
      }
    }
  },

  setError: (error: string | null) => set({ error }),

  reset: () => set(INITIAL_STATE),
}));
