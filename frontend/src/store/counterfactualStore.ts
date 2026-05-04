import { create } from 'zustand';
import {
  counterfactualApi,
  type HistoricalEventSummary,
  type HistoricalEvent,
  type TimelinePoint,
  type TokenUsage,
  type PossibilityBranch,
  type ExplorationCluster,
  type VulnerabilityPoint,
  type UserAnnotation,
  type AttractorPoint,
  type AttractorAnalysis,
  type HistoricalPersona,
  type ActorCoalition,
} from '../services/api';

type Status = 'idle' | 'loading_events' | 'loading_event' | 'generating' | 'complete' | 'error';
type ExplorationStage = 'idle' | 'diverge' | 'cluster' | 'refine' | 'complete';
type FalsifyStatus = 'idle' | 'running' | 'complete' | 'error';
type AttractorStatus = 'idle' | 'exploring' | 'analyzing' | 'complete' | 'error';
type CounterfactualMode = 'single' | 'explore' | 'attractor' | 'embodied';

interface CounterfactualState {
  // Event selection
  events: HistoricalEventSummary[];
  selectedEvent: HistoricalEvent | null;

  // Single timeline generation
  timelineId: string | null;
  modification: string;
  timelinePoints: TimelinePoint[];
  summary: string;
  keyDivergences: string[];
  butterflyEffects: string[];

  // Mode (single / explore / attractor / embodied)
  explorationMode: CounterfactualMode;
  fanId: string | null;
  explorationStage: ExplorationStage;
  explorationProgress: number;
  explorationClusters: ExplorationCluster[];
  possibilityBranches: PossibilityBranch[];
  selectedBranchIndex: number | null;
  totalExplorations: number;

  // Falsification engine
  falsifyStatus: FalsifyStatus;
  vulnerabilityIndex: number | null;
  vulnerabilityPoints: VulnerabilityPoint[];
  methodologyNote: string;
  strongestClaimYear: number | null;
  weakestClaimYear: number | null;

  // User knowledge injection
  annotations: UserAnnotation[];
  annotatingYear: number | null;  // Currently annotating this year (modal open)

  // Attractor detection
  attractorStatus: AttractorStatus;
  attractorAnalysis: AttractorAnalysis | null;
  attractorProgress: { current: number; total: number };
  attractorModifications: string[];  // User-entered modifications for attractor detection

  // Embodied perspective
  personas: HistoricalPersona[];
  selectedPersonaIds: string[];
  embodiedCoalitions: ActorCoalition[];

  // Cone view
  coneViewEnabled: boolean;

  // UI state
  status: Status;
  error: string | null;
  tokenUsage: TokenUsage | null;
  streamingText: string;
  expandedPointYear: number | null;

  // Actions
  loadEvents: () => Promise<void>;
  selectEvent: (eventId: string) => Promise<void>;
  generateTimeline: (modification: string, timeHorizon?: string) => Promise<void>;
  startExploration: (
    modification: string,
    timeHorizon?: string,
    nExplorations?: number,
    nClusters?: number,
  ) => Promise<void>;
  selectBranch: (index: number | null) => void;
  setExplorationMode: (mode: CounterfactualMode) => void;
  setExpandedPoint: (year: number | null) => void;
  setModification: (text: string) => void;
  clearEvent: () => void;
  reset: () => void;

  // Falsification actions
  falsifyTimeline: () => Promise<void>;
  clearFalsification: () => void;

  // Annotation actions
  setAnnotatingYear: (year: number | null) => void;
  addAnnotation: (annotation: UserAnnotation) => void;
  removeAnnotation: (year: number) => void;
  regenerateWithConstraints: () => Promise<void>;

  // Attractor actions
  setAttractorModifications: (mods: string[]) => void;
  detectAttractors: () => Promise<void>;
  clearAttractors: () => void;

  // Embodied perspective actions
  loadPersonas: (eventId: string) => Promise<void>;
  togglePersona: (id: string) => void;
  startEmbodiedExploration: (modification: string, timeHorizon?: string, nClusters?: number) => Promise<void>;

  // Cone view actions
  toggleConeView: () => void;
}

const INITIAL_STATE = {
  events: [] as HistoricalEventSummary[],
  selectedEvent: null as HistoricalEvent | null,
  timelineId: null as string | null,
  modification: '',
  timelinePoints: [] as TimelinePoint[],
  summary: '',
  keyDivergences: [] as string[],
  butterflyEffects: [] as string[],
  explorationMode: 'single' as CounterfactualMode,
  fanId: null as string | null,
  explorationStage: 'idle' as ExplorationStage,
  explorationProgress: 0,
  explorationClusters: [] as ExplorationCluster[],
  possibilityBranches: [] as PossibilityBranch[],
  selectedBranchIndex: null as number | null,
  totalExplorations: 0,
  falsifyStatus: 'idle' as FalsifyStatus,
  vulnerabilityIndex: null as number | null,
  vulnerabilityPoints: [] as VulnerabilityPoint[],
  methodologyNote: '',
  strongestClaimYear: null as number | null,
  weakestClaimYear: null as number | null,
  annotations: [] as UserAnnotation[],
  annotatingYear: null as number | null,
  attractorStatus: 'idle' as AttractorStatus,
  attractorAnalysis: null as AttractorAnalysis | null,
  attractorProgress: { current: 0, total: 0 },
  attractorModifications: [] as string[],
  personas: [] as HistoricalPersona[],
  selectedPersonaIds: [] as string[],
  embodiedCoalitions: [] as ActorCoalition[],
  coneViewEnabled: false,
  status: 'idle' as Status,
  error: null as string | null,
  tokenUsage: null as TokenUsage | null,
  streamingText: '',
  expandedPointYear: null as number | null,
};

export const useCounterfactualStore = create<CounterfactualState>((set, get) => ({
  ...INITIAL_STATE,

  loadEvents: async () => {
    set({ status: 'loading_events', error: null });
    try {
      const { events } = await counterfactualApi.listEvents();
      set({ events, status: 'idle' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '加载事件列表失败';
      set({ error: msg, status: 'error' });
    }
  },

  selectEvent: async (eventId: string) => {
    set({ status: 'loading_event', error: null, selectedEvent: null });
    try {
      const event = await counterfactualApi.getEvent(eventId);
      set({
        selectedEvent: event,
        modification: event.default_modification || '',
        status: 'idle',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '加载事件详情失败';
      set({ error: msg, status: 'error' });
    }
  },

  generateTimeline: async (modification: string, timeHorizon = '30 years') => {
    const { selectedEvent } = get();
    if (!selectedEvent) return;

    set({
      status: 'generating',
      error: null,
      streamingText: '',
      timelinePoints: [],
      summary: '',
      keyDivergences: [],
      butterflyEffects: [],
      timelineId: null,
      modification,
    });

    const { events: stream, abort } = counterfactualApi.generateStream(
      selectedEvent.id,
      modification,
      timeHorizon,
    );

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'generation_start':
            set({ timelineId: event.data.timeline_id as string });
            break;

          case 'chunk':
            set(s => ({
              streamingText: s.streamingText + (event.data.text as string),
            }));
            break;

          case 'timeline_complete': {
            const d = event.data;
            set({
              timelinePoints: d.timeline_points as TimelinePoint[],
              summary: d.summary as string,
              keyDivergences: d.key_divergences as string[],
              butterflyEffects: d.butterfly_effects as string[],
              tokenUsage: d.token_usage as TokenUsage,
              status: 'complete',
              streamingText: '',
            });
            break;
          }

          case 'error':
            set({
              error: event.data.message as string,
              status: 'error',
              streamingText: '',
            });
            break;
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        const msg = e instanceof Error ? e.message : '时间线生成失败';
        set({ error: msg, status: 'error', streamingText: '' });
      }
    }
  },

  startExploration: async (
    modification: string,
    timeHorizon = '30 years',
    nExplorations = 15,
    nClusters = 4,
  ) => {
    const { selectedEvent } = get();
    if (!selectedEvent) return;

    set({
      status: 'generating',
      error: null,
      modification,
      fanId: null,
      explorationStage: 'diverge',
      explorationProgress: 5,
      explorationClusters: [],
      possibilityBranches: [],
      selectedBranchIndex: null,
      totalExplorations: 0,
      tokenUsage: null,
      // Clear single-mode state
      timelinePoints: [],
      summary: '',
      keyDivergences: [],
      butterflyEffects: [],
      timelineId: null,
      streamingText: '',
    });

    const { events: stream } = counterfactualApi.exploreStream(
      selectedEvent.id,
      modification,
      timeHorizon,
      nExplorations,
      nClusters,
    );

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'explore_start':
            set({
              fanId: event.data.fan_id as string,
              explorationStage: 'diverge',
              explorationProgress: 5,
            });
            break;

          case 'diverge_complete':
            set({
              explorationStage: 'cluster',
              explorationProgress: 30,
              totalExplorations: event.data.count as number,
            });
            break;

          case 'cluster_complete':
            set({
              explorationStage: 'refine',
              explorationProgress: 50,
              explorationClusters: event.data.clusters as ExplorationCluster[],
            });
            break;

          case 'explore_complete': {
            const d = event.data;
            set({
              explorationStage: 'complete',
              explorationProgress: 100,
              possibilityBranches: d.branches as PossibilityBranch[],
              totalExplorations: d.total_explorations as number,
              tokenUsage: d.token_usage as TokenUsage,
              status: 'complete',
            });
            break;
          }

          case 'error':
            set({
              error: event.data.message as string,
              status: 'error',
              explorationStage: 'idle',
              explorationProgress: 0,
            });
            break;
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        const msg = e instanceof Error ? e.message : '可能性探索失败';
        set({
          error: msg,
          status: 'error',
          explorationStage: 'idle',
          explorationProgress: 0,
        });
      }
    }
  },

  selectBranch: (index) => set({ selectedBranchIndex: index }),

  setExplorationMode: (mode) => set({ explorationMode: mode }),

  setExpandedPoint: (year) => set({ expandedPointYear: year }),

  setModification: (text) => set({ modification: text }),

  clearEvent: () =>
    set({
      selectedEvent: null,
      modification: '',
      timelinePoints: [],
      summary: '',
      keyDivergences: [],
      butterflyEffects: [],
      timelineId: null,
      fanId: null,
      explorationStage: 'idle',
      explorationProgress: 0,
      explorationClusters: [],
      possibilityBranches: [],
      selectedBranchIndex: null,
      totalExplorations: 0,
      falsifyStatus: 'idle',
      vulnerabilityIndex: null,
      vulnerabilityPoints: [],
      methodologyNote: '',
      strongestClaimYear: null,
      weakestClaimYear: null,
      annotations: [],
      annotatingYear: null,
      attractorStatus: 'idle',
      attractorAnalysis: null,
      attractorProgress: { current: 0, total: 0 },
      attractorModifications: [],
      personas: [],
      selectedPersonaIds: [],
      embodiedCoalitions: [],
      status: 'idle',
      error: null,
      streamingText: '',
      expandedPointYear: null,
    }),

  reset: () => set(INITIAL_STATE),

  // ─── Falsification Actions ─────────────────────────────────

  falsifyTimeline: async () => {
    const { timelineId } = get();
    if (!timelineId) return;

    set({
      falsifyStatus: 'running',
      vulnerabilityIndex: null,
      vulnerabilityPoints: [],
      methodologyNote: '',
      strongestClaimYear: null,
      weakestClaimYear: null,
    });

    const { events: stream } = counterfactualApi.falsifyStream(timelineId);

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'falsify_start':
            break;

          case 'chunk':
            // streaming text for falsification (optional display)
            break;

          case 'falsify_complete': {
            const d = event.data;
            set({
              falsifyStatus: 'complete',
              vulnerabilityIndex: d.overall_vulnerability_index as number,
              vulnerabilityPoints: d.vulnerability_points as VulnerabilityPoint[],
              methodologyNote: d.methodology_note as string,
              strongestClaimYear: (d.strongest_claim_year as number) ?? null,
              weakestClaimYear: (d.weakest_claim_year as number) ?? null,
            });
            break;
          }

          case 'error':
            set({
              falsifyStatus: 'error',
              error: event.data.message as string,
            });
            break;
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        const msg = e instanceof Error ? e.message : '证伪分析失败';
        set({ falsifyStatus: 'error', error: msg });
      }
    }
  },

  clearFalsification: () =>
    set({
      falsifyStatus: 'idle',
      vulnerabilityIndex: null,
      vulnerabilityPoints: [],
      methodologyNote: '',
      strongestClaimYear: null,
      weakestClaimYear: null,
    }),

  // ─── Annotation Actions ────────────────────────────────────

  setAnnotatingYear: (year) => set({ annotatingYear: year }),

  addAnnotation: (annotation) =>
    set(s => ({
      annotations: [
        ...s.annotations.filter(a => a.year !== annotation.year),
        annotation,
      ],
      annotatingYear: null,
    })),

  removeAnnotation: (year) =>
    set(s => ({
      annotations: s.annotations.filter(a => a.year !== year),
    })),

  regenerateWithConstraints: async () => {
    const { timelineId, annotations } = get();
    if (!timelineId || annotations.length === 0) return;

    set({
      status: 'generating',
      error: null,
      streamingText: '',
      timelinePoints: [],
      summary: '',
      keyDivergences: [],
      butterflyEffects: [],
      falsifyStatus: 'idle',
      vulnerabilityIndex: null,
      vulnerabilityPoints: [],
      methodologyNote: '',
      strongestClaimYear: null,
      weakestClaimYear: null,
    });

    const { events: stream } = counterfactualApi.regenerateStream(
      timelineId,
      annotations,
    );

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'constrained_start':
            set({ timelineId: event.data.timeline_id as string });
            break;

          case 'chunk':
            set(s => ({
              streamingText: s.streamingText + (event.data.text as string),
            }));
            break;

          case 'constrained_complete': {
            const d = event.data;
            set({
              timelinePoints: d.timeline_points as TimelinePoint[],
              summary: d.summary as string,
              keyDivergences: d.key_divergences as string[],
              butterflyEffects: d.butterfly_effects as string[],
              tokenUsage: d.token_usage as TokenUsage,
              status: 'complete',
              streamingText: '',
              annotations: [],
            });
            break;
          }

          case 'error':
            set({
              error: event.data.message as string,
              status: 'error',
              streamingText: '',
            });
            break;
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        const msg = e instanceof Error ? e.message : '受约束重新生成失败';
        set({ error: msg, status: 'error', streamingText: '' });
      }
    }
  },

  // ─── Attractor Detection Actions ──────────────────────────

  setAttractorModifications: (mods) => set({ attractorModifications: mods }),

  detectAttractors: async () => {
    const { selectedEvent, attractorModifications } = get();
    if (!selectedEvent || attractorModifications.length < 2) return;

    set({
      status: 'generating',
      error: null,
      attractorStatus: 'exploring',
      attractorAnalysis: null,
      attractorProgress: { current: 0, total: attractorModifications.length },
      // Clear other result state
      timelinePoints: [],
      summary: '',
      possibilityBranches: [],
      fanId: null,
    });

    const { events: stream } = counterfactualApi.detectAttractorsStream(
      selectedEvent.id,
      attractorModifications,
    );

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'attractor_start':
            set({
              attractorStatus: 'exploring',
              attractorProgress: {
                current: 0,
                total: event.data.total_fans as number,
              },
            });
            break;

          case 'fan_progress':
            set({
              attractorProgress: {
                current: event.data.completed as number,
                total: event.data.total as number,
              },
            });
            break;

          case 'analysis_start':
            set({ attractorStatus: 'analyzing' });
            break;

          case 'attractor_complete': {
            const d = event.data;
            set({
              attractorStatus: 'complete',
              attractorAnalysis: {
                analysis_id: d.analysis_id as string,
                attractors: d.attractors as AttractorPoint[],
                divergent_outcomes: d.divergent_outcomes as string[],
                methodology: d.methodology as string,
                modifications_tested: d.modifications_tested as string[],
                token_usage: d.token_usage as TokenUsage,
              },
              tokenUsage: d.token_usage as TokenUsage,
              status: 'complete',
            });
            break;
          }

          case 'error':
            set({
              attractorStatus: 'error',
              error: event.data.message as string,
              status: 'error',
            });
            break;
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        const msg = e instanceof Error ? e.message : '吸引子检测失败';
        set({ attractorStatus: 'error', error: msg, status: 'error' });
      }
    }
  },

  clearAttractors: () =>
    set({
      attractorStatus: 'idle',
      attractorAnalysis: null,
      attractorProgress: { current: 0, total: 0 },
      attractorModifications: [],
    }),

  // ─── Embodied Perspective Actions ─────────────────────────

  loadPersonas: async (eventId: string) => {
    try {
      const { personas } = await counterfactualApi.listPersonas(eventId);
      set({ personas, selectedPersonaIds: [] });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '加载历史人物失败';
      set({ error: msg, personas: [] });
    }
  },

  togglePersona: (id: string) =>
    set(s => ({
      selectedPersonaIds: s.selectedPersonaIds.includes(id)
        ? s.selectedPersonaIds.filter(pid => pid !== id)
        : [...s.selectedPersonaIds, id],
    })),

  startEmbodiedExploration: async (
    modification: string,
    timeHorizon = '30 years',
    nClusters = 3,
  ) => {
    const { selectedEvent, selectedPersonaIds } = get();
    if (!selectedEvent || selectedPersonaIds.length < 2) return;

    set({
      status: 'generating',
      error: null,
      modification,
      fanId: null,
      explorationStage: 'diverge',
      explorationProgress: 5,
      explorationClusters: [],
      possibilityBranches: [],
      selectedBranchIndex: null,
      totalExplorations: 0,
      embodiedCoalitions: [],
      tokenUsage: null,
      timelinePoints: [],
      summary: '',
      keyDivergences: [],
      butterflyEffects: [],
      timelineId: null,
      streamingText: '',
    });

    const { events: stream } = counterfactualApi.exploreEmbodiedStream(
      selectedEvent.id,
      modification,
      selectedPersonaIds,
      timeHorizon,
      nClusters,
    );

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'embodied_start':
            set({
              fanId: event.data.fan_id as string,
              explorationStage: 'diverge',
              explorationProgress: 5,
            });
            break;

          case 'diverge_complete':
            set({
              explorationStage: 'cluster',
              explorationProgress: 30,
              totalExplorations: event.data.count as number,
            });
            break;

          case 'coalition_complete':
            set({
              explorationStage: 'refine',
              explorationProgress: 50,
              embodiedCoalitions: event.data.coalitions as ActorCoalition[],
            });
            break;

          case 'explore_complete': {
            const d = event.data;
            set({
              explorationStage: 'complete',
              explorationProgress: 100,
              possibilityBranches: d.branches as PossibilityBranch[],
              totalExplorations: d.total_explorations as number,
              tokenUsage: d.token_usage as TokenUsage,
              status: 'complete',
            });
            break;
          }

          case 'error':
            set({
              error: event.data.message as string,
              status: 'error',
              explorationStage: 'idle',
              explorationProgress: 0,
            });
            break;
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        const msg = e instanceof Error ? e.message : '具身视角探索失败';
        set({
          error: msg,
          status: 'error',
          explorationStage: 'idle',
          explorationProgress: 0,
        });
      }
    }
  },

  toggleConeView: () => set((s) => ({ coneViewEnabled: !s.coneViewEnabled })),
}));
