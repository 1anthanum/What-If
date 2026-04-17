/**
 * Zustand store for debate room state management.
 */

import { create } from 'zustand';
import { debateApi, type DebateStartResponse, type TokenUsage } from '../services/api';

interface PersonaStatement {
  persona_id: string;
  persona_name: string;
  persona_role?: string;
  content: string;
  isStreaming?: boolean;
}

interface DebateRound {
  round_number: number;
  injected_event: string | null;
  statements: PersonaStatement[];
}

interface DebateStore {
  // Session state
  sessionId: string | null;
  scenario: string;
  personas: Array<{ id: string; name: string; role: string }>;
  rounds: DebateRound[];
  currentRound: number;
  status: 'idle' | 'starting' | 'active' | 'streaming' | 'error';
  error: string | null;
  tokenUsage: TokenUsage | null;
  summary: string | null;

  // Current streaming state
  streamingPersonaId: string | null;
  streamingText: string;

  // Actions
  startDebate: (params: {
    title: string;
    hypothesis: string;
    domain?: string;
  }) => Promise<void>;
  appendStreamChunk: (personaId: string, text: string) => void;
  finalizePersona: (personaId: string, personaName: string, content: string) => void;
  startNewRound: (roundNumber: number, injectedEvent: string | null) => void;
  completeRound: (tokenUsage: TokenUsage) => void;
  setStreaming: (streaming: boolean) => void;
  setSummary: (summary: string) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  sessionId: null,
  scenario: '',
  personas: [],
  rounds: [],
  currentRound: 0,
  status: 'idle' as const,
  error: null,
  tokenUsage: null,
  summary: null,
  streamingPersonaId: null,
  streamingText: '',
};

export const useDebateStore = create<DebateStore>((set, get) => ({
  ...initialState,

  startDebate: async (params) => {
    set({ status: 'starting', error: null });
    try {
      const response: DebateStartResponse = await debateApi.start({
        scenario_title: params.title,
        scenario_hypothesis: params.hypothesis,
        domain: params.domain || 'general',
      });
      set({
        sessionId: response.session_id,
        scenario: response.scenario,
        personas: response.personas,
        status: 'active',
        rounds: [],
        currentRound: 0,
      });
    } catch (err) {
      set({ status: 'error', error: (err as Error).message });
    }
  },

  startNewRound: (roundNumber, injectedEvent) => {
    set(state => ({
      currentRound: roundNumber,
      status: 'streaming',
      rounds: [
        ...state.rounds,
        { round_number: roundNumber, injected_event: injectedEvent, statements: [] },
      ],
    }));
  },

  appendStreamChunk: (personaId, text) => {
    set(state => {
      const rounds = [...state.rounds];
      const currentRound = rounds[rounds.length - 1];
      if (!currentRound) return state;

      const existingIdx = currentRound.statements.findIndex(s => s.persona_id === personaId);
      if (existingIdx >= 0) {
        currentRound.statements[existingIdx] = {
          ...currentRound.statements[existingIdx],
          content: currentRound.statements[existingIdx].content + text,
          isStreaming: true,
        };
      } else {
        const persona = state.personas.find(p => p.id === personaId);
        currentRound.statements.push({
          persona_id: personaId,
          persona_name: persona?.name || personaId,
          persona_role: persona?.role,
          content: text,
          isStreaming: true,
        });
      }

      return { rounds, streamingPersonaId: personaId, streamingText: text };
    });
  },

  finalizePersona: (personaId, personaName, content) => {
    set(state => {
      const rounds = [...state.rounds];
      const currentRound = rounds[rounds.length - 1];
      if (!currentRound) return state;

      const existingIdx = currentRound.statements.findIndex(s => s.persona_id === personaId);
      if (existingIdx >= 0) {
        currentRound.statements[existingIdx] = {
          ...currentRound.statements[existingIdx],
          content,
          isStreaming: false,
        };
      }

      return { rounds, streamingPersonaId: null };
    });
  },

  completeRound: (tokenUsage) => {
    set({ status: 'active', tokenUsage, streamingPersonaId: null });
  },

  setStreaming: (streaming) => {
    set({ status: streaming ? 'streaming' : 'active' });
  },

  setSummary: (summary) => set({ summary }),

  setError: (error) => set({ error, status: error ? 'error' : 'active' }),

  reset: () => set(initialState),
}));
