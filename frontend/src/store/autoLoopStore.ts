import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { autoLoopApi, type AutoLoopConfig, type AutoLoopMode, type StanceMatrix, type JudgeVerdict, type CriticIssue, type FactCheckClaim } from '../services/api';

export type AutoLoopStatus = 'idle' | 'running' | 'complete' | 'cancelled' | 'error';

export interface PhilPersonaState {
  id: string;
  name: string;
  role: string;
  model: string;
  content: string;
  streaming: boolean;
  reflection?: string;       // Method B: self-reflection
  critic_issues?: CriticIssue[];  // populated by phil_critic_note when live_critic is on
  fact_check_claims?: FactCheckClaim[];  // populated by phil_fact_check when fact_check is on
  followups?: Array<{ followup: string; response: string }>;  // Socratic follow-up Q&A pairs
}

export interface SubQuestionState {
  idx: number;
  title: string;
  question: string;
  domain: string;
  personas: PhilPersonaState[];
  synthesis: string;
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
  // Feature 1: Epistemic divergence
  stanceMatrix: StanceMatrix | null;
  // Feature 3: Branching candidates
  candidateQuestions: string[];
  // Method A: Subquestion decomposition
  subQuestions: SubQuestionState[];
  subdomainRouting?: boolean;
  isSubqMaster?: boolean;
  // Judge verdict — explicit ruling on contested points
  judgeVerdict?: JudgeVerdict | null;
  // Memory compression flag — when true, heavy fields (persona.content
  // bodies, stanceMatrix, etc.) have been dropped to keep long sessions
  // from bloating browser memory. synthesisPreview / nextHypothesis remain.
  compressed?: boolean;
}

/** Keep this many recent cycles in full detail; older ones get compressed. */
const KEEP_LIVE_CYCLES = 5;

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
  finalSynthesis: string;       // cross-cycle Opus meta-synthesis
  finalSynthPending: boolean;

  // Philosophical mode — active persona
  activePersonaId: string | null;

  // Feature flags (from auto_start)
  adversarial: boolean;
  extractStances: boolean;
  branching: boolean;

  // Feature 4: Spectator mode stats
  totalPersonaWords: Record<string, number>;   // persona_id → cumulative word count
  spectatorOpen: boolean;

  // Timing
  startedAt: number | null;
  elapsedSeconds: number;

  // Actions
  start: (config: AutoLoopConfig) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
  tick: () => void;
  toggleSpectator: () => void;
  /** Append a Socratic follow-up Q&A to a persona in a specific cycle. */
  appendPersonaFollowup: (cycleNum: number, personaId: string, followup: string, response: string) => void;
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
  finalSynthesis: '',
  finalSynthPending: false,
  activePersonaId: null as string | null,
  adversarial: false,
  extractStances: false,
  branching: false,
  totalPersonaWords: {} as Record<string, number>,
  spectatorOpen: false,
  startedAt: null as number | null,
  elapsedSeconds: 0,
};

export const useAutoLoopStore = create<AutoLoopState>()(
  persist(
    (set, get) => ({
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

      for await (const event of stream.events) {
        const state = get();
        if (state.status !== 'running') break;

        switch (event.type) {
          case 'auto_start':
            set({
              sessionId: event.data.session_id as string,
              maxCycles: event.data.max_cycles as number,
              mode: (event.data.mode as AutoLoopMode) ?? resolvedMode,
              adversarial: (event.data.adversarial as boolean) ?? false,
              extractStances: (event.data.extract_stances as boolean) ?? false,
              branching: (event.data.branching as boolean) ?? false,
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
              stanceMatrix: null,
              candidateQuestions: [],
              subQuestions: [],
              judgeVerdict: null,
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
            const fullContent = event.data.content as string;
            markPersonaDone(set, get, pid2, fullContent);
            // Feature 4: Track cumulative word counts for spectator mode
            const wordCount = fullContent.length;  // Chinese chars ≈ words
            set((s) => ({
              totalPersonaWords: {
                ...s.totalPersonaWords,
                [pid2]: (s.totalPersonaWords[pid2] ?? 0) + wordCount,
              },
            }));
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
              isSubqMaster: !!event.data.is_subq_master,
            });
            break;

          // ── Method B: self-reflection (non-subq path) ──
          case 'phil_self_reflection': {
            const personaId = event.data.persona_id as string;
            const reflection = event.data.reflection as string;
            const state = get();
            const cycles = [...state.cycles];
            const last = cycles[cycles.length - 1];
            if (last) {
              last.personas = last.personas.map(p =>
                p.id === personaId ? { ...p, reflection } : p
              );
              set({ cycles });
            }
            break;
          }

          // ── Method A: subquestion decomposition ──
          case 'phil_subqs_proposed': {
            const subqs = (event.data.sub_questions as any[]) || [];
            const subQuestions = subqs.map((sq, idx) => ({
              idx,
              title: sq.title,
              question: sq.question,
              domain: sq.domain,
              personas: [] as PhilPersonaState[],
              synthesis: '',
            }));
            updateCurrentCycle(set, get, {
              subQuestions,
              subdomainRouting: !!event.data.subdomain_routing,
            });
            break;
          }
          case 'phil_subq_persona_start': {
            const subqIdx = event.data.subq_idx as number;
            const state = get();
            const cycles = [...state.cycles];
            const last = cycles[cycles.length - 1];
            if (last && last.subQuestions[subqIdx]) {
              const sq = { ...last.subQuestions[subqIdx] };
              sq.personas = [...sq.personas, {
                id: event.data.persona_id as string,
                name: event.data.persona_name as string,
                role: '',
                model: (event.data.model as string) || '',
                content: '',
                streaming: true,
              }];
              last.subQuestions = [...last.subQuestions];
              last.subQuestions[subqIdx] = sq;
              set({ cycles });
            }
            break;
          }
          case 'phil_subq_persona_chunk': {
            const subqIdx = event.data.subq_idx as number;
            const personaId = event.data.persona_id as string;
            const text = (event.data.text as string) || '';
            const state = get();
            const cycles = [...state.cycles];
            const last = cycles[cycles.length - 1];
            if (last && last.subQuestions[subqIdx]) {
              const sq = { ...last.subQuestions[subqIdx] };
              sq.personas = sq.personas.map(p =>
                p.id === personaId && p.streaming
                  ? { ...p, content: p.content + text }
                  : p
              );
              last.subQuestions = [...last.subQuestions];
              last.subQuestions[subqIdx] = sq;
              set({ cycles });
            }
            break;
          }
          case 'phil_subq_persona_complete': {
            const subqIdx = event.data.subq_idx as number;
            const personaId = event.data.persona_id as string;
            const content = (event.data.content as string) || '';
            const state = get();
            const cycles = [...state.cycles];
            const last = cycles[cycles.length - 1];
            if (last && last.subQuestions[subqIdx]) {
              const sq = { ...last.subQuestions[subqIdx] };
              sq.personas = sq.personas.map(p =>
                p.id === personaId ? { ...p, content, streaming: false } : p
              );
              last.subQuestions = [...last.subQuestions];
              last.subQuestions[subqIdx] = sq;
              set({ cycles });
            }
            break;
          }
          case 'phil_subq_self_reflection': {
            const subqIdx = event.data.subq_idx as number;
            const personaId = event.data.persona_id as string;
            const reflection = event.data.reflection as string;
            const state = get();
            const cycles = [...state.cycles];
            const last = cycles[cycles.length - 1];
            if (last && last.subQuestions[subqIdx]) {
              const sq = { ...last.subQuestions[subqIdx] };
              sq.personas = sq.personas.map(p =>
                p.id === personaId ? { ...p, reflection } : p
              );
              last.subQuestions = [...last.subQuestions];
              last.subQuestions[subqIdx] = sq;
              set({ cycles });
            }
            break;
          }
          case 'phil_subq_synth_done': {
            const subqIdx = event.data.subq_idx as number;
            const synthesis = event.data.synthesis as string;
            const state = get();
            const cycles = [...state.cycles];
            const last = cycles[cycles.length - 1];
            if (last && last.subQuestions[subqIdx]) {
              last.subQuestions = [...last.subQuestions];
              last.subQuestions[subqIdx] = { ...last.subQuestions[subqIdx], synthesis };
              set({ cycles });
            }
            break;
          }
          case 'phil_subq_decompose_start':
          case 'phil_subq_start':
          case 'phil_subq_master_start':
            // status-only events; UI can listen if needed
            break;

          // ── Feature 1: Stance matrix ──
          case 'phil_stance_matrix':
            updateCurrentCycle(set, get, {
              stanceMatrix: event.data.matrix as StanceMatrix,
            });
            break;

          // ── Judge verdict — explicit verdicts on contested points ──
          case 'phil_judge_verdict':
            updateCurrentCycle(set, get, {
              judgeVerdict: event.data.verdict as JudgeVerdict,
            });
            break;

          // ── Live critic — attach issues to the persona that just spoke ──
          case 'phil_critic_note': {
            const pid = event.data.persona_id as string;
            const issues = (event.data.issues as CriticIssue[]) || [];
            const { currentCycle: cn, cycles: cs } = get();
            const idx = cs.findIndex((c) => c.cycle === cn);
            if (idx < 0) break;
            set((s) => {
              const updated = [...s.cycles];
              const personas = updated[idx].personas.map((p) =>
                p.id === pid ? { ...p, critic_issues: issues } : p,
              );
              updated[idx] = { ...updated[idx], personas };
              return { cycles: updated };
            });
            break;
          }

          // ── Fact-check — attach plausibility-checked claims ──
          case 'phil_fact_check': {
            const pid = event.data.persona_id as string;
            const claims = (event.data.claims as FactCheckClaim[]) || [];
            const { currentCycle: cn, cycles: cs } = get();
            const idx = cs.findIndex((c) => c.cycle === cn);
            if (idx < 0) break;
            set((s) => {
              const updated = [...s.cycles];
              const personas = updated[idx].personas.map((p) =>
                p.id === pid ? { ...p, fact_check_claims: claims } : p,
              );
              updated[idx] = { ...updated[idx], personas };
              return { cycles: updated };
            });
            break;
          }

          // ── Feature 3: Candidate questions ──
          case 'candidate_questions':
            updateCurrentCycle(set, get, {
              candidateQuestions: event.data.candidates as string[],
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
            // Memory hygiene: when cycle count exceeds the live window,
            // compress oldest cycles by dropping heavy fields. The user
            // still sees synthesisPreview / nextHypothesis / verdict shape.
            set((s) => {
              if (s.cycles.length <= KEEP_LIVE_CYCLES) return s;
              const lastLiveIdx = s.cycles.length - KEEP_LIVE_CYCLES;
              const compressed = s.cycles.map((c, i) => {
                if (i >= lastLiveIdx || c.compressed) return c;
                return {
                  ...c,
                  personas: c.personas.map((p) => ({
                    ...p,
                    content: p.content.length > 280
                      ? p.content.slice(0, 280) + '…'
                      : p.content,
                  })),
                  stanceMatrix: null,
                  candidateQuestions: [],
                  subQuestions: [],
                  judgeVerdict: c.judgeVerdict ? {
                    verdicts: c.judgeVerdict.verdicts.slice(0, 2),
                    overall_strongest: c.judgeVerdict.overall_strongest,
                    overall_weakest: c.judgeVerdict.overall_weakest,
                  } : c.judgeVerdict,
                  compressed: true,
                };
              });
              return { cycles: compressed };
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

          case 'final_synth_start':
            set({ finalSynthPending: true });
            break;

          case 'final_synth_done':
            set({
              finalSynthesis: (event.data.final_synthesis as string) || '',
              finalSynthPending: false,
            });
            break;

          case 'auto_complete':
            set({
              status: 'complete',
              stoppedReason: event.data.stopped_reason as string,
              evolutionChain: event.data.evolution_chain as string[],
              finalSynthesis: (event.data.final_synthesis as string) || get().finalSynthesis,
              finalSynthPending: false,
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

  toggleSpectator: () => set((s) => ({ spectatorOpen: !s.spectatorOpen })),

  appendPersonaFollowup: (cycleNum, personaId, followup, response) =>
    set((s) => {
      const idx = s.cycles.findIndex((c) => c.cycle === cycleNum);
      if (idx < 0) return s;
      const updated = [...s.cycles];
      const personas = updated[idx].personas.map((p) => {
        if (p.id !== personaId) return p;
        const next = [...(p.followups || []), { followup, response }];
        return { ...p, followups: next };
      });
      updated[idx] = { ...updated[idx], personas };
      return { cycles: updated };
    }),

  tick: () => {
    const { startedAt, status } = get();
    if (startedAt && status === 'running') {
      set({ elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) });
    }
  },
    }),
    {
      name: 'whatif-auto-loop-store',
      version: 1,
      partialize: (s) => ({
        sessionId: s.sessionId,
        config: s.config,
        mode: s.mode,
        currentCycle: s.currentCycle,
        maxCycles: s.maxCycles,
        cycles: s.cycles,
        evolutionChain: s.evolutionChain,
        stoppedReason: s.stoppedReason,
        finalSynthesis: s.finalSynthesis,
        adversarial: s.adversarial,
        extractStances: s.extractStances,
        branching: s.branching,
        totalPersonaWords: s.totalPersonaWords,
        startedAt: s.startedAt,
        elapsedSeconds: s.elapsedSeconds,
        // Only persist terminal statuses; running streams are dead post-reload.
        status: (s.status === 'complete' || s.status === 'cancelled' || s.status === 'error')
          ? s.status
          : 'idle',
      }),
      merge: (persistedRaw, current) => {
        const persisted = (persistedRaw as Partial<AutoLoopState>) ?? {};
        // Freeze any in-flight persona streams in saved cycles.
        const frozen = (persisted.cycles ?? []).map((c) => ({
          ...c,
          personas: c.personas.map((p) => (p.streaming ? { ...p, streaming: false } : p)),
        }));
        return {
          ...current,
          ...persisted,
          cycles: frozen,
          status: persisted.status ?? 'idle',
          activePersonaId: null,
          finalSynthPending: false,
          error: null,
        };
      },
    },
  ),
);

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
