/**
 * Sessions archive API — list / search / fetch persisted auto-loop sessions
 * from the SQLite-backed `/api/sessions` endpoints.
 */
import { BASE_URL } from './api';

export interface SessionListItem {
  session_id: string;
  created_at: string;
  finished_at: string | null;
  mode: 'philosophical' | 'historical';
  seed_hypothesis: string;
  cycle_count: number;
  stopped_reason: string | null;
  total_cost_usd: number;
  elapsed_seconds: number;
  synthesis_preview: string | null;
  flags?: Record<string, boolean>;
}

export interface SessionDetail extends SessionListItem {
  final_synthesis: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  cycles: Array<{
    cycle_num: number;
    hypothesis: string;
    synthesis: string | null;
    next_hypothesis: string | null;
    converged: number;
    personas: Array<{
      persona_id: string;
      persona_name: string;
      model: string | null;
      content: string;
      falsifiability: string | null;
      is_dogmatic: number;
    }>;
    judge_verdict?: {
      verdicts: Array<{
        contested_point: string;
        winning_position: string;
        winning_personas: string[];
        verdict_reason: string;
        confidence: number;
      }>;
      overall_strongest?: { persona_id: string; reason: string };
      overall_weakest?: { persona_id: string; reason: string };
    };
  }>;
}

export interface SessionStats {
  total_sessions: number;
  total_cycles: number;
  total_cost_usd: number;
  avg_cycles_per_session: number;
  stopped_reasons: Record<string, number>;
  by_persona: Array<{
    persona_id: string;
    total: number;
    dogmatic: number;
    with_falsifiability: number;
  }>;
}

export interface BiasPersonaRow {
  persona_id: string;
  total_statements: number;
  dogmatic_count: number;
  dogmatic_rate: number;
  with_falsifiability: number;
  avg_content_length: number;
  judge_wins: number;
  judge_strongest: number;
  judge_weakest: number;
  top_models: Array<{ model: string; count: number }>;
}

export interface BiasModelRow {
  model: string;
  total_statements: number;
  dogmatic_count: number;
  dogmatic_rate: number;
  avg_content_length: number;
  personas_played: number;
}

export interface BiasAnalytics {
  by_persona: BiasPersonaRow[];
  by_model: BiasModelRow[];
  total_verdicts_analyzed: number;
}

export interface RetrospectivePattern {
  persona_id: string;
  pattern: string;
  evidence: string[];
  prompt_suggestion: string;
}

export interface RetrospectiveReport {
  persona_patterns: RetrospectivePattern[];
  missing_perspectives: string[];
  meta_observation: string;
  sessions_analyzed: number;
  model?: string;
}

export interface ConceptEntry {
  name: string;
  gloss: string;
  count: number;
  session_ids: string[];
  related: string[];
}

export interface ConceptReport {
  concepts: ConceptEntry[];
  sessions_analyzed: number;
  model?: string;
}

export interface ConsistencyResult {
  persona_id: string;
  persona_name: string;
  model: string;
  original_content?: string;
  original_falsifiability?: string | null;
  new_content?: string;
  verdict: 'consistent' | 'nuance_shift' | 'significant_drift' | 'contradicted' | 'unknown';
  reason: string;
  key_continuity: string;
  key_change: string;
  replay_ms?: number;
  skipped: boolean;
  error?: string;
}

export interface ConsistencyReport {
  session_id: string;
  question: string;
  original_finished_at: string | null;
  replayed_at: string;
  results: ConsistencyResult[];
}

async function _fetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE_URL}${path}`, init);
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
  return r.json();
}

export const sessionsApi = {
  list: (q?: string, limit = 30, offset = 0) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return _fetch<{ sessions: SessionListItem[] }>(`/sessions?${params}`);
  },
  detail: (sessionId: string) => _fetch<SessionDetail>(`/sessions/${sessionId}`),
  stats: () => _fetch<SessionStats>(`/sessions/_stats`),
  bias: () => _fetch<BiasAnalytics>(`/sessions/_bias`),
  retrospective: (limit = 10) =>
    _fetch<RetrospectiveReport>(`/sessions/_retrospective`, {
      method: 'POST',
      body: JSON.stringify({ limit }),
      headers: { 'Content-Type': 'application/json' },
    }),
  concepts: (limit = 20) =>
    _fetch<ConceptReport>(`/sessions/_concepts`, {
      method: 'POST',
      body: JSON.stringify({ limit }),
      headers: { 'Content-Type': 'application/json' },
    }),
  consistencyTest: (sessionId: string) =>
    _fetch<ConsistencyReport>(`/sessions/${sessionId}/consistency_test`, {
      method: 'POST',
    }),
  remove: (sessionId: string) =>
    _fetch<{ status: string }>(`/sessions/${sessionId}`, { method: 'DELETE' }),
};
