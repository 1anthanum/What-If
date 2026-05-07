/**
 * Zustand store for debate room state management.
 */

import { create } from 'zustand';
import { debateApi, type DebateStartResponse, type TokenUsage } from '../services/api';

export interface PersonaEval {
  persona_id: string;
  confidence: number;       // 0..100
  stance: number;           // -100..+100
  novelty: number;          // 0..100
  risk: number;             // 0..100
  style: string;            // 经验主义 / 理论推演 / 直觉判断 / 对抗反驳 / 整合调和
  rationale: string;
}

interface PersonaStatement {
  persona_id: string;
  persona_name: string;
  persona_role?: string;
  model?: string;
  content: string;
  isStreaming?: boolean;
  evaluation?: PersonaEval;
  summary?: string;
  summaryPending?: boolean;
}

interface DebateRound {
  round_number: number;
  injected_event: string | null;
  statements: PersonaStatement[];
  evalPending?: boolean;
  evalJudgeModel?: string;
  summaryPending?: boolean;
  summarizerModel?: string;
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
  judgeModel: string | null;

  // Current streaming state
  streamingPersonaId: string | null;
  streamingText: string;
  personaModels: Record<string, string>;

  // Actions
  startDebate: (params: {
    title: string;
    hypothesis: string;
    domain?: string;
  }) => Promise<void>;
  registerPersonaModel: (personaId: string, model: string) => void;
  appendStreamChunk: (personaId: string, text: string) => void;
  finalizePersona: (personaId: string, personaName: string, content: string) => void;
  startNewRound: (roundNumber: number, injectedEvent: string | null) => void;
  completeRound: (tokenUsage: TokenUsage) => void;
  markRoundEvalPending: (roundNumber: number) => void;
  applyRoundEval: (roundNumber: number, evals: PersonaEval[], judgeModel: string) => void;
  markRoundSummaryPending: (roundNumber: number) => void;
  applyPersonaSummary: (roundNumber: number, personaId: string, summary: string, summarizerModel: string) => void;
  setStreaming: (streaming: boolean) => void;
  setSummary: (summary: string, judgeModel?: string | null) => void;
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
  judgeModel: null,
  streamingPersonaId: null,
  streamingText: '',
  personaModels: {} as Record<string, string>,
};

export const useDebateStore = create<DebateStore>((set, get) => ({
  ...initialState,

  startDebate: async (params) => {
    set({ status: 'starting', error: null });
    try {
      const { getModelParams } = await import('./settingsStore');
      const response: DebateStartResponse = await debateApi.start({
        scenario_title: params.title,
        scenario_hypothesis: params.hypothesis,
        domain: params.domain || 'general',
        model_params: getModelParams(),
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

  registerPersonaModel: (personaId, model) => {
    set(state => ({
      personaModels: { ...state.personaModels, [personaId]: model },
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
          model: state.personaModels[personaId],
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

  markRoundEvalPending: (roundNumber) => {
    set(state => {
      const rounds = state.rounds.map(r =>
        r.round_number === roundNumber ? { ...r, evalPending: true } : r
      );
      return { rounds };
    });
  },

  applyRoundEval: (roundNumber, evals, judgeModel) => {
    set(state => {
      const evalById: Record<string, PersonaEval> = {};
      for (const e of evals) evalById[e.persona_id] = e;
      const rounds = state.rounds.map(r => {
        if (r.round_number !== roundNumber) return r;
        return {
          ...r,
          evalPending: false,
          evalJudgeModel: judgeModel,
          statements: r.statements.map(s =>
            evalById[s.persona_id]
              ? { ...s, evaluation: evalById[s.persona_id] }
              : s
          ),
        };
      });
      return { rounds };
    });
  },

  markRoundSummaryPending: (roundNumber) => {
    set(state => ({
      rounds: state.rounds.map(r =>
        r.round_number === roundNumber
          ? {
              ...r,
              summaryPending: true,
              statements: r.statements.map(s => ({ ...s, summaryPending: true })),
            }
          : r
      ),
    }));
  },

  applyPersonaSummary: (roundNumber, personaId, summary, summarizerModel) => {
    set(state => ({
      rounds: state.rounds.map(r => {
        if (r.round_number !== roundNumber) return r;
        const statements = r.statements.map(s =>
          s.persona_id === personaId
            ? { ...s, summary, summaryPending: false }
            : s
        );
        const stillPending = statements.some(s => s.summaryPending);
        return {
          ...r,
          summarizerModel: summarizerModel || r.summarizerModel,
          summaryPending: stillPending,
          statements,
        };
      }),
    }));
  },

  setStreaming: (streaming) => {
    set({ status: streaming ? 'streaming' : 'active' });
  },

  setSummary: (summary, judgeModel = null) => set({ summary, judgeModel }),

  setError: (error) => set({ error, status: error ? 'error' : 'active' }),

  reset: () => set(initialState),
}));
