/**
 * API client for the What-If Simulation backend.
 */

// Always use an absolute URL. Going direct to the backend works in every
// embed context (normal browser, VS Code webview, IDE iframe, file://) and
// the backend already CORS-allows http://localhost:5173 / :3000.
// If you deploy to production, change this via VITE_BACKEND_URL env var.
const BACKEND_HOST =
  // @ts-ignore — vite-style env access
  (import.meta as any).env?.VITE_BACKEND_URL ||
  (typeof window !== 'undefined' && window.location.hostname && window.location.protocol.startsWith('http')
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : 'http://localhost:8000');
export const BASE_URL = `${BACKEND_HOST}/api`;

// Safety belt: any URL that escapes the helpers below missing the scheme
// gets normalized so fetch never sees a relative path. Logs once at load.
if (typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.log('[whatif] BASE_URL =', BASE_URL);
}
function ensureAbsolute(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  // path-relative or accidentally bare — prepend backend host
  if (url.startsWith('/api/')) return `${BACKEND_HOST}${url}`;
  if (url.startsWith('/')) return `${BACKEND_HOST}${url}`;
  return `${BASE_URL}/${url.replace(/^\/+/, '')}`;
}

// ─── Debate Types ───────────────────────────────────────────

export interface DebateStartRequest {
  scenario_title: string;
  scenario_hypothesis: string;
  domain?: string;
  variables?: Array<{ name: string; original_value: string; modified_value: string; region: string }>;
  constraints?: string[];
  time_horizon?: string;
  personas?: Array<{ id: string; name?: string; custom_prompt?: string }>;
  language?: string;
  model_params?: {
    persona_temperature: number;
    persona_max_tokens: number;
    judge_temperature: number;
    judge_max_tokens: number;
  };
}

export interface DebateStartResponse {
  session_id: string;
  scenario: string;
  personas: Array<{ id: string; name: string; role: string }>;
  status: string;
}

export interface SessionState {
  session_id: string;
  scenario: string;
  personas: Array<{ id: string; name: string; role: string }>;
  current_round: number;
  rounds: Array<{
    round_number: number;
    injected_event: string | null;
    statements: Array<{
      persona_id: string;
      persona_name: string;
      content: string;
    }>;
  }>;
  pending_event: string | null;
  status: string;
  token_usage: TokenUsage;
}

export interface TokenUsage {
  total_input_tokens: number;
  total_output_tokens: number;
  total_api_calls: number;
  estimated_cost_usd: number;
}

// ─── Causal Graph Types ─────────────────────────────────────

export interface CausalNode {
  id: string;
  label: string;
  category: 'economic' | 'social' | 'environmental' | 'political';
  current_state: string;
  description: string;
  importance_score: number;
}

export interface CausalEdge {
  source: string;
  target: string;
  relationship: 'positive' | 'negative' | 'complex';
  strength: number;
  mechanism: string;
  time_lag: string;
  confidence: number;
}

export interface CausalGraphData {
  graph_id: string;
  title: string;
  nodes: CausalNode[];
  edges: CausalEdge[];
  token_usage?: TokenUsage;
}

export interface PropagationStep {
  node_id: string;
  node_label: string;
  depth: number;
  incoming_effect: string;
  outgoing_effects: Array<{ target: string; effect: string }>;
  reasoning: string;
  confidence: number;
}

export interface PropagationAnalysis {
  initial_node_id: string;
  initial_perturbation: string;
  steps: PropagationStep[];
  summary: string;
  affected_nodes_count: number;
  max_depth_reached: number;
}

// ─── Counterfactual Types ───────────────────────────────────

export interface HistoricalEventSummary {
  id: string;
  title: string;
  period: string;
  region: string;
  domain: string;
  description: string;
  decision_node_count: number;
  default_modification: string;
}

export interface DecisionNode {
  id: string;
  year: number;
  title: string;
  description: string;
  actual_outcome: string;
  modifiable: boolean;
}

export interface HistoricalEvent {
  id: string;
  title: string;
  period: string;
  region: string;
  domain: string;
  description: string;
  key_data_points: Array<{ year: number; metric: string; value: string; source: string }>;
  decision_nodes: DecisionNode[];
  default_modification: string;
}

export interface TimelinePoint {
  year: number;
  actual: string;
  counterfactual: string;
  divergence_level: number;
  confidence: number;
  reasoning: string;
  category: string;
}

export interface CounterfactualTimeline {
  timeline_id: string;
  event_title: string;
  modification: string;
  timeline_points: TimelinePoint[];
  summary: string;
  key_divergences: string[];
  butterfly_effects: string[];
  token_usage?: TokenUsage;
}

// ─── Ensemble Explore Types ─────────────────────────────────

export interface ExplorationCluster {
  cluster_id: string;
  narrative_direction: string;
  explanation: string;
  member_count: number;
  consensus_strength: number;
}

export interface PossibilityBranch {
  cluster_id: string;
  narrative_direction: string;
  explanation: string;
  consensus_strength: number;
  scenario_count: number;
  timeline_id: string;
  timeline_points: TimelinePoint[];
  summary: string;
  key_divergences: string[];
  butterfly_effects: string[];
}

export interface PossibilityFan {
  fan_id: string;
  event_id: string;
  event_title: string;
  modification: string;
  total_explorations: number;
  branches: PossibilityBranch[];
  token_usage: TokenUsage;
}

// ─── Falsification Engine Types ────────────────────────────

export interface VulnerabilityPoint {
  year: number;
  claim: string;
  attack_vector: string;
  severity: number;
  counter_evidence: string;
  alternative_outcome: string;
}

export interface TimelineVulnerabilityAssessment {
  timeline_id: string;
  overall_vulnerability_index: number;
  vulnerability_points: VulnerabilityPoint[];
  methodology_note: string;
  strongest_claim_year: number | null;
  weakest_claim_year: number | null;
  token_usage?: TokenUsage;
}

// ─── User Knowledge Injection Types ───────────────────────

export interface UserAnnotation {
  year: number;
  original_claim: string;
  correction: string;
  source_description: string;
  constraint_type: 'factual_error' | 'missing_factor' | 'domain_knowledge';
}

// ─── Attractor Detection Types ────────────────────────────

export interface AttractorPoint {
  outcome_description: string;
  convergence_score: number;
  contributing_fan_count: number;
  earliest_emergence_year: number;
  resistance_to_change: number;
}

export interface AttractorAnalysis {
  analysis_id: string;
  attractors: AttractorPoint[];
  divergent_outcomes: string[];
  methodology: string;
  modifications_tested: string[];
  token_usage?: TokenUsage;
}

// ─── Embodied Perspective Types ──────────────────────────

export interface HistoricalPersona {
  id: string;
  name: string;
  role: string;
  era?: string;
  worldview?: string;
  decision_style?: string;
  known_positions?: string[];
  language_style?: string;
}

export interface ActorCoalition {
  coalition_name: string;
  members: string[];
  shared_interest: string;
  conflict_points: string[];
  coalition_strength: number;
}

// ─── SSE Event Type ─────────────────────────────────────────

export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

// ─── Shared Request Helper ──────────────────────────────────

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(ensureAbsolute(`${BASE_URL}${path}`), {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || 'API request failed');
  }
  return res.json();
}

// ─── SSE Stream Parser ──────────────────────────────────────

export interface SSEStreamOptions extends RequestInit {
  /** Build a resume URL from (session_id, last_event_id). The stream will
   *  reconnect with exponential backoff if it ends without a `done` event.
   *  `session_id` comes from whatever ``extractSessionId`` captured during
   *  the live stream — usually the first ``auto_start``-like event. When
   *  omitted, no reconnect is attempted. */
  resumeUrl?: (sessionId: string, lastEventId: number) => string;
  /** Extract the session_id from a parsed SSE event so the resume URL
   *  builder knows where to reconnect. Returns null if the event isn't
   *  the session-bootstrapping one. */
  extractSessionId?: (event: SSEEvent) => string | null;
  /** Max reconnect attempts before giving up. Default 5. */
  maxReconnects?: number;
}

export function createSSEStream(
  url: string,
  options?: SSEStreamOptions,
): {
  events: AsyncGenerator<SSEEvent>;
  abort: () => void;
} {
  const controller = new AbortController();
  const { resumeUrl, extractSessionId, maxReconnects = 5, ...fetchOptions } = options || {};

  async function* streamEvents(): AsyncGenerator<SSEEvent> {
    let currentUrl = ensureAbsolute(url);
    let lastEventId = 0;
    let sessionId: string | null = null;
    let reconnects = 0;
    let cleanlyDone = false;
    let isReconnect = false;

    while (!cleanlyDone) {
      // For reconnect requests, server expects GET on resume URL.
      const reqInit: RequestInit = isReconnect
        ? {
            method: 'GET',
            headers: {
              'Accept': 'text/event-stream',
              'Last-Event-ID': String(lastEventId),
            },
            signal: controller.signal,
          }
        : {
            ...fetchOptions,
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream',
              ...(fetchOptions?.headers || {}),
            },
            signal: controller.signal,
          };

      let res: Response;
      try {
        res = await fetch(currentUrl, reqInit);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (!resumeUrl || !sessionId || reconnects >= maxReconnects) throw err;
        reconnects++;
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** reconnects, 8000)));
        currentUrl = ensureAbsolute(resumeUrl(sessionId, lastEventId));
        isReconnect = true;
        continue;
      }

      if (!res.ok) {
        // 404 on resume = session GC'd; bail out cleanly.
        if (isReconnect && res.status === 404) return;
        throw new Error(`Stream failed: ${res.statusText}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType = 'message';
      let currentEventId: number | null = null;
      let streamClosedCleanly = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('id: ')) {
              const n = parseInt(line.slice(4).trim(), 10);
              if (!isNaN(n)) currentEventId = n;
            } else if (line.startsWith('event: ')) {
              currentEventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                const ev: SSEEvent = { type: currentEventType, data };

                // Capture session_id from first known event for reconnect.
                if (!sessionId && extractSessionId) {
                  const sid = extractSessionId(ev);
                  if (sid) sessionId = sid;
                }
                // Treat server's `done` event as a clean termination — no
                // reconnect needed.
                if (currentEventType === 'done') {
                  streamClosedCleanly = true;
                  cleanlyDone = true;
                  continue;
                }
                yield ev;
                if (currentEventId !== null) lastEventId = currentEventId;
              } catch {
                // Skip malformed JSON
              }
              currentEventType = 'message';
              currentEventId = null;
            }
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        // Network / parse error → fall through to reconnect path below.
      }

      if (streamClosedCleanly) return;

      // Stream closed without `done` event → try resume if possible.
      if (!resumeUrl || !sessionId || reconnects >= maxReconnects) {
        // Caller didn't opt in to resume, OR we never learned the session_id,
        // OR we've exhausted retries. End the iterator cleanly.
        return;
      }
      reconnects++;
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** reconnects, 8000)));
      currentUrl = ensureAbsolute(resumeUrl(sessionId, lastEventId));
      isReconnect = true;
    }
  }

  return {
    events: streamEvents(),
    abort: () => controller.abort(),
  };
}

// ─── Debate API ─────────────────────────────────────────────

export const debateApi = {
  start: (data: DebateStartRequest) =>
    request<DebateStartResponse>('/debate/start', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSession: (sessionId: string) =>
    request<SessionState>(`/debate/${sessionId}`),

  injectEvent: (sessionId: string, description: string) =>
    request<{ status: string; event: string }>(`/debate/${sessionId}/inject`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    }),

  getSummary: (sessionId: string) =>
    request<{ summary: string; judge_model?: string; token_usage: TokenUsage }>(`/debate/${sessionId}/summary`),

  /**
   * Returns the SSE URL for running a debate round.
   * Use with useSSE hook for streaming.
   */
  roundStreamUrl: (sessionId: string) => `${BASE_URL}/debate/${sessionId}/round`,
};

// ─── Causal Graph API ───────────────────────────────────────

export const causalApi = {
  /**
   * Generate a causal graph from a scenario. Returns an SSE stream.
   */
  generateStream: (scenario_title: string, scenario_hypothesis: string, domain: string = 'general') =>
    createSSEStream(`${BASE_URL}/causal/generate`, {
      method: 'POST',
      body: JSON.stringify({ scenario_title, scenario_hypothesis, domain }),
    }),

  /**
   * Propagate effects from a node perturbation. Returns an SSE stream.
   */
  propagateStream: (graphId: string, nodeId: string, perturbation: string, depth: number = 4) =>
    createSSEStream(`${BASE_URL}/causal/${graphId}/propagate`, {
      method: 'POST',
      body: JSON.stringify({ node_id: nodeId, perturbation, depth }),
    }),

  /**
   * Get a graph's current state.
   */
  getGraph: (graphId: string) =>
    request<{
      id: string;
      title: string;
      domain: string;
      nodes: CausalNode[];
      edges: CausalEdge[];
      scenario_context: string;
    }>(`/causal/${graphId}`),
};

// ─── Counterfactual API ─────────────────────────────────────

export const counterfactualApi = {
  /**
   * List all available historical events.
   */
  listEvents: () =>
    request<{ events: HistoricalEventSummary[] }>('/counterfactual/events'),

  /**
   * Get full event details with decision nodes.
   */
  getEvent: (eventId: string) =>
    request<HistoricalEvent>(`/counterfactual/events/${eventId}`),

  /**
   * Generate a counterfactual timeline. Returns SSE stream.
   */
  generateStream: (eventId: string, modification: string, timeHorizon: string = '30 years') =>
    createSSEStream(`${BASE_URL}/counterfactual/generate`, {
      method: 'POST',
      body: JSON.stringify({
        event_id: eventId,
        modification,
        time_horizon: timeHorizon,
      }),
    }),

  /**
   * Get a previously generated timeline.
   */
  getTimeline: (timelineId: string) =>
    request<CounterfactualTimeline>(`/counterfactual/timelines/${timelineId}`),

  /**
   * Ensemble exploration: Explore → Cluster → Refine. Returns SSE stream.
   */
  exploreStream: (
    eventId: string,
    modification: string,
    timeHorizon: string = '30 years',
    nExplorations: number = 15,
    nClusters: number = 4,
  ) =>
    createSSEStream(`${BASE_URL}/counterfactual/explore`, {
      method: 'POST',
      body: JSON.stringify({
        event_id: eventId,
        modification,
        time_horizon: timeHorizon,
        n_explorations: nExplorations,
        n_clusters: nClusters,
      }),
    }),

  /**
   * Get a previously generated possibility fan.
   */
  getFan: (fanId: string) =>
    request<PossibilityFan>(`/counterfactual/fans/${fanId}`),

  // ─── Falsification Engine ───────────────────────────────

  /**
   * Run adversarial falsification on a timeline. Returns SSE stream.
   */
  falsifyStream: (timelineId: string) =>
    createSSEStream(`${BASE_URL}/counterfactual/timelines/${timelineId}/falsify`, {
      method: 'POST',
    }),

  /**
   * Get a cached vulnerability assessment.
   */
  getVulnerability: (timelineId: string) =>
    request<TimelineVulnerabilityAssessment>(
      `/counterfactual/timelines/${timelineId}/vulnerability`,
    ),

  // ─── User Knowledge Injection ───────────────────────────

  /**
   * Regenerate a timeline with user annotations. Returns SSE stream.
   */
  regenerateStream: (timelineId: string, annotations: UserAnnotation[], preserveUncontested = true) =>
    createSSEStream(`${BASE_URL}/counterfactual/timelines/${timelineId}/regenerate`, {
      method: 'POST',
      body: JSON.stringify({
        timeline_id: timelineId,
        annotations,
        preserve_uncontested: preserveUncontested,
      }),
    }),

  // ─── Attractor Detection ──────────────────────────────────

  /**
   * Run attractor detection across multiple modifications. Returns SSE stream.
   */
  detectAttractorsStream: (
    eventId: string,
    modifications: string[],
    nExplorationsPerMod: number = 10,
    nClusters: number = 3,
  ) =>
    createSSEStream(`${BASE_URL}/counterfactual/attractors/detect`, {
      method: 'POST',
      body: JSON.stringify({
        event_id: eventId,
        modifications,
        n_explorations_per: nExplorationsPerMod,
        n_clusters: nClusters,
      }),
    }),

  /**
   * Get a cached attractor analysis result.
   */
  getAttractorAnalysis: (analysisId: string) =>
    request<AttractorAnalysis>(`/counterfactual/attractors/${analysisId}`),

  // ─── Embodied Perspective ─────────────────────────────────

  /**
   * Get available historical personas for an event.
   */
  listPersonas: (eventId: string) =>
    request<{ personas: HistoricalPersona[] }>(`/counterfactual/events/${eventId}/personas`),

  /**
   * Run embodied perspective exploration. Returns SSE stream.
   */
  exploreEmbodiedStream: (
    eventId: string,
    modification: string,
    personaIds: string[],
    timeHorizon: string = '30 years',
    nClusters: number = 3,
  ) =>
    createSSEStream(`${BASE_URL}/counterfactual/explore/embodied`, {
      method: 'POST',
      body: JSON.stringify({
        event_id: eventId,
        modification,
        persona_ids: personaIds,
        time_horizon: timeHorizon,
        n_clusters: nClusters,
      }),
    }),
};

// ─── Orchestrator Types ───────────────────────────────────

export interface FeedbackLoopConfig {
  event_id: string;
  modification: string;
  time_horizon?: string;
  max_iterations?: number;
  modules?: string[];
  debate_rounds?: number;
  n_debate_personas?: number;
}

export interface LoopIteration {
  iteration: number;
  counterfactual_summary: string;
  key_divergences: string[];
  causal_insights: string[];
  causal_graph_id: string;
  debate_consensus: string[];
  debate_dissent: string[];
  refinement_for_next: string;
}

export interface FeedbackLoopResult {
  loop_id: string;
  config: FeedbackLoopConfig;
  iterations: LoopIteration[];
  final_synthesis: string;
  convergence_achieved: boolean;
  total_iterations: number;
  token_usage: Record<string, number>;
}

// ─── Orchestrator API ─────────────────────────────────────

export const orchestratorApi = {
  /**
   * Run a cross-module feedback loop. Returns SSE stream.
   */
  feedbackLoopStream: (config: FeedbackLoopConfig) =>
    createSSEStream(`${BASE_URL}/orchestrator/feedback-loop`, {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  /**
   * Get a cached feedback loop result.
   */
  getResult: (loopId: string) =>
    request<FeedbackLoopResult>(`/orchestrator/results/${loopId}`),
};

// ─── Auto-Loop Types ──────────────────────────────────────

export type AutoLoopMode = 'historical' | 'philosophical';

export interface AutoLoopConfig {
  seed_hypothesis: string;
  mode?: AutoLoopMode;
  event_id?: string;
  max_cycles?: number;
  max_iterations_per_loop?: number;
  time_horizon?: string;
  adversarial?: boolean;
  extract_stances?: boolean;
  branching?: boolean;
  flip_stance?: boolean;
  subq_decomposition?: boolean;
  self_reflection?: boolean;
  subdomain_routing?: boolean;
  judge_verdict?: boolean;
  self_contradict?: boolean;
  cross_lingual?: boolean;
  live_critic?: boolean;
  fact_check?: boolean;
  persona_overrides?: Record<string, string>;
}

export interface CriticIssue {
  type: string;
  detail: string;
}

export interface FactCheckClaim {
  claim: string;
  verdict: 'certain' | 'uncertain' | 'likely_wrong' | 'unverifiable';
  reason: string;
}

export interface PersonaFollowupResponse {
  persona_id: string;
  persona_name: string;
  followup: string;
  response: string;
  latency_ms: number;
  model_spec: string;
}

export interface PersonaCompareResponse {
  persona_id: string;
  persona_name: string;
  question: string;
  responses: Array<{
    spec: string;
    content: string;
    latency_ms: number;
    error: string | null;
  }>;
}

export interface JudgeVerdictItem {
  contested_point: string;
  winning_position: string;
  winning_personas: string[];
  verdict_reason: string;
  confidence: number;
}
export interface JudgeVerdict {
  verdicts: JudgeVerdictItem[];
  overall_strongest?: { persona_id: string; reason: string };
  overall_weakest?: { persona_id: string; reason: string };
}

// ─── Epistemic Divergence Map Types ──────────────────────
export interface StanceMatrix {
  arguments: string[];
  stances: Record<string, number[]>;
}

export interface AutoLoopCycleSummary {
  cycle: number;
  hypothesis: string;
  loop_id: string;
  synthesis_preview: string;
  next_hypothesis: string;
  converged: boolean;
}

export interface AutoLoopResult {
  session_id: string;
  event_id: string;
  seed_hypothesis: string;
  total_cycles: number;
  stopped_reason: string;
  evolution_chain: string[];
  cycles: AutoLoopCycleSummary[];
}

// ─── Auto-Loop API ────────────────────────────────────────

// ─── Autonomous Topic Explorer ───────────────────────────

export interface AutonomousDebateConfig {
  seed_topic: string;
  domain?: string;
  max_cycles?: number;
  time_budget_seconds?: number;
  cost_budget_usd?: number;
  rounds_per_branch?: number;
  branches_per_cycle?: number;
  confidence_threshold?: number;
}

export const autonomousDebateApi = {
  startStream: (config: AutonomousDebateConfig) =>
    createSSEStream(`${BASE_URL}/orchestrator/autonomous-debate`, {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  cancel: (sessionId: string) =>
    request<{ status: string }>(`/orchestrator/autonomous-debate/${sessionId}/cancel`, {
      method: 'POST',
    }),
  killBranch: (sessionId: string, branchId: string) =>
    request<{ status: string }>(`/orchestrator/autonomous-debate/${sessionId}/kill-branch`, {
      method: 'POST',
      body: JSON.stringify({ branch_id: branchId }),
    }),
  injectSeed: (sessionId: string, text: string) =>
    request<{ status: string; injection: string }>(`/orchestrator/autonomous-debate/${sessionId}/inject`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  listSessions: () =>
    request<{ sessions: Array<{ session_id: string; topic: string; branches: number; cost_usd: number; mtime: number }> }>(
      `/orchestrator/autonomous-debate/_logs`,
    ),
  getBriefing: (sessionId: string) =>
    request<{ session_id: string; markdown: string }>(`/orchestrator/autonomous-debate/${sessionId}/briefing`),
  getLog: (sessionId: string) =>
    request<{ session_id: string; n_events: number; events: any[] }>(`/orchestrator/autonomous-debate/${sessionId}/log`),
  compareSessions: (sessionIds: string[]) =>
    request<{
      sessions: Array<{
        session_id: string;
        topic?: string;
        branches_count?: number;
        decisions_count?: number;
        cost_usd?: number;
        elapsed_s?: number;
        top_branches?: Array<{
          branch_id: string;
          cycle: number;
          injection: string;
          eval: { confidence: number; coherence: number; novelty: number; risk_signal: number; one_line_takeaway: string } | null;
        }>;
        final_synthesis_preview?: string;
        missing?: boolean;
        error?: string;
      }>;
    }>(`/orchestrator/autonomous-debate/_compare`, {
      method: 'POST',
      body: JSON.stringify({ session_ids: sessionIds }),
    }),
};

export const autoLoopApi = {
  /**
   * Run autonomous continuous exploration. Returns SSE stream.
   */
  startStream: (config: AutoLoopConfig) =>
    createSSEStream(`${BASE_URL}/orchestrator/auto-loop`, {
      method: 'POST',
      body: JSON.stringify(config),
      // Opt into auto-reconnect: server keeps the cycle running in a
      // background task with a per-session ring buffer; on disconnect we
      // GET the resume URL with `Last-Event-ID` to pick up where we left off.
      extractSessionId: (ev) => {
        const d = ev?.data as Record<string, unknown> | undefined;
        if (ev.type === 'auto_start' && typeof d?.session_id === 'string') {
          return d.session_id;
        }
        return null;
      },
      resumeUrl: (sessionId, lastEventId) =>
        `${BASE_URL}/orchestrator/auto-loop/${sessionId}/resume?last_event_id=${lastEventId}`,
    }),

  /**
   * Cancel a running auto-loop session.
   */
  cancel: (sessionId: string) =>
    request<{ status: string }>(`/orchestrator/auto-loop/${sessionId}/cancel`, {
      method: 'POST',
    }),

  /**
   * Get a cached auto-loop result.
   */
  getResult: (sessionId: string) =>
    request<AutoLoopResult>(`/orchestrator/auto-loop/${sessionId}`),

  /**
   * Auto-generated markdown briefing of the entire run, including every
   * persona's complete statement, synthesis per cycle, and stance matrix.
   */
  getBriefing: (sessionId: string) =>
    request<{ session_id: string; markdown: string }>(`/orchestrator/auto-loop/${sessionId}/briefing`),

  listLogs: () =>
    request<{ sessions: Array<{ session_id: string; seed_hypothesis: string; mode: string; cycles: number; mtime: number }> }>(
      `/orchestrator/auto-loop/_logs`,
    ),

  /** Run the same persona's prompt across multiple model providers. */
  comparePersona: (body: {
    persona_id: string;
    question: string;
    history?: string;
    specs?: string[];
  }) =>
    request<PersonaCompareResponse>(`/orchestrator/persona/compare`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Send a Socratic follow-up question to a specific persona post-cycle. */
  followupPersona: (body: {
    persona_id: string;
    question: string;
    persona_statement: string;
    followup: string;
    model_spec?: string;
  }) =>
    request<PersonaFollowupResponse>(`/orchestrator/persona/followup`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// ─── Voting Hall API ──────────────────────────────────────

export interface VotingConfig {
  question: string;
  context?: string;
  vote_type: 'binary' | 'scale10';
  mode: 'panel' | 'calibration' | 'matrix';
  models?: string[];
  calibration_model?: string;
  votes_per_model?: number;
  max_tokens?: number;
  // Method flags (stack-able)
  framing_flip?: boolean;
  super_forecaster?: boolean;
  role_framing?: boolean;
  delphi?: boolean;
  human_baseline?: boolean;
  human_pre_vote?: string;
}

export const votingApi = {
  runStream: (cfg: VotingConfig) =>
    createSSEStream(`${BASE_URL}/voting/run`, {
      method: 'POST',
      body: JSON.stringify(cfg),
    }),
  getProfile: (model?: string) =>
    request<{ models: Array<any>; log_count: number }>(
      `/voting/profile${model ? `?model=${encodeURIComponent(model)}` : ''}`,
    ),
};

// ─── Topic utility API (pre-flight critique + decompose) ──

export interface TopicCritique {
  issues: string[];
  suggested_rewrite: string;
  complexity_score: number;  // 0..10
  ready_to_run: boolean;
}
export interface TopicDecomposition {
  is_compound: boolean;
  reasoning: string;
  sub_topics: Array<{ title: string; hypothesis: string }>;
}
export interface TopicAnalogy {
  title: string;
  era: string;
  why_analogous: string;
  key_lesson: string;
  key_difference: string;
}
export interface TopicAnalogies {
  analogies: TopicAnalogy[];
}

export const topicApi = {
  critique: (topic: string) =>
    request<TopicCritique>(`/orchestrator/topic/critique`, {
      method: 'POST',
      body: JSON.stringify({ topic }),
    }),
  decompose: (topic: string) =>
    request<TopicDecomposition>(`/orchestrator/topic/decompose`, {
      method: 'POST',
      body: JSON.stringify({ topic }),
    }),
  analogies: (topic: string) =>
    request<TopicAnalogies>(`/orchestrator/topic/analogies`, {
      method: 'POST',
      body: JSON.stringify({ topic }),
    }),
};
